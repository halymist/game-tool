package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// Item represents the database structure for items (game.items)
type Item struct {
	ID           int    `json:"id" db:"item_id"`
	Name         string `json:"name" db:"item_name"`
	AssetID      int    `json:"assetID" db:"asset_id"`
	Type         string `json:"type" db:"type"`
	Strength     *int   `json:"strength" db:"strength"`
	Stamina      *int   `json:"stamina" db:"stamina"`
	Agility      *int   `json:"agility" db:"agility"`
	Luck         *int   `json:"luck" db:"luck"`
	Armor        *int   `json:"armor" db:"armor"`
	EffectID     *int   `json:"effectID" db:"effect_id"`
	EffectFactor *int   `json:"effectFactor" db:"effect_factor"`
	Socket       bool   `json:"socket" db:"socket"`
	Silver       int    `json:"silver" db:"silver"`
	MinDamage    *int   `json:"minDamage" db:"min_damage"`
	MaxDamage    *int   `json:"maxDamage" db:"max_damage"`
	Version      int    `json:"version" db:"version"`
	Icon         string `json:"icon,omitempty"` // For signed URL
}

// PendingItem represents the database structure for pending items (tooling.items)
type PendingItem struct {
	ToolingID    int    `json:"toolingId" db:"tooling_id"`
	GameID       *int   `json:"gameId" db:"game_id"`
	Action       string `json:"action" db:"action"`
	Version      int    `json:"version" db:"version"`
	Name         string `json:"name" db:"item_name"`
	AssetID      int    `json:"assetID" db:"asset_id"`
	Type         string `json:"type" db:"type"`
	Strength     *int   `json:"strength" db:"strength"`
	Stamina      *int   `json:"stamina" db:"stamina"`
	Agility      *int   `json:"agility" db:"agility"`
	Luck         *int   `json:"luck" db:"luck"`
	Armor        *int   `json:"armor" db:"armor"`
	EffectID     *int   `json:"effectID" db:"effect_id"`
	EffectFactor *int   `json:"effectFactor" db:"effect_factor"`
	Socket       bool   `json:"socket" db:"socket"`
	Silver       int    `json:"silver" db:"silver"`
	MinDamage    *int   `json:"minDamage" db:"min_damage"`
	MaxDamage    *int   `json:"maxDamage" db:"max_damage"`
	Approved     bool   `json:"approved" db:"approved"`
}

// ItemsResponse represents the JSON response structure for items
type ItemsResponse struct {
	Success      bool          `json:"success"`
	Message      string        `json:"message,omitempty"`
	Effects      []Effect      `json:"effects,omitempty"`
	Items        []Item        `json:"items,omitempty"`
	PendingItems []PendingItem `json:"pendingItems,omitempty"`
}

