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

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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

	// Generate public URLs for item icons (S3 bucket is publicly accessible)
	for i := range items {
		if items[i].AssetID > 0 {
			// Direct public S3 URL
			items[i].Icon = fmt.Sprintf("https://%s.s3.%s.amazonaws.com/images/items/%d.webp",
				S3_BUCKET_NAME, S3_REGION, items[i].AssetID)
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
	"head":       true,
	"chest":      true,
	"hands":      true,
	"feet":       true,
	"belt":       true,
	"legs":       true,
	"back":       true,
	"amulet":     true,
	"weapon":     true,
	"hammer":     true,
	"gem":        true,
	"scroll":     true,
	"potion":     true,
	"ration":     true,
	"ingredient": true,
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
	// Note: We pass the type as text and cast it to game.item_type enum in the query
	query := `
		SELECT tooling.create_item(
			$1,  -- p_game_id (NULL for insert, item_id for update)
			$2,  -- p_action ('insert' or 'update')
			$3,  -- p_item_name
			$4,  -- p_asset_id
			$5::game.item_type,  -- p_type (cast text to game.item_type enum)
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

// handleMergeItems handles POST requests to merge approved items into game.items
func handleMergeItems(w http.ResponseWriter, r *http.Request) {
	log.Println("=== MERGE ITEMS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to merge items")
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

	if db == nil {
		log.Printf("Database not available")
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	// Call tooling.merge_items function
	_, err := db.Exec(`SELECT tooling.merge_items()`)
	if err != nil {
		log.Printf("Error calling tooling.merge_items: %v", err)
		http.Error(w, fmt.Sprintf("Failed to merge items: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Items merged successfully")

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"message": "Approved items merged successfully",
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ MERGE ITEMS RESPONSE SENT")
}

// ItemAsset represents an available item asset from S3
type ItemAsset struct {
	AssetID int    `json:"assetID"`
	Name    string `json:"name"`
	Icon    string `json:"icon"` // Signed URL
}

// handleGetItemAssets handles GET requests to list available item assets from S3
func handleGetItemAssets(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET ITEM ASSETS REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to get item assets")
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

	// List objects in the items folder
	assets, err := listItemAssets()
	if err != nil {
		log.Printf("Error listing item assets: %v", err)
		http.Error(w, fmt.Sprintf("Failed to list item assets: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("Found %d item assets in S3", len(assets))

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

	log.Printf("✅ GET ITEM ASSETS RESPONSE SENT")
}

// listItemAssets lists all item assets from S3 bucket (images/items/)
func listItemAssets() ([]ItemAsset, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not initialized")
	}

	prefix := "images/items/"

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 objects: %v", err)
	}

	var assets []ItemAsset
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
			// If not a number, use the filename as name and generate an ID
			log.Printf("Non-numeric asset filename: %s, skipping", filename)
			continue
		}

		// Direct public S3 URL
		publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
			S3_BUCKET_NAME, S3_REGION, key)

		assets = append(assets, ItemAsset{
			AssetID: assetID,
			Name:    nameWithoutExt,
			Icon:    publicURL,
		})
	}

	log.Printf("Found %d item assets in S3 bucket", len(assets))
	return assets, nil
}

// handleUploadItemAsset handles POST requests to upload a new item asset to S3
func handleUploadItemAsset(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPLOAD ITEM ASSET REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to upload item asset")
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

	log.Printf("Uploading item asset with ID: %d", req.AssetID)

	// Upload to S3 using custom key for items
	s3Key, err := uploadItemAssetToS3(req.ImageData, req.ContentType, req.AssetID)
	if err != nil {
		log.Printf("Error uploading to S3: %v", err)
		http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
		return
	}

	// Generate public URL for the uploaded asset
	publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
		S3_BUCKET_NAME, S3_REGION, s3Key)

	// Return success response
	response := map[string]interface{}{
		"success": true,
		"assetID": req.AssetID,
		"s3Key":   s3Key,
		"icon":    publicURL,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ UPLOAD ITEM ASSET RESPONSE SENT - Asset ID: %d", req.AssetID)
}

// uploadItemAssetToS3 uploads an item asset to the items folder in S3
func uploadItemAssetToS3(imageData, contentType string, assetID int) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	log.Printf("Uploading item asset to S3 with asset ID: %d", assetID)

	// Decode base64 image data
	// Remove data URL prefix if present (data:image/png;base64,...)
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

	// Use asset ID as filename in the items folder
	filename := fmt.Sprintf("images/items/%d.webp", assetID)

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

	log.Printf("Item asset uploaded to S3: %s", filename)
	return filename, nil
}

// getNextItemAssetID returns the next available asset ID for items
func getNextItemAssetID() (int, error) {
	if s3Client == nil {
		return 1, fmt.Errorf("S3 client not initialized")
	}

	// List existing item assets to find the highest ID
	assets, err := listItemAssets()
	if err != nil {
		return 1, err
	}

	maxID := 0
	for _, asset := range assets {
		if asset.AssetID > maxID {
			maxID = asset.AssetID
		}
	}

	return maxID + 1, nil
}
