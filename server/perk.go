package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// PerkEffect represents an effect applied to a perk with its factor
type PerkEffect struct {
	Type   int `json:"type"`   // Effect ID (0 for empty/no effect)
	Factor int `json:"factor"` // Effect factor/multiplier
}

// Perk represents the database structure for perks (game.perks_info)
type Perk struct {
	ID          int          `json:"id" db:"perk_id"`
	Name        string       `json:"name" db:"perk_name"`
	AssetID     int          `json:"assetID" db:"asset_id"`
	Effect1ID   *int         `json:"effect1_id" db:"effect_id_1"`
	Factor1     *int         `json:"factor1" db:"factor_1"`
	Effect2ID   *int         `json:"effect2_id" db:"effect_id_2"`
	Factor2     *int         `json:"factor2" db:"factor_2"`
	Description *string      `json:"description" db:"description"`
	Version     int          `json:"version" db:"version"`
	Effects     []PerkEffect `json:"effects,omitempty"` // Processed effects for client
	Icon        string       `json:"icon,omitempty"`    // For signed URL
}

// PerkResponse represents the JSON response structure for perks
type PerkResponse struct {
	Success      bool          `json:"success"`
	Message      string        `json:"message,omitempty"`
	Effects      []Effect      `json:"effects,omitempty"`
	Perks        []Perk        `json:"perks,omitempty"`
	PendingPerks []PendingPerk `json:"pendingPerks,omitempty"`
}

// PendingPerk represents the database structure for pending perks (tooling.perks_info)
type PendingPerk struct {
	ToolingID   int     `json:"toolingId" db:"tooling_id"`
	GameID      *int    `json:"gameId" db:"game_id"`
	Action      string  `json:"action" db:"action"`
	Version     int     `json:"version" db:"version"`
	Approved    bool    `json:"approved" db:"approved"`
	Name        string  `json:"name" db:"perk_name"`
	AssetID     int     `json:"assetID" db:"asset_id"`
	Effect1ID   *int    `json:"effect1_id" db:"effect_id_1"`
	Factor1     *int    `json:"factor1" db:"factor_1"`
	Effect2ID   *int    `json:"effect2_id" db:"effect_id_2"`
	Factor2     *int    `json:"factor2" db:"factor_2"`
	Description *string `json:"description" db:"description"`
}

// PerkAsset represents an available perk asset from S3
type PerkAsset struct {
	AssetID int    `json:"assetID"`
	Name    string `json:"name"`
	Icon    string `json:"icon"` // Signed URL
}

