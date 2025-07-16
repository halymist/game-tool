package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// EnemyMessage struct for win/lose messages
// Type: "onWin" or "onLose"
type EnemyMessage struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// EnemyEffect represents an effect applied to an enemy with its factor
type EnemyEffect struct {
	Type   int `json:"type"`   // Effect ID (0 for empty/no effect)
	Factor int `json:"factor"` // Effect factor/multiplier
}

// Enemy struct for full enemy data
// Adjust field types as needed for your app
type Enemy struct {
	ID          interface{}    `json:"id,omitempty"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Stats       map[string]int `json:"stats"`
	Effects     []EnemyEffect  `json:"effects"`
	Icon        string         `json:"icon,omitempty"`
	AssetID     int            `json:"assetID,omitempty"`
	Messages    []EnemyMessage `json:"messages,omitempty"`
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
	log.Printf("CREATE/UPDATE ENEMY REQUEST:")
	log.Printf("  ID: %v", enemy.ID)
	log.Printf("  Name: %v", enemy.Name)
	log.Printf("  Description: %v", enemy.Description)
	log.Printf("  Stats: %v", enemy.Stats)
	log.Printf("  Effects: %v", enemy.Effects)
	log.Printf("  Icon: %v", enemy.Icon != "")
	log.Printf("  AssetID: %v", enemy.AssetID)
	log.Printf("  Messages: %v", enemy.Messages)

	// Check if this is an update or create based on the presence of ID
	if enemy.ID != nil && enemy.ID != "" {
		UpdateEnemy(w, enemy)
		return
	}

	log.Printf("Enemy has no ID, proceeding with create logic")

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

			// === STEP 1: Get next available assetID ===
			nextAssetID, assetErr := getNextAssetID()
			if assetErr != nil {
				log.Printf("Failed to get next asset ID: %v", assetErr)
				http.Error(w, "Failed to generate asset ID", http.StatusInternalServerError)
				return
			}
			finalAssetID = nextAssetID
			log.Printf("Using next available assetID: %d", finalAssetID)

			// === STEP 2: Insert enemy into database with explicit assetID ===
			query := `INSERT INTO "Enemies" ("name", "description", "strength", "stamina", "agility", "luck", "armor", "assetID"`
			values := []interface{}{enemy.Name, enemy.Description, enemy.Stats["strength"], enemy.Stats["stamina"], enemy.Stats["agility"], enemy.Stats["luck"], enemy.Stats["armor"], finalAssetID}

			// Add effect columns dynamically based on the effects array
			for i := 1; i <= 10; i++ {
				query += fmt.Sprintf(`, "effect%d_id", "effect%d_factor"`, i, i)
				if i <= len(enemy.Effects) {
					effect := enemy.Effects[i-1]

					// Use effect struct fields directly
					effectType := effect.Type
					effectFactor := effect.Factor

					// Use NULL for effect_id when effectType is 0 (empty)
					if effectType == 0 {
						values = append(values, nil, effectFactor)
					} else {
						values = append(values, effectType, effectFactor)
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
			query += `) RETURNING "id"`

			err := db.QueryRow(query, values...).Scan(&enemyID)
			if err != nil {
				log.Printf("Failed to insert enemy: %v", err)
				http.Error(w, "Failed to create enemy", http.StatusInternalServerError)
				return
			}

			log.Printf("Enemy inserted with ID: %d, using assetID: %d", enemyID, finalAssetID)

			// === STEP 3: Upload icon to S3 using assetID as key ===
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

					// Use effect struct fields directly
					effectType := effect.Type
					effectFactor := effect.Factor

					// Use NULL for effect_id when effectType is 0 (empty)
					if effectType == 0 {
						values = append(values, nil, effectFactor)
					} else {
						values = append(values, effectType, effectFactor)
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

		// Generate signed URL for the created enemy icon
		var signedURL string
		if finalAssetID > 0 {
			iconKey := fmt.Sprintf("images/enemies/%d.webp", finalAssetID)
			url, err := generateSignedURL(iconKey, 10*time.Minute)
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for new enemy: %v", err)
			} else {
				signedURL = url
			}
		}

		// Return success response with signed URL
		response := map[string]interface{}{
			"success":   true,
			"message":   "Enemy created successfully",
			"id":        enemyID,
			"assetID":   finalAssetID,
			"signedURL": signedURL,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)

		log.Printf("Created enemy ID %d with assetID: %d", enemyID, finalAssetID)

	}
}

// handleUpdateEnemyWithData handles updating an existing enemy with complete data
func UpdateEnemy(w http.ResponseWriter, enemy Enemy) {
	if db == nil {
		log.Printf("UPDATE ENEMY ERROR: Database not available")
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	// Extract enemy ID
	var enemyID int
	switch id := enemy.ID.(type) {
	case int:
		enemyID = id
	case float64:
		enemyID = int(id)
	case string:
		var err error
		if enemyID, err = strconv.Atoi(id); err != nil {
			log.Printf("Invalid enemy ID format: %v", id)
			http.Error(w, "Invalid enemy ID", http.StatusBadRequest)
			return
		}
	default:
		log.Printf("Unsupported enemy ID type: %T", id)
		http.Error(w, "Invalid enemy ID type", http.StatusBadRequest)
		return
	}

	var finalAssetID int

	// Determine if we need to upload a new image or use existing asset
	if enemy.Icon != "" && !strings.HasPrefix(enemy.Icon, "https://") {
		// We have base64 icon data - this means new/changed image
		// Always generate a new assetID for new image uploads

		newAssetID, err := getNextAssetID()
		if err != nil {
			log.Printf("Error getting next assetID: %v", err)
			http.Error(w, "Failed to generate asset ID", http.StatusInternalServerError)
			return
		}
		finalAssetID = newAssetID
		log.Printf("Generated new assetID for update: %d", finalAssetID)

		// Upload to S3 with new assetID
		_, err = uploadImageToS3WithCustomKey(enemy.Icon, "image/webp", fmt.Sprintf("%d", finalAssetID))
		if err != nil {
			log.Printf("Error uploading image to S3: %v", err)
			http.Error(w, "Failed to upload image", http.StatusInternalServerError)
			return
		}
	} else {
		// No new image data - preserve existing assetID
		finalAssetID = enemy.AssetID
		log.Printf("Preserving existing assetID: %d", finalAssetID)
	}

	// Update enemy in database
	query := `UPDATE "Enemies" SET "name" = $1, "description" = $2, "strength" = $3, "stamina" = $4, "agility" = $5, "luck" = $6, "armor" = $7, "assetID" = $8`
	values := []interface{}{enemy.Name, enemy.Description, enemy.Stats["strength"], enemy.Stats["stamina"], enemy.Stats["agility"], enemy.Stats["luck"], enemy.Stats["armor"], finalAssetID}

	// Add effect columns dynamically
	for i := 1; i <= 10; i++ {
		query += fmt.Sprintf(`, "effect%d_id" = $%d, "effect%d_factor" = $%d`, i, len(values)+1, i, len(values)+2)
		if i <= len(enemy.Effects) {
			effect := enemy.Effects[i-1]

			// Use effect struct fields directly
			effectType := effect.Type
			effectFactor := effect.Factor

			// Use NULL for effect_id when effectType is 0 (empty)
			if effectType == 0 {
				values = append(values, nil, effectFactor)
			} else {
				values = append(values, effectType, effectFactor)
			}
		} else {
			values = append(values, nil, 1) // Use nil for empty effects
		}
	}

	query += fmt.Sprintf(` WHERE "id" = $%d`, len(values)+1)
	values = append(values, enemyID)

	_, err := db.Exec(query, values...)
	if err != nil {
		log.Printf("Failed to update enemy: %v", err)
		http.Error(w, "Failed to update enemy", http.StatusInternalServerError)
		return
	}

	// Delete existing messages and insert new ones
	_, err = db.Exec(`DELETE FROM "EnemyMessages" WHERE "enemy_id" = $1`, enemyID)
	if err != nil {
		log.Printf("Failed to delete existing enemy messages: %v", err)
		// Continue anyway
	}

	// Insert new messages
	for _, message := range enemy.Messages {
		won := message.Type == "onWin"
		_, err = db.Exec(`INSERT INTO "EnemyMessages" ("enemy_id", "won", "message") VALUES ($1, $2, $3)`,
			enemyID, won, message.Message)
		if err != nil {
			log.Printf("Failed to insert enemy message: %v", err)
			// Continue with other messages even if one fails
		}
	}

	// Generate signed URL for the updated enemy icon
	var signedURL string
	if finalAssetID > 0 {
		iconKey := fmt.Sprintf("images/enemies/%d.webp", finalAssetID)
		url, err := generateSignedURL(iconKey, 60*time.Minute)
		if err != nil {
			log.Printf("Warning: Failed to generate signed URL for updated enemy: %v", err)
		} else {
			signedURL = url
		}
	}

	// Return success response with signed URL
	response := map[string]interface{}{
		"success":   true,
		"message":   "Enemy updated successfully",
		"id":        enemyID,
		"assetID":   finalAssetID,
		"signedURL": signedURL,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("Updated enemy ID %d with assetID: %d", enemyID, finalAssetID)
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

	var effects []map[string]interface{}
	var enemies []Enemy

	if db != nil {
		// First, get all effects
		effectRows, err := db.Query(`SELECT "id", "name", "description" FROM "Effects" ORDER BY "id"`)
		if err != nil {
			log.Printf("ERROR: Failed to query effects: %v", err)
			http.Error(w, "Failed to load effects", http.StatusInternalServerError)
			return
		}
		defer effectRows.Close()

		for effectRows.Next() {
			var id int
			var name string
			var description *string

			err := effectRows.Scan(&id, &name, &description)
			if err != nil {
				log.Printf("ERROR: Failed to scan effect row: %v", err)
				continue
			}

			effect := map[string]interface{}{
				"id":   id,
				"name": name,
			}

			if description != nil {
				effect["description"] = *description
			} else {
				effect["description"] = ""
			}

			effects = append(effects, effect)
		}

		// Now get all enemies with their complete data
		enemyQuery := `SELECT "id", "name", "description", "strength", "stamina", "agility", "luck", "armor", "assetID",
			"effect1_id", "effect1_factor", "effect2_id", "effect2_factor", "effect3_id", "effect3_factor",
			"effect4_id", "effect4_factor", "effect5_id", "effect5_factor", "effect6_id", "effect6_factor",
			"effect7_id", "effect7_factor", "effect8_id", "effect8_factor", "effect9_id", "effect9_factor",
			"effect10_id", "effect10_factor"
			FROM "Enemies" ORDER BY "id"`

		enemyRows, err := db.Query(enemyQuery)
		if err != nil {
			log.Printf("ERROR: Failed to query enemies: %v", err)
			http.Error(w, "Failed to load enemies", http.StatusInternalServerError)
			return
		}
		defer enemyRows.Close()

		for enemyRows.Next() {
			var enemy Enemy
			var id int
			var assetID *int
			var strength, stamina, agility, luck, armor int
			var effectIDs [10]*int
			var effectFactors [10]*float64 // Changed to *float64 to match DECIMAL(10,2) in database

			err := enemyRows.Scan(&id, &enemy.Name, &enemy.Description,
				&strength, &stamina, &agility, &luck, &armor,
				&assetID,
				&effectIDs[0], &effectFactors[0], &effectIDs[1], &effectFactors[1], &effectIDs[2], &effectFactors[2],
				&effectIDs[3], &effectFactors[3], &effectIDs[4], &effectFactors[4], &effectIDs[5], &effectFactors[5],
				&effectIDs[6], &effectFactors[6], &effectIDs[7], &effectFactors[7], &effectIDs[8], &effectFactors[8],
				&effectIDs[9], &effectFactors[9])

			if err != nil {
				log.Printf("ERROR: Failed to scan enemy row: %v", err)
				continue
			}

			// Set ID and AssetID
			enemy.ID = id
			if assetID != nil {
				enemy.AssetID = *assetID
			}

			// Initialize Stats map and populate it
			enemy.Stats = map[string]int{
				"strength": strength,
				"stamina":  stamina,
				"agility":  agility,
				"luck":     luck,
				"armor":    armor,
			}

			// Process effects
			enemy.Effects = make([]EnemyEffect, 10)
			for i := 0; i < 10; i++ {
				effectType := 0
				effectFactor := 1.0

				if effectIDs[i] != nil {
					effectType = *effectIDs[i]
				}
				if effectFactors[i] != nil {
					effectFactor = *effectFactors[i]
				}

				enemy.Effects[i] = EnemyEffect{
					Type:   effectType,
					Factor: int(effectFactor), // Convert to int for client compatibility
				}
			}

			// Get messages for this enemy
			messageQuery := `SELECT "won", "message" FROM "EnemyMessages" WHERE "enemy_id" = $1 ORDER BY "id"`
			messageRows, err := db.Query(messageQuery, id)
			if err != nil {
				log.Printf("WARNING: Failed to query messages for enemy %d: %v", id, err)
			} else {
				for messageRows.Next() {
					var won bool
					var message string
					err := messageRows.Scan(&won, &message)
					if err != nil {
						log.Printf("WARNING: Failed to scan message row for enemy %d: %v", id, err)
						continue
					}

					messageType := "onLose"
					if won {
						messageType = "onWin"
					}

					enemy.Messages = append(enemy.Messages, EnemyMessage{
						Type:    messageType,
						Message: message,
					})
				}
				messageRows.Close()
			}

			enemies = append(enemies, enemy)
		}

		log.Printf("SUCCESS: Loaded %d effects and %d enemies from database", len(effects), len(enemies))

	} else {
		log.Printf("WARNING: Database not available, returning empty data")
		effects = []map[string]interface{}{}
		enemies = []Enemy{}
	} // Generate signed URLs for enemy icons and set them in the Icon field
	for i := range enemies {
		if enemies[i].AssetID > 0 {
			// Convert assetID to S3 key format (matching the format used in handleGetEnemyAssets)
			iconKey := fmt.Sprintf("images/enemies/%d.webp", enemies[i].AssetID)
			signedURL, err := generateSignedURL(iconKey, 60*time.Minute) // 60 minute expiration
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for assetID %d: %v", enemies[i].AssetID, err)
				// Keep the icon field empty if we can't generate signed URL
			} else {
				// Set signed URL in the Icon field
				enemies[i].Icon = signedURL
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

	var effects []map[string]interface{}

	if db != nil {
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

	} else {
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
