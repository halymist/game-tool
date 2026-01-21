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