// getPerksHandler handles GET requests to retrieve all perks with signed URLs
func getPerksHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET PERKS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to get perks")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get all effects (same as enemies endpoint)
	effects, err := getAllEffects()
	if err != nil {
		log.Printf("Error getting effects: %v", err)
		response := PerkResponse{
			Success: false,
			Message: fmt.Sprintf("Error getting effects: %v", err),
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	log.Printf("Retrieved %d effects", len(effects))

	// Get all perks
	perks, err := getAllPerks()
	if err != nil {
		log.Printf("Error getting perks: %v", err)
		response := PerkResponse{
			Success: false,
			Message: fmt.Sprintf("Error getting perks: %v", err),
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	log.Printf("Retrieved %d perks from database", len(perks))

	// Generate signed URLs for perk icons
	for i := range perks {
		if perks[i].AssetID > 0 {
			// Generate S3 key for perk icon
			iconKey := fmt.Sprintf("images/perks/%d.webp", perks[i].AssetID)

			// Generate signed URL with 1 hour expiration
			signedURL, err := generateSignedURL(iconKey, time.Hour)
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for perk %d (assetID: %d): %v",
					perks[i].ID, perks[i].AssetID, err)
				// Continue without icon rather than failing the entire request
				perks[i].Icon = ""
			} else {
				perks[i].Icon = signedURL
				log.Printf("Generated signed URL for perk %d (assetID: %d)", perks[i].ID, perks[i].AssetID)
			}
		}
	}

	// Get pending perks from tooling.perks_info
	pendingPerks, err := getPendingPerks()
	if err != nil {
		log.Printf("Warning: Error getting pending perks: %v", err)
		pendingPerks = []PendingPerk{}
	}

	log.Printf("Retrieved %d pending perks from tooling.perks_info", len(pendingPerks))

	// Create response
	response := PerkResponse{
		Success:      true,
		Effects:      effects,
		Perks:        perks,
		PendingPerks: pendingPerks,
	}

	log.Printf("=== SENDING PERKS RESPONSE ===")
	log.Printf("Effects count: %d", len(effects))
	log.Printf("Perks count: %d", len(perks))
	log.Printf("Pending perks count: %d", len(pendingPerks))

	// Send response
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding perks response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Println("✅ Perks data sent successfully")
}

// getAllPerks retrieves all perks from the database (game.perks_info)
func getAllPerks() ([]Perk, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `
		SELECT 
			perk_id, 
			perk_name,
			asset_id, 
			effect_id_1, 
			factor_1, 
			effect_id_2, 
			factor_2,
			description,
			version
		FROM perks_info 
		ORDER BY perk_id
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying perks: %v", err)
	}
	defer rows.Close()

	var perks []Perk
	for rows.Next() {
		var perk Perk
		err := rows.Scan(
			&perk.ID,
			&perk.Name,
			&perk.AssetID,
			&perk.Effect1ID,
			&perk.Factor1,
			&perk.Effect2ID,
			&perk.Factor2,
			&perk.Description,
			&perk.Version,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning perk row: %v", err)
		}

		// Process effects into structured format
		perk.Effects = make([]PerkEffect, 2)

		// Process Effect 1
		effectType1 := 0
		effectFactor1 := 1
		if perk.Effect1ID != nil {
			effectType1 = *perk.Effect1ID
		}
		if perk.Factor1 != nil {
			effectFactor1 = *perk.Factor1
		}
		perk.Effects[0] = PerkEffect{
			Type:   effectType1,
			Factor: effectFactor1,
		}

		// Process Effect 2
		effectType2 := 0
		effectFactor2 := 1
		if perk.Effect2ID != nil {
			effectType2 = *perk.Effect2ID
		}
		if perk.Factor2 != nil {
			effectFactor2 = *perk.Factor2
		}
		perk.Effects[1] = PerkEffect{
			Type:   effectType2,
			Factor: effectFactor2,
		}

		perks = append(perks, perk)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating perk rows: %v", err)
	}

	log.Printf("Successfully retrieved %d perks from database", len(perks))
	return perks, nil
}

// getPendingPerks retrieves all pending perks from tooling.perks_info
func getPendingPerks() ([]PendingPerk, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `
		SELECT 
			tooling_id,
			game_id,
			action,
			COALESCE(version, 1) as version,
			COALESCE(approved, false) as approved,
			perk_name,
			asset_id,
			effect_id_1,
			factor_1,
			effect_id_2,
			factor_2,
			description
		FROM tooling.perks_info 
		ORDER BY tooling_id DESC
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying pending perks: %v", err)
	}
	defer rows.Close()

	var perks []PendingPerk
	for rows.Next() {
		var perk PendingPerk
		err := rows.Scan(
			&perk.ToolingID,
			&perk.GameID,
			&perk.Action,
			&perk.Version,
			&perk.Approved,
			&perk.Name,
			&perk.AssetID,
			&perk.Effect1ID,
			&perk.Factor1,
			&perk.Effect2ID,
			&perk.Factor2,
			&perk.Description,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning pending perk row: %v", err)
		}
		perks = append(perks, perk)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating pending perk rows: %v", err)
	}

	log.Printf("Successfully retrieved %d pending perks from database", len(perks))
	return perks, nil
}

