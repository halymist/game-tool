package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// PerkEffect represents an effect applied to a perk with its factor
type PerkEffect struct {
	Type   int     `json:"type"`   // Effect ID (0 for empty/no effect)
	Factor float64 `json:"factor"` // Effect factor/multiplier
}

// Perk represents the database structure for perks
type Perk struct {
	ID            int          `json:"id" db:"id"`
	AssetID       int          `json:"assetID" db:"assetID"`
	Name          string       `json:"name" db:"name"`
	Description   *string      `json:"description" db:"description"`
	Effect1ID     *int         `json:"effect1_id" db:"effect1_id"`
	Effect1Factor *float64     `json:"effect1_factor" db:"effect1_factor"`
	Effect2ID     *int         `json:"effect2_id" db:"effect2_id"`
	Effect2Factor *float64     `json:"effect2_factor" db:"effect2_factor"`
	Effects       []PerkEffect `json:"effects,omitempty"` // Processed effects for client
	Icon          string       `json:"icon,omitempty"`    // For signed URL
}

// PerkResponse represents the JSON response structure for perks
type PerkResponse struct {
	Success bool     `json:"success"`
	Message string   `json:"message,omitempty"`
	Effects []Effect `json:"effects,omitempty"`
	Perks   []Perk   `json:"perks,omitempty"`
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

	// Create response
	response := PerkResponse{
		Success: true,
		Effects: effects,
		Perks:   perks,
	}

	log.Printf("=== SENDING PERKS RESPONSE ===")
	log.Printf("Effects count: %d", len(effects))
	log.Printf("Perks count: %d", len(perks))

	// Send response
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding perks response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Println("✅ Perks data sent successfully")
}

// getAllPerks retrieves all perks from the database
func getAllPerks() ([]Perk, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `
		SELECT 
			"id", 
			"assetID", 
			"name", 
			"description", 
			"effect1_id", 
			"effect1_factor", 
			"effect2_id", 
			"effect2_factor"
		FROM "Perks" 
		ORDER BY "id"
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
			&perk.AssetID,
			&perk.Name,
			&perk.Description,
			&perk.Effect1ID,
			&perk.Effect1Factor,
			&perk.Effect2ID,
			&perk.Effect2Factor,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning perk row: %v", err)
		}

		// Process effects into structured format (similar to enemy.go)
		perk.Effects = make([]PerkEffect, 2)

		// Process Effect 1
		effectType1 := 0
		effectFactor1 := 1.0
		if perk.Effect1ID != nil {
			effectType1 = *perk.Effect1ID
		}
		if perk.Effect1Factor != nil {
			effectFactor1 = *perk.Effect1Factor
		}
		perk.Effects[0] = PerkEffect{
			Type:   effectType1,
			Factor: effectFactor1,
		}

		// Process Effect 2
		effectType2 := 0
		effectFactor2 := 1.0
		if perk.Effect2ID != nil {
			effectType2 = *perk.Effect2ID
		}
		if perk.Effect2Factor != nil {
			effectFactor2 = *perk.Effect2Factor
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
