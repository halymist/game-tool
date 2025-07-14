package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
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

	// Handle icon upload (required for new enemies)
	var iconKey string
	if enemy.Icon != "" {
		// Upload new icon to S3
		log.Printf("Uploading new enemy icon to S3")
		key, err := uploadImageToS3(enemy.Icon, "image/png")
		if err != nil {
			log.Printf("Error uploading image to S3: %v", err)
			http.Error(w, "Failed to upload image", http.StatusInternalServerError)
			return
		}
		iconKey = key
	} else {
		log.Printf("No icon provided for new enemy")
		http.Error(w, "Icon is required for new enemies", http.StatusBadRequest)
		return
	}

	// Here you would typically save to database
	// For now, we'll just return success

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"message": "Enemy created successfully",
		"id":      "temp_id_123", // In real app, this would be the database ID
		"iconKey": iconKey,       // Return S3 key, not URL
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("CREATE ENEMY SUCCESS - new enemy created with iconKey: %s", iconKey)
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
			key, err := uploadImageToS3(iconData, "image/png")
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
			"iconKey": "images/enemies/1.PNG",
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
			"iconKey": "images/enemies/1.PNG",
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
			"iconKey": "images/enemies/1.PNG",
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
