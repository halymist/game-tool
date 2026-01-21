package main

import (
	"encoding/json"
	"log"
	"net/http"

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
// NOTE: Enemy schema has changed - enemies are now in two tables
// This struct is kept for backwards compatibility but will need updating
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

// handleGetEnemies - TEMPORARILY DISABLED during schema refactor
// Enemies are now split into two tables in the new game schema
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

	log.Printf("GET ENEMIES REQUEST - TEMPORARILY DISABLED DURING REFACTOR")

	// Return empty data with message during refactor
	// Enemies are now split into two tables in the new schema
	response := map[string]interface{}{
		"success": true,
		"message": "Enemy data temporarily unavailable - schema refactor in progress",
		"effects": []interface{}{},
		"enemies": []interface{}{},
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("GET ENEMIES - returned placeholder response during refactor")
}

// handleGetEffects retrieves all effects from game.effects
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

	// Use the shared getAllEffects helper
	effects, err := getAllEffects()
	if err != nil {
		log.Printf("ERROR: Failed to get effects: %v", err)
		http.Error(w, "Failed to load effects", http.StatusInternalServerError)
		return
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

// ============================================================================
// TEMPORARILY DISABLED FUNCTIONS - AWAITING SCHEMA REFACTOR
// ============================================================================
//
// The following functions are commented out during the refactor:
// - handleCreateEnemy: Will use game.create_enemy() helper function
// - UpdateEnemy: Will use game.update_enemy() helper function
//
// Enemy data is now stored in two tables in the game schema.
// These functions will be reimplemented once the schema is finalized.
// ============================================================================
