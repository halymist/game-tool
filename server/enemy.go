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
	AssetID      int                      `json:"assetID,omitempty"`
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
	log.Printf("  AssetID: %v", enemy.AssetID)
	log.Printf("  Messages: %v", enemy.Messages)

	if db != nil {
		var enemyID int
		var finalAssetID int

		// Determine if this is a new asset or existing asset
		if enemy.AssetID == 0 {
			// === NEW ASSET CASE ===
			log.Printf("Creating enemy with NEW asset")

			// Validate icon is provided (required for new assets)
			if enemy.Icon == "" {
				http.Error(w, "Icon is required for new enemies", http.StatusBadRequest)
				return
			}

			// === STEP 1: Insert enemy into database to get new assetID ===
			query := `INSERT INTO "Enemies" ("name", "description", "strength", "stamina", "agility", "luck", "armor"`
			values := []interface{}{enemy.Name, enemy.Description, enemy.Stats["strength"], enemy.Stats["stamina"], enemy.Stats["agility"], enemy.Stats["luck"], enemy.Stats["armor"]}

			// Add effect columns dynamically based on the effects array
			for i := 1; i <= 10; i++ {
				query += fmt.Sprintf(`, "effect%d_id", "effect%d_factor"`, i, i)
				if i <= len(enemy.Effects) {
					effect := enemy.Effects[i-1]

					// Handle effect type as integer (0 for empty, actual ID for real effects)
					var effectType int
					if typeVal, ok := effect["type"].(float64); ok {
						effectType = int(typeVal)
					} else if typeInt, ok := effect["type"].(int); ok {
						effectType = typeInt
					} else {
						effectType = 0 // Default to 0 for invalid types
					}

					effectFactor, _ := effect["factor"].(float64)
					if effectFactor == 0 {
						effectFactor = 1
					}

					// Use NULL for effect_id when effectType is 0 (empty)
					if effectType == 0 {
						values = append(values, nil, int(effectFactor))
					} else {
						values = append(values, effectType, int(effectFactor))
					}
				} else {
					values = append(values, nil, 1) // Use nil for empty effects
				}
			}

			// Complete the query - ADD CLOSING PARENTHESIS and VALUES clause
			query += `) VALUES (`
			for i := 0; i < len(values); i++ {
				if i > 0 {
					query += ", "
				}
				query += fmt.Sprintf("$%d", i+1)
			}
			query += `) RETURNING "id", "assetID"`

			err := db.QueryRow(query, values...).Scan(&enemyID, &finalAssetID)
			if err != nil {
				log.Printf("Failed to insert enemy: %v", err)
				http.Error(w, "Failed to create enemy", http.StatusInternalServerError)
				return
			}

			log.Printf("Enemy inserted with ID: %d, assetID: %d", enemyID, finalAssetID)

			// === STEP 2: Upload icon to S3 using assetID as key ===
			log.Printf("Uploading enemy icon to S3 with assetID: %d", finalAssetID)
			iconKey, err := uploadImageToS3WithCustomKey(enemy.Icon, "image/webp", fmt.Sprintf("%d", finalAssetID))
			if err != nil {
				log.Printf("Failed to upload image to S3: %v", err)
				// Consider rolling back the database insert here
				http.Error(w, "Failed to upload image", http.StatusInternalServerError)
				return
			}

			log.Printf("Image uploaded successfully with key: %s", iconKey)

		} else {
			// === EXISTING ASSET CASE ===
			log.Printf("Creating enemy with EXISTING asset ID: %d", enemy.AssetID)

			// No icon upload needed - just insert with the provided assetID
			finalAssetID = enemy.AssetID

			// === Insert enemy into database with existing assetID ===
			query := `INSERT INTO "Enemies" ("name", "description", "strength", "stamina", "agility", "luck", "armor", "assetID"`
			values := []interface{}{enemy.Name, enemy.Description, enemy.Stats["strength"], enemy.Stats["stamina"], enemy.Stats["agility"], enemy.Stats["luck"], enemy.Stats["armor"], finalAssetID}

			// Add effect columns dynamically based on the effects array
			for i := 1; i <= 10; i++ {
				query += fmt.Sprintf(`, "effect%d_id", "effect%d_factor"`, i, i)
				if i <= len(enemy.Effects) {
					effect := enemy.Effects[i-1]

					// Handle effect type as integer (0 for empty, actual ID for real effects)
					var effectType int
					if typeVal, ok := effect["type"].(float64); ok {
						effectType = int(typeVal)
					} else if typeInt, ok := effect["type"].(int); ok {
						effectType = typeInt
					} else {
						effectType = 0 // Default to 0 for invalid types
					}

					effectFactor, _ := effect["factor"].(float64)
					if effectFactor == 0 {
						effectFactor = 1
					}

					// Use NULL for effect_id when effectType is 0 (empty)
					if effectType == 0 {
						values = append(values, nil, int(effectFactor))
					} else {
						values = append(values, effectType, int(effectFactor))
					}
				} else {
					values = append(values, nil, 1) // Use nil for empty effects
				}
			}

			// Complete the query - ADD VALUES clause for existing asset case
			query += `) VALUES (`
			for i := 0; i < len(values); i++ {
				if i > 0 {
					query += ", "
				}
				query += fmt.Sprintf("$%d", i+1)
			}
			query += `) RETURNING "id"`
			err := db.QueryRow(query, values...).Scan(&enemyID)
			if err != nil {
				log.Printf("Failed to insert enemy with existing asset: %v", err)
				http.Error(w, "Failed to create enemy", http.StatusInternalServerError)
				return
			}

			log.Printf("Enemy inserted with ID: %d, using existing assetID: %d", enemyID, finalAssetID)
		}

		// === Insert messages into EnemyMessages table ===
		for _, message := range enemy.Messages {
			won := message.Type == "onWin"
			_, err = db.Exec(`INSERT INTO "EnemyMessages" ("enemy_id", "won", "message") VALUES ($1, $2, $3)`,
				enemyID, won, message.Message)
			if err != nil {
				log.Printf("Failed to insert enemy message: %v", err)
				// Continue with other messages even if one fails
			}
		}

		log.Printf("Enemy creation completed successfully")

		// Return success response
		response := map[string]interface{}{
			"success": true,
			"message": "Enemy created successfully",
			"id":      enemyID,
			"assetID": finalAssetID,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)

	} else {
		// Mock response for testing without database
		log.Printf("MOCK: Enemy creation (no database)")
		mockAssetID := 999
		if enemy.AssetID > 0 {
			mockAssetID = enemy.AssetID
		}
		response := map[string]interface{}{
			"success": true,
			"message": "Enemy created successfully (mock mode)",
			"id":      999,
			"assetID": mockAssetID,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
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
	log.Printf("  AssetID: %v", enemyData["assetID"])
	log.Printf("  Messages: %v", enemyData["messages"])

	// Handle icon upload or preservation
	var assetID int
	imageChanged, _ := enemyData["imageChanged"].(bool)

	if imageChanged {
		// Upload new icon to S3 with generated assetID
		if iconData, ok := enemyData["icon"].(string); ok && iconData != "" {
			log.Printf("Uploading updated enemy icon to S3")

			// Generate a new assetID for the uploaded image
			assetID = int(time.Now().Unix()) // Use timestamp as unique ID

			key, err := uploadImageToS3WithCustomKey(iconData, "image/webp", fmt.Sprintf("%d", assetID))
			if err != nil {
				log.Printf("Error uploading image to S3: %v", err)
				http.Error(w, "Failed to upload image", http.StatusInternalServerError)
				return
			}
			log.Printf("SUCCESS: Image uploaded to S3 with key: %s for assetID: %d", key, assetID)
		} else {
			log.Printf("Image change flag set but no icon data provided")
			http.Error(w, "Icon data required when imageChanged is true", http.StatusBadRequest)
			return
		}
	} else {
		// Preserve existing assetID
		if existingAssetID, ok := enemyData["assetID"].(float64); ok && existingAssetID > 0 {
			assetID = int(existingAssetID)
			log.Printf("Preserving existing assetID: %d", assetID)
		} else {
			log.Printf("No existing assetID provided for update")
			http.Error(w, "assetID is required when imageChanged is false", http.StatusBadRequest)
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
		"assetID": assetID,       // Return assetID instead of iconKey
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	if imageChanged {
		log.Printf("UPDATE ENEMY SUCCESS - updated enemy with new assetID: %d", assetID)
	} else {
		log.Printf("UPDATE ENEMY SUCCESS - updated enemy preserving assetID: %d", assetID)
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
			"assetID": 1,
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
			"assetID": 2,
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
			"assetID": 3,
		},
	}

	// Generate signed URLs for enemy icons based on assetID
	for _, enemy := range enemies {
		if assetID, ok := enemy["assetID"].(int); ok && assetID > 0 {
			// Convert assetID to S3 key format
			iconKey := fmt.Sprintf("%d", assetID)
			signedURL, err := generateSignedURL(iconKey, 10*time.Minute) // 10 minute expiration
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for assetID %d: %v", assetID, err)
				// Keep the original assetID as fallback
			} else {
				// Add signed URL to the enemy object
				enemy["iconUrl"] = signedURL
				log.Printf("Generated signed URL for assetID: %d", assetID)
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