// handleCreatePerk handles POST requests to create or update a perk via tooling.create_perk
func handleCreatePerk(w http.ResponseWriter, r *http.Request) {
	log.Println("=== CREATE PERK REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to create perk")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req struct {
		ID          *int    `json:"id"`
		Name        string  `json:"name"`
		AssetID     int     `json:"assetID"`
		Effect1ID   *int    `json:"effect1_id"`
		Factor1     *int    `json:"factor1"`
		Effect2ID   *int    `json:"effect2_id"`
		Factor2     *int    `json:"factor2"`
		Description *string `json:"description"`
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing request JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("CREATE PERK REQUEST:")
	log.Printf("  ID: %v", req.ID)
	log.Printf("  Name: %s", req.Name)
	log.Printf("  AssetID: %d", req.AssetID)

	// Determine action based on whether ID is provided
	action := "insert"
	if req.ID != nil && *req.ID > 0 {
		action = "update"
	}

	// Call tooling.create_perk function
	var toolingID int
	err = db.QueryRow(`
		SELECT tooling.create_perk(
			$1::smallint,
			$2::text,
			$3::varchar,
			$4::integer,
			$5::smallint,
			$6::smallint,
			$7::smallint,
			$8::smallint,
			$9::varchar
		)
	`, req.ID, action, req.Name, req.AssetID,
		req.Effect1ID, req.Factor1, req.Effect2ID, req.Factor2, req.Description).Scan(&toolingID)

	if err != nil {
		log.Printf("Error calling tooling.create_perk: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create perk: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Perk created/updated successfully. Tooling ID: %d", toolingID)

	// Return success response
	response := map[string]interface{}{
		"success":   true,
		"toolingId": toolingID,
		"action":    action,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ CREATE PERK RESPONSE SENT")
}

// handleToggleApprovePerk handles POST requests to toggle perk approval status
func handleToggleApprovePerk(w http.ResponseWriter, r *http.Request) {
	log.Println("=== TOGGLE APPROVE PERK REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to toggle perk approval")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req struct {
		ToolingID int `json:"toolingId"`
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing request JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Toggle approval for perk tooling_id: %d", req.ToolingID)

	// Call tooling.toggle_approve_perk function
	_, err = db.Exec(`SELECT tooling.toggle_approve_perk($1)`, req.ToolingID)
	if err != nil {
		log.Printf("Error calling tooling.toggle_approve_perk: %v", err)
		http.Error(w, fmt.Sprintf("Failed to toggle approval: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Perk approval toggled successfully")

	// Return success response
	response := map[string]interface{}{
		"success": true,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ TOGGLE APPROVE PERK RESPONSE SENT")
}

// handleMergePerks handles POST requests to merge approved perks into game.perks_info
func handleMergePerks(w http.ResponseWriter, r *http.Request) {
	log.Println("=== MERGE PERKS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to merge perks")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Call tooling.merge_perks function
	_, err := db.Exec(`SELECT tooling.merge_perks()`)
	if err != nil {
		log.Printf("Error calling tooling.merge_perks: %v", err)
		http.Error(w, fmt.Sprintf("Failed to merge perks: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Perks merged successfully")

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"message": "Perks merged successfully",
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ MERGE PERKS RESPONSE SENT")
}

// handleGetPerkAssets handles GET requests to list available perk assets from S3
func handleGetPerkAssets(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET PERK ASSETS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to get perk assets")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		log.Printf("S3 client not available")
		http.Error(w, "S3 client not available", http.StatusInternalServerError)
		return
	}

	// List objects in the perks folder
	assets, err := listPerkAssets()
	if err != nil {
		log.Printf("Error listing perk assets: %v", err)
		http.Error(w, fmt.Sprintf("Failed to list perk assets: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("Found %d perk assets in S3", len(assets))

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"assets":  assets,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ GET PERK ASSETS RESPONSE SENT")
}

// listPerkAssets lists all perk assets from S3 bucket (images/perks/)
func listPerkAssets() ([]PerkAsset, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not initialized")
	}

	prefix := "images/perks/"

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 objects: %v", err)
	}

	var assets []PerkAsset
	for _, obj := range result.Contents {
		key := *obj.Key

		// Skip if not an image file
		ext := strings.ToLower(filepath.Ext(key))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" && ext != ".gif" {
			continue
		}

		// Extract filename without extension to get assetID
		filename := filepath.Base(key)
		nameWithoutExt := strings.TrimSuffix(filename, ext)

		// Try to parse as integer for assetID
		assetID, err := strconv.Atoi(nameWithoutExt)
		if err != nil {
			log.Printf("Non-numeric perk asset filename: %s, skipping", filename)
			continue
		}

		// Generate signed URL for the asset
		signedURL, err := generateSignedURL(key, 1*time.Hour)
		if err != nil {
			log.Printf("Failed to generate signed URL for %s: %v", key, err)
			continue
		}

		assets = append(assets, PerkAsset{
			AssetID: assetID,
			Name:    nameWithoutExt,
			Icon:    signedURL,
		})
	}

	log.Printf("Found %d perk assets in S3 bucket", len(assets))
	return assets, nil
}

// handleUploadPerkAsset handles POST requests to upload a new perk asset to S3
func handleUploadPerkAsset(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPLOAD PERK ASSET REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to upload perk asset")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		log.Printf("S3 client not available")
		http.Error(w, "S3 client not available", http.StatusInternalServerError)
		return
	}

	// Parse request body
	var req struct {
		AssetID     int    `json:"assetID"`
		ImageData   string `json:"imageData"`
		ContentType string `json:"contentType"`
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing request JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Uploading perk asset with ID: %d", req.AssetID)

	// Upload to S3
	s3Key, err := uploadPerkAssetToS3(req.ImageData, req.ContentType, req.AssetID)
	if err != nil {
		log.Printf("Error uploading to S3: %v", err)
		http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
		return
	}

	// Generate signed URL for the uploaded asset
	signedURL, err := generateSignedURL(s3Key, 1*time.Hour)
	if err != nil {
		log.Printf("Error generating signed URL: %v", err)
		signedURL = ""
	}

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"assetID": req.AssetID,
		"s3Key":   s3Key,
		"icon":    signedURL,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ UPLOAD PERK ASSET RESPONSE SENT - Asset ID: %d", req.AssetID)
}

// uploadPerkAssetToS3 uploads a perk asset to the perks folder in S3
func uploadPerkAssetToS3(imageData, contentType string, assetID int) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	log.Printf("Uploading perk asset to S3 with asset ID: %d", assetID)

	// Decode base64 image data
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	imageBytes, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	// Use asset ID as filename in the perks folder
	filename := fmt.Sprintf("images/perks/%d.webp", assetID)

	// Create S3 upload input
	uploadInput := &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String(contentType),
	}

	// Upload to S3
	_, err = s3Client.PutObject(context.TODO(), uploadInput)
	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Perk asset uploaded to S3: %s", filename)
	return filename, nil
}
