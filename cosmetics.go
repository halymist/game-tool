package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

// Cosmetic represents a row in game.cosmetics
type Cosmetic struct {
	ID      int     `json:"id"`
	Type    string  `json:"type"`
	Name    string  `json:"name"`
	Price   int     `json:"price"`
	OffsetX float64 `json:"offsetX"`
	OffsetY float64 `json:"offsetY"`
	Scale   float64 `json:"scale"`
	Version int     `json:"version"`
}

type CosmeticResponse struct {
	Success   bool       `json:"success"`
	Message   string     `json:"message,omitempty"`
	Cosmetics []Cosmetic `json:"cosmetics,omitempty"`
	Version   int        `json:"version,omitempty"`
	ID        int        `json:"id,omitempty"`
}

// handleGetCosmetics returns all cosmetics from game.cosmetics
func handleGetCosmetics(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := db.Query(`SELECT id, type, COALESCE(name, ''), COALESCE(price, 0), COALESCE(offset_x, 0), COALESCE(offset_y, 0), COALESCE(scale, 100) FROM game.cosmetics ORDER BY type, id`)
	if err != nil {
		log.Printf("Error querying cosmetics: %v", err)
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: err.Error()})
		return
	}
	defer rows.Close()

	var cosmetics []Cosmetic
	for rows.Next() {
		var c Cosmetic
		if err := rows.Scan(&c.ID, &c.Type, &c.Name, &c.Price, &c.OffsetX, &c.OffsetY, &c.Scale); err != nil {
			log.Printf("Error scanning cosmetic: %v", err)
			continue
		}
		cosmetics = append(cosmetics, c)
	}

	json.NewEncoder(w).Encode(CosmeticResponse{Success: true, Cosmetics: cosmetics})
}

// handleSaveCosmetic creates or updates a cosmetic in game.cosmetics
func handleSaveCosmetic(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req Cosmetic
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Invalid request"})
		return
	}

	if req.Type == "" {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Type is required"})
		return
	}

	if req.ID > 0 {
		_, err := db.Exec(`UPDATE game.cosmetics SET type = $1, name = $2, price = $3, offset_x = $4, offset_y = $5, scale = $6 WHERE id = $7`,
			req.Type, req.Name, req.Price, req.OffsetX, req.OffsetY, req.Scale, req.ID)
		if err != nil {
			json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Update failed: %v", err)})
			return
		}
	} else {
		err := db.QueryRow(`INSERT INTO game.cosmetics (type, name, price, offset_x, offset_y, scale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			req.Type, req.Name, req.Price, req.OffsetX, req.OffsetY, req.Scale).Scan(&req.ID)
		if err != nil {
			json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Insert failed: %v", err)})
			return
		}
	}

	json.NewEncoder(w).Encode(CosmeticResponse{Success: true, ID: req.ID})
}

// handleDeleteCosmetic deletes a cosmetic from game.cosmetics
func handleDeleteCosmetic(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Invalid request"})
		return
	}

	_, err := db.Exec(`DELETE FROM game.cosmetics WHERE id = $1`, req.ID)
	if err != nil {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Delete failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CosmeticResponse{Success: true})
}

// handleUploadCosmetic creates a new cosmetic record (or updates existing) and uploads image to R2.
func handleUploadCosmetic(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID          int    `json:"id"`
		Type        string `json:"type"`
		Name        string `json:"name"`
		ImageData   string `json:"imageData"`
		ContentType string `json:"contentType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Invalid request"})
		return
	}

	if req.Type == "" {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Type is required"})
		return
	}
	if req.ImageData == "" {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: "Image data is required"})
		return
	}

	if req.ID > 0 {
		_, err := db.Exec(`UPDATE game.cosmetics SET type = $1, name = $2 WHERE id = $3`, req.Type, req.Name, req.ID)
		if err != nil {
			json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Update failed: %v", err)})
			return
		}
	} else {
		err := db.QueryRow(`INSERT INTO game.cosmetics (type, name, price) VALUES ($1, $2, 0) RETURNING id`,
			req.Type, req.Name).Scan(&req.ID)
		if err != nil {
			json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Insert failed: %v", err)})
			return
		}
	}

	s3Key, err := UploadAssetToS3("cosmetics", req.ID, req.ImageData, req.ContentType)
	if err != nil {
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: fmt.Sprintf("Upload failed: %v", err)})
		return
	}

	log.Printf("Uploaded cosmetic: id=%d, type=%s, name=%s, key=%s", req.ID, req.Type, req.Name, s3Key)
	json.NewEncoder(w).Encode(CosmeticResponse{Success: true, ID: req.ID})
}

// handleGetCosmeticsVersioned returns cosmetics newer than client version.
// Query param: ?version=N (returns rows where version > N, plus the current max version)
func handleGetCosmeticsVersioned(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientVersion := 0
	if v := r.URL.Query().Get("version"); v != "" {
		fmt.Sscanf(v, "%d", &clientVersion)
	}

	rows, err := db.Query(`SELECT id, type, COALESCE(price, 0) FROM game.cosmetics WHERE version > $1 ORDER BY id`, clientVersion)
	if err != nil {
		log.Printf("Error querying versioned cosmetics: %v", err)
		json.NewEncoder(w).Encode(CosmeticResponse{Success: false, Message: err.Error()})
		return
	}
	defer rows.Close()

	var cosmetics []Cosmetic
	for rows.Next() {
		var c Cosmetic
		if err := rows.Scan(&c.ID, &c.Type, &c.Price); err != nil {
			log.Printf("Error scanning versioned cosmetic: %v", err)
			continue
		}
		cosmetics = append(cosmetics, c)
	}

	// Get current max version
	var maxVersion int
	err = db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM game.cosmetics`).Scan(&maxVersion)
	if err != nil {
		maxVersion = clientVersion
	}

	json.NewEncoder(w).Encode(CosmeticResponse{Success: true, Cosmetics: cosmetics, Version: maxVersion})
}