// handleGetItems handles GET requests to retrieve all items with signed URLs
func handleGetItems(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET ITEMS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to get items")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get all effects
	effects, err := getAllEffects()
	if err != nil {
		log.Printf("Error getting effects: %v", err)
		response := ItemsResponse{
			Success: false,
			Message: fmt.Sprintf("Error getting effects: %v", err),
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	log.Printf("Retrieved %d effects", len(effects))

	// Get all items
	items, err := getAllItems()
	if err != nil {
		log.Printf("Error getting items: %v", err)
		response := ItemsResponse{
			Success: false,
			Message: fmt.Sprintf("Error getting items: %v", err),
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	log.Printf("Retrieved %d items from database", len(items))

	// Generate signed URLs for item icons
	for i := range items {
		if items[i].AssetID > 0 {
			// Generate S3 key for item icon
			iconKey := fmt.Sprintf("images/items/%d.webp", items[i].AssetID)

			// Generate signed URL with 1 hour expiration
			signedURL, err := generateSignedURL(iconKey, time.Hour)
			if err != nil {
				log.Printf("Warning: Failed to generate signed URL for item %d (assetID: %d): %v",
					items[i].ID, items[i].AssetID, err)
				items[i].Icon = ""
			} else {
				items[i].Icon = signedURL
				log.Printf("Generated signed URL for item %d (assetID: %d)", items[i].ID, items[i].AssetID)
			}
		}
	}

	// Get pending items from tooling.items
	pendingItems, err := getPendingItems()
	if err != nil {
		log.Printf("Warning: Error getting pending items: %v", err)
		// Don't fail the whole request, just log the warning
		pendingItems = []PendingItem{}
	}

	log.Printf("Retrieved %d pending items from tooling.items", len(pendingItems))

	// Create response
	response := ItemsResponse{
		Success:      true,
		Effects:      effects,
		Items:        items,
		PendingItems: pendingItems,
	}

	log.Printf("=== SENDING ITEMS RESPONSE ===")
	log.Printf("Effects count: %d", len(effects))
	log.Printf("Items count: %d", len(items))
	log.Printf("Pending items count: %d", len(pendingItems))

	// Send response
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding items response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Println("✅ Items data sent successfully")
}

// getAllItems retrieves all items from the database (game.items)
func getAllItems() ([]Item, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `
		SELECT 
			item_id, 
			item_name, 
			asset_id, 
			type,
			strength,
			stamina,
			agility,
			luck,
			armor,
			effect_id,
			effect_factor,
			socket,
			silver,
			min_damage,
			max_damage,
			version
		FROM game.items 
		ORDER BY item_id
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying items: %v", err)
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.AssetID,
			&item.Type,
			&item.Strength,
			&item.Stamina,
			&item.Agility,
			&item.Luck,
			&item.Armor,
			&item.EffectID,
			&item.EffectFactor,
			&item.Socket,
			&item.Silver,
			&item.MinDamage,
			&item.MaxDamage,
			&item.Version,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning item row: %v", err)
		}

		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating item rows: %v", err)
	}

	log.Printf("Successfully retrieved %d items from database", len(items))
	return items, nil
}

// CreateItemRequest represents the request body for creating an item
type CreateItemRequest struct {
	ID           *int   `json:"id"`
	Name         string `json:"name"`
	AssetID      int    `json:"assetID"`
	Type         string `json:"type"`
	Strength     *int   `json:"strength"`
	Stamina      *int   `json:"stamina"`
	Agility      *int   `json:"agility"`
	Luck         *int   `json:"luck"`
	Armor        *int   `json:"armor"`
	EffectID     *int   `json:"effectID"`
	EffectFactor *int   `json:"effectFactor"`
	Socket       bool   `json:"socket"`
	Silver       int    `json:"silver"`
	MinDamage    *int   `json:"minDamage"`
	MaxDamage    *int   `json:"maxDamage"`
	Icon         string `json:"icon,omitempty"`
}

// Valid item types (matches item_type enum in database)
var validItemTypes = map[string]bool{
	"head":   true,
	"chest":  true,
	"hands":  true,
	"feet":   true,
	"belt":   true,
	"legs":   true,
	"back":   true,
	"amulet": true,
	"weapon": true,
	"hammer": true,
	"gem":    true,
	"scroll": true,
	"potion": true,
}

// handleCreateItem handles POST requests to create or update items via tooling.create_item
func handleCreateItem(w http.ResponseWriter, r *http.Request) {
	log.Println("=== CREATE ITEM REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to create item")
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

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Parse JSON
	var req CreateItemRequest
	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("CREATE ITEM REQUEST:")
	log.Printf("  ID: %v", req.ID)
	log.Printf("  Name: %s", req.Name)
	log.Printf("  Type: %s", req.Type)
	log.Printf("  AssetID: %d", req.AssetID)

	if db == nil {
		log.Printf("Database not available")
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	// Validate item type
	if !validItemTypes[req.Type] {
		log.Printf("Invalid item type: %s", req.Type)
		http.Error(w, fmt.Sprintf("Invalid item type: %s", req.Type), http.StatusBadRequest)
		return
	}

	// Determine action: 'insert' for new, 'update' for existing
	action := "insert"
	var gameID *int = nil
	if req.ID != nil && *req.ID > 0 {
		action = "update"
		gameID = req.ID
	}

	// Call tooling.create_item function
	// Note: We pass the type as text and cast it to item_type enum in the query
	query := `
		SELECT tooling.create_item(
			$1,  -- p_game_id (NULL for insert, item_id for update)
			$2,  -- p_action ('insert' or 'update')
			$3,  -- p_item_name
			$4,  -- p_asset_id
			$5::item_type,  -- p_type (cast text to item_type enum)
			$6,  -- p_strength
			$7,  -- p_stamina
			$8,  -- p_agility
			$9,  -- p_luck
			$10, -- p_armor
			$11, -- p_effect_id
			$12, -- p_effect_factor
			$13, -- p_socket
			$14, -- p_silver
			$15, -- p_min_damage
			$16  -- p_max_damage
		)
	`

	var toolingID int
	err = db.QueryRow(
		query,
		gameID,
		action,
		req.Name,
		req.AssetID,
		req.Type,
		req.Strength,
		req.Stamina,
		req.Agility,
		req.Luck,
		req.Armor,
		req.EffectID,
		req.EffectFactor,
		req.Socket,
		req.Silver,
		req.MinDamage,
		req.MaxDamage,
	).Scan(&toolingID)

	if err != nil {
		log.Printf("Error calling tooling.create_item: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create item: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Item created/updated successfully. Tooling ID: %d", toolingID)

	// Return success response
	response := map[string]interface{}{
		"success":   true,
		"message":   fmt.Sprintf("Item %s successfully", action),
		"toolingId": toolingID,
		"action":    action,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ CREATE ITEM RESPONSE SENT")
}

// getPendingItems retrieves all pending items from tooling.items
func getPendingItems() ([]PendingItem, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `
		SELECT 
			tooling_id,
			game_id,
			action,
			COALESCE(version, 1) as version,
			item_name,
			asset_id,
			type,
			strength,
			stamina,
			agility,
			luck,
			armor,
			effect_id,
			effect_factor,
			socket,
			silver,
			min_damage,
			max_damage,
			COALESCE(approved, false) as approved
		FROM tooling.items 
		ORDER BY tooling_id DESC
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying pending items: %v", err)
	}
	defer rows.Close()

	var items []PendingItem
	for rows.Next() {
		var item PendingItem
		err := rows.Scan(
			&item.ToolingID,
			&item.GameID,
			&item.Action,
			&item.Version,
			&item.Name,
			&item.AssetID,
			&item.Type,
			&item.Strength,
			&item.Stamina,
			&item.Agility,
			&item.Luck,
			&item.Armor,
			&item.EffectID,
			&item.EffectFactor,
			&item.Socket,
			&item.Silver,
			&item.MinDamage,
			&item.MaxDamage,
			&item.Approved,
		)
		if err != nil {
			return nil, fmt.Errorf("error scanning pending item row: %v", err)
		}
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating pending item rows: %v", err)
	}

	log.Printf("Successfully retrieved %d pending items from database", len(items))
	return items, nil
}

// handleToggleApproveItem handles POST requests to toggle item approval status
func handleToggleApproveItem(w http.ResponseWriter, r *http.Request) {
	log.Println("=== TOGGLE APPROVE ITEM REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to toggle item approval")
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

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Parse JSON
	var req struct {
		ToolingID int `json:"toolingId"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Toggle approval for tooling_id: %d", req.ToolingID)

	if db == nil {
		log.Printf("Database not available")
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	// Call tooling.toggle_approve_item function
	_, err = db.Exec(`SELECT tooling.toggle_approve_item($1)`, req.ToolingID)
	if err != nil {
		log.Printf("Error calling tooling.toggle_approve_item: %v", err)
		http.Error(w, fmt.Sprintf("Failed to toggle approval: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Item approval toggled successfully for tooling_id: %d", req.ToolingID)

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"message": "Item approval toggled successfully",
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ TOGGLE APPROVE RESPONSE SENT")
}
