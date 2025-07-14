package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// EnemyMessage struct for win/lose messages
// Type: "onWin" or "onLose"
type EnemyMessage struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// Enemy struct for full enemy data
// Adjust field types as needed for your app
type Enemy struct {
	ID           interface{}              `json:"id,omitempty"`
	Name         string                   `json:"name"`
	Description  string                   `json:"description"`
	Stats        map[string]int           `json:"stats"`
	Effects      []map[string]interface{} `json:"effects"`
	Icon         string                   `json:"icon,omitempty"`
	IconKey      string                   `json:"iconKey,omitempty"`
	Messages     []EnemyMessage           `json:"messages,omitempty"`
	ImageChanged bool                     `json:"imageChanged,omitempty"`
}

func handleCreateEnemy(w http.ResponseWriter, r *http.Request) {
	// Only allow POST requests
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("CREATE ENEMY DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Parse JSON into Enemy struct
	var enemy Enemy
	if err := json.Unmarshal(body, &enemy); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Log the received enemy data
	log.Printf("CREATE ENEMY REQUEST:")
	log.Printf("  Name: %v", enemy.Name)
	log.Printf("  Description: %v", enemy.Description)
	log.Printf("  Stats: %v", enemy.Stats)
	log.Printf("  Effects: %v", enemy.Effects)
	log.Printf("  Icon: %v", enemy.Icon != "")
	log.Printf("  Messages: %v", enemy.Messages)

	// Validate icon is provided (required for new enemies)
	if enemy.Icon == "" {
		log.Printf("No icon provided for new enemy")
		http.Error(w, "Icon is required for new enemies", http.StatusBadRequest)
		return
	}

	// === STEP 1: Insert enemy into database to get assetID ===
	var enemyID int64
	var assetID int64
	if db != nil {
		log.Printf("Inserting enemy into database to get assetID...")

		// Build the INSERT query for Enemies table
		query := `INSERT INTO "Enemies" ("name", "description", "strength", "stamina", "agility", "luck", "armor"`
		values := []interface{}{enemy.Name, enemy.Description, enemy.Stats["strength"], enemy.Stats["stamina"], enemy.Stats["agility"], enemy.Stats["luck"], enemy.Stats["armor"]}

		// Add effect columns dynamically based on the effects array
		effectParams := make([]string, 0)
		for i, effect := range enemy.Effects {
			if i >= 10 { // Only handle up to 10 effects as per table schema
				break
			}

			effectMap := effect
			effectType := ""
			effectFactor := 1.0

			if typeVal, ok := effectMap["type"].(string); ok && typeVal != "" {
				effectType = typeVal
				if factorVal, ok := effectMap["factor"].(float64); ok {
					effectFactor = factorVal
				} else if factorInt, ok := effectMap["factor"].(int); ok {
					effectFactor = float64(factorInt)
				}

				// Add effect columns to query
				query += fmt.Sprintf(`, "effect%d_id", "effect%d_factor"`, i+1, i+1)
				effectParams = append(effectParams, fmt.Sprintf("$%d, $%d", len(values)+1, len(values)+2))
				values = append(values, effectType, effectFactor)
			}
		}

		// Complete the query - return both id and assetID
		query += `) VALUES ($1, $2, $3, $4, $5, $6, $7`
		for _, param := range effectParams {
			query += ", " + param
		}
		query += `) RETURNING "id", "assetID"`

		log.Printf("Executing query: %s", query)
		log.Printf("With values: %v", values)

		err := db.QueryRow(query, values...).Scan(&enemyID, &assetID)
		if err != nil {
			log.Printf("ERROR: Failed to insert enemy into database: %v", err)
			http.Error(w, "Failed to save enemy", http.StatusInternalServerError)
			return
		}

		log.Printf("SUCCESS: Enemy inserted with ID: %d, assetID: %d", enemyID, assetID)

		// === STEP 2: Upload icon to S3 using assetID as key ===
		log.Printf("Uploading enemy icon to S3 with assetID: %d", assetID)
		iconKey, err := uploadImageToS3WithCustomKey(enemy.Icon, "image/webp", fmt.Sprintf("%d", assetID))
		if err != nil {
			log.Printf("ERROR: Failed to upload image to S3: %v", err)
			// Since we already inserted the enemy, we should ideally rollback or handle this gracefully
			// For now, we'll return an error but the enemy record will exist without an icon
			http.Error(w, "Failed to upload image", http.StatusInternalServerError)
			return
		}

		log.Printf("SUCCESS: Image uploaded to S3 with key: %s", iconKey)

		// Insert messages into EnemyMessages table
		if len(enemy.Messages) > 0 {
			log.Printf("Inserting %d messages for enemy ID %d", len(enemy.Messages), enemyID)
			for _, message := range enemy.Messages {
				won := message.Type == "onWin"
				messageQuery := `INSERT INTO "EnemyMessages" ("enemy_id", "won", "message") VALUES ($1, $2, $3)`
				_, err := db.Exec(messageQuery, enemyID, won, message.Message)
				if err != nil {
					log.Printf("ERROR: Failed to insert message: %v", err)
					// Continue with other messages even if one fails
				} else {
					log.Printf("SUCCESS: Message inserted for enemy ID %d", enemyID)
				}
			}
		}

	} else {
		log.Printf("WARNING: Database not available, skipping insert")
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"message": "Enemy created successfully",
		"id":      enemyID,                    // Return actual database ID
		"assetID": assetID,                    // Return the assetID
		"iconKey": fmt.Sprintf("%d", assetID), // Return S3 key based on assetID
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("CREATE ENEMY SUCCESS - new enemy created with assetID: %d", assetID)
}

func handleUpdateEnemy(w http.ResponseWriter, r *http.Request) {
	// Only allow POST requests
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("UPDATE ENEMY DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Parse JSON
	var enemyData map[string]interface{}
	if err := json.Unmarshal(body, &enemyData); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Log the received enemy data
	log.Printf("UPDATE ENEMY REQUEST:")
	log.Printf("  Name: %v", enemyData["name"])
	log.Printf("  Description: %v", enemyData["description"])
	log.Printf("  Stats: %v", enemyData["stats"])
	log.Printf("  Effects: %v", enemyData["effects"])
	log.Printf("  ImageChanged: %v", enemyData["imageChanged"])
	log.Printf("  IconKey: %v", enemyData["iconKey"])
	log.Printf("  Messages: %v", enemyData["messages"])

	// Handle icon upload or preservation
	var iconKey string
	imageChanged, _ := enemyData["imageChanged"].(bool)

	if imageChanged {
		// Upload new icon to S3
		if iconData, ok := enemyData["icon"].(string); ok && iconData != "" {
			log.Printf("Uploading updated enemy icon to S3")
			key, err := uploadImageToS3(iconData, "image/webp")
			if err != nil {
				log.Printf("Error uploading image to S3: %v", err)
				http.Error(w, "Failed to upload image", http.StatusInternalServerError)
				return
			}
			iconKey = key
		} else {
			log.Printf("Image change flag set but no icon data provided")
			http.Error(w, "Icon data required when imageChanged is true", http.StatusBadRequest)
			return
		}
	} else {
		// Preserve existing icon
		if existingKey, ok := enemyData["iconKey"].(string); ok && existingKey != "" {
			iconKey = existingKey
			log.Printf("Preserving existing icon key: %s", iconKey)
		} else {
			log.Printf("No existing icon key provided for update")
			http.Error(w, "IconKey is required when imageChanged is false", http.StatusBadRequest)
			return
		}
	}

	// Here you would typically update the database
	// For now, we'll just return success

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"message": "Enemy updated successfully",
		"id":      "temp_id_123", // In real app, this would be the database ID
		"iconKey": iconKey,       // Return S3 key, not URL
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if imageChanged {
		log.Printf("UPDATE ENEMY SUCCESS - updated enemy with new iconKey: %s", iconKey)
	} else {
		log.Printf("UPDATE ENEMY SUCCESS - updated enemy preserving iconKey: %s", iconKey)
	}
}

func handleGetEnemies(w http.ResponseWriter, r *http.Request) {
	// Only allow GET requests
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("GET ENEMIES DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("GET ENEMIES REQUEST")

	// Mock data for now - replace with real database queries later
	effects := []map[string]interface{}{
		map[string]interface{}{"id": 1, "name": "Poison", "description": "Deals damage over time"},
		map[string]interface{}{"id": 2, "name": "Stun", "description": "Prevents actions for turns"},
		map[string]interface{}{"id": 3, "name": "Heal", "description": "Restores health"},
		map[string]interface{}{"id": 4, "name": "Burn", "description": "Fire damage over time"},
		map[string]interface{}{"id": 5, "name": "Shield", "description": "Reduces incoming damage"},
	}

	enemies := []map[string]interface{}{
		map[string]interface{}{
			"id":          1,
			"name":        "Bandit",
			"description": "A ruthless outlaw who preys on travelers. These criminals have honed their combat skills through countless skirmishes and ambushes.",
			"stats": map[string]interface{}{
				"strength": 15,
				"stamina":  100,
				"agility":  12,
				"luck":     5,
				"armor":    8,
			},
			"effects": []interface{}{
				map[string]interface{}{"type": "1", "factor": 2},
				map[string]interface{}{"type": "2", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
			},
			"iconKey": "images/enemies/1.webp",
			"messages": []EnemyMessage{
				{Type: "onWin", Message: "The bandit falls to the ground, defeated!"},
				{Type: "onWin", Message: "You have bested the bandit!"},
				{Type: "onLose", Message: "The bandit laughs as you fall!"},
			},
		},
		map[string]interface{}{
			"id":          2,
			"name":        "Fire Mage",
			"description": "A powerful spellcaster who has mastered the elemental forces of fire. Their spells can incinerate enemies and create walls of flame.",
			"stats": map[string]interface{}{
				"strength": 25,
				"stamina":  80,
				"agility":  8,
				"luck":     8,
				"armor":    5,
			},
			"effects": []interface{}{
				map[string]interface{}{"type": "4", "factor": 3},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
			},
			"iconKey": "images/enemies/2.webp",
		},
		map[string]interface{}{
			"id":          3,
			"name":        "Goblin Warrior",
			"description": "A fierce and cunning goblin warrior armed with crude but effective weapons. Despite their small stature, they are surprisingly agile and dangerous in combat.",
			"stats": map[string]interface{}{
				"strength": 12,
				"stamina":  70,
				"agility":  18,
				"luck":     3,
				"armor":    10,
			},
			"effects": []interface{}{
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
				map[string]interface{}{"type": "", "factor": 1},
			},
			"iconKey": "images/enemies/3.webp",
		},
	}

	// Generate signed URLs for enemy icons
	for _, enemy := range enemies {
		if iconKey, ok := enemy["iconKey"].(string); ok && iconKey != "" {
			signedURL, err := generateSignedURL(iconKey, 10*time.Minute) // 10 minute expiration
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for %s: %v", iconKey, err)
				// Keep the original key as fallback
			} else {
				// Add signed URL to the enemy object
				enemy["iconUrl"] = signedURL
				log.Printf("Generated signed URL for icon: %s", iconKey)
			}
		}
	}

	response := map[string]interface{}{
		"success": true,
		"effects": effects,
		"enemies": enemies,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("GET ENEMIES SUCCESS - returned %d effects, %d enemies", len(effects), len(enemies))
}

func handleGetEffects(w http.ResponseWriter, r *http.Request) {
	// Only allow GET requests
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("GET EFFECTS DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("GET EFFECTS REQUEST")

	var effects []map[string]interface{}

	if db != nil {
		log.Printf("Querying effects from database...")

		// Query all effects from the database
		rows, err := db.Query(`SELECT "id", "name", "description" FROM "Effects" ORDER BY "id"`)
		if err != nil {
			log.Printf("ERROR: Failed to query effects: %v", err)
			http.Error(w, "Failed to load effects", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		// Process each row
		for rows.Next() {
			var id int
			var name string
			var description *string // Use pointer for nullable field

			err := rows.Scan(&id, &name, &description)
			if err != nil {
				log.Printf("ERROR: Failed to scan effect row: %v", err)
				continue
			}

			// Create effect object
			effect := map[string]interface{}{
				"id":   id,
				"name": name,
			}

			// Add description if not null
			if description != nil {
				effect["description"] = *description
			} else {
				effect["description"] = ""
			}

			effects = append(effects, effect)
		}

		// Check for row iteration errors
		if err = rows.Err(); err != nil {
			log.Printf("ERROR: Row iteration error: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		log.Printf("SUCCESS: Loaded %d effects from database", len(effects))

	} else {
		log.Printf("WARNING: Database not available, returning empty effects")
		// Return empty array when database is not available
		effects = []map[string]interface{}{}
	}

	// Return response
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"effects": effects,
		"count":   len(effects),
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("GET EFFECTS SUCCESS - returned %d effects", len(effects))
}

func handleGetEnemyAssets(w http.ResponseWriter, r *http.Request) {
	// Only allow GET requests
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("GET ENEMY ASSETS DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("GET ENEMY ASSETS REQUEST")

	var assets []map[string]interface{}

	if db != nil {
		log.Printf("Querying distinct assetIDs from Enemies table...")

		// Query distinct assetIDs from the database where assetID is not null
		rows, err := db.Query(`SELECT DISTINCT "assetID" FROM "Enemies" WHERE "assetID" IS NOT NULL ORDER BY "assetID"`)
		if err != nil {
			log.Printf("ERROR: Failed to query enemy assets: %v", err)
			http.Error(w, "Failed to load enemy assets", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		// Process each row and generate signed URLs
		for rows.Next() {
			var assetID int

			err := rows.Scan(&assetID)
			if err != nil {
				log.Printf("ERROR: Failed to scan assetID row: %v", err)
				continue
			}

			// Generate S3 key from assetID
			s3Key := fmt.Sprintf("images/enemies/%d.webp", assetID)

			// Generate signed URL for this asset
			signedURL, err := generateSignedURL(s3Key, 30*time.Minute) // 30 minute expiration
			if err != nil {
				log.Printf("WARNING: Failed to generate signed URL for assetID %d: %v", assetID, err)
				// Skip this asset if we can't generate signed URL
				continue
			}

			// Create asset object
			asset := map[string]interface{}{
				"assetID": assetID,
				"texture": signedURL,
			}

			assets = append(assets, asset)
			log.Printf("Generated signed URL for assetID %d", assetID)
		}

		// Check for row iteration errors
		if err = rows.Err(); err != nil {
			log.Printf("ERROR: Row iteration error: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		log.Printf("SUCCESS: Loaded %d enemy assets from database", len(assets))

	} else {
		log.Printf("WARNING: Database not available, returning empty assets")
		// Return empty array when database is not available
		assets = []map[string]interface{}{}
	}

	// Return response
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"assets":  assets,
		"count":   len(assets),
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("GET ENEMY ASSETS SUCCESS - returned %d assets", len(assets))
}
