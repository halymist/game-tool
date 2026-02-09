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

// Settlement represents a settlement from game.world_info
type Settlement struct {
	SettlementID          int              `json:"settlement_id"`
	SettlementName        string           `json:"settlement_name"`
	Faction               *int             `json:"faction"`
	Blacksmith            bool             `json:"blacksmith"`
	Alchemist             bool             `json:"alchemist"`
	Enchanter             bool             `json:"enchanter"`
	Trainer               bool             `json:"trainer"`
	Church                bool             `json:"church"`
	Blessing1             *int             `json:"blessing1"`
	Blessing2             *int             `json:"blessing2"`
	Blessing3             *int             `json:"blessing3"`
	SettlementAssetID     *int             `json:"settlement_asset_id"`
	VendorAssetID         *int             `json:"vendor_asset_id"`
	BlacksmithAssetID     *int             `json:"blacksmith_asset_id"`
	AlchemistAssetID      *int             `json:"alchemist_asset_id"`
	EnchanterAssetID      *int             `json:"enchanter_asset_id"`
	TrainerAssetID        *int             `json:"trainer_asset_id"`
	ChurchAssetID         *int             `json:"church_asset_id"`
	Description           *string          `json:"description"`
	KeyIssues             *string          `json:"key_issues"`
	RecentEvents          *string          `json:"recent_events"`
	Context               *string          `json:"context"`
	Version               int              `json:"version"`
	ExpeditionAssetID     *int             `json:"expedition_asset_id"`
	ExpeditionDescription *string          `json:"expedition_description"`
	ArenaAssetID          *int             `json:"arena_asset_id"`
	VendorOnEntered       *json.RawMessage `json:"vendor_on_entered"`
	VendorOnSold          *json.RawMessage `json:"vendor_on_sold"`
	VendorOnBought        *json.RawMessage `json:"vendor_on_bought"`
	UtilityOnEntered      *json.RawMessage `json:"utility_on_entered"`
	UtilityOnPlaced       *json.RawMessage `json:"utility_on_placed"`
	UtilityOnAction       *json.RawMessage `json:"utility_on_action"`
	VendorItems           []int            `json:"vendor_items"`
	EnchanterEffects      []int            `json:"enchanter_effects"`
	Locations             []Location       `json:"locations"`
}

// Location represents a location tied to a settlement
type Location struct {
	LocationID  int64  `json:"location_id,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	TextureID   *int   `json:"texture_id"`
}

// SettlementAsset represents an asset from S3
type SettlementAsset struct {
	ID  int    `json:"id"`
	URL string `json:"url"`
}

// GetSettlementsResponse is the response for loading settlements
type GetSettlementsResponse struct {
	Success     bool         `json:"success"`
	Settlements []Settlement `json:"settlements"`
}

// GetSettlementAssetsResponse is the response for loading settlement assets
type GetSettlementAssetsResponse struct {
	Success bool              `json:"success"`
	Assets  []SettlementAsset `json:"assets"`
}

// SaveSettlementRequest is the request for saving a settlement
type SaveSettlementRequest struct {
	SettlementID          *int             `json:"settlement_id"`
	SettlementName        string           `json:"settlement_name"`
	Faction               *int             `json:"faction"`
	Blacksmith            bool             `json:"blacksmith"`
	Alchemist             bool             `json:"alchemist"`
	Enchanter             bool             `json:"enchanter"`
	Trainer               bool             `json:"trainer"`
	Church                bool             `json:"church"`
	Blessing1             *int             `json:"blessing1"`
	Blessing2             *int             `json:"blessing2"`
	Blessing3             *int             `json:"blessing3"`
	SettlementAssetID     *int             `json:"settlement_asset_id"`
	VendorAssetID         *int             `json:"vendor_asset_id"`
	BlacksmithAssetID     *int             `json:"blacksmith_asset_id"`
	AlchemistAssetID      *int             `json:"alchemist_asset_id"`
	EnchanterAssetID      *int             `json:"enchanter_asset_id"`
	TrainerAssetID        *int             `json:"trainer_asset_id"`
	ChurchAssetID         *int             `json:"church_asset_id"`
	Description           *string          `json:"description"`
	KeyIssues             *string          `json:"key_issues"`
	RecentEvents          *string          `json:"recent_events"`
	Context               *string          `json:"context"`
	ExpeditionAssetID     *int             `json:"expedition_asset_id"`
	ExpeditionDescription *string          `json:"expedition_description"`
	ArenaAssetID          *int             `json:"arena_asset_id"`
	VendorOnEntered       *json.RawMessage `json:"vendor_on_entered"`
	VendorOnSold          *json.RawMessage `json:"vendor_on_sold"`
	VendorOnBought        *json.RawMessage `json:"vendor_on_bought"`
	UtilityOnEntered      *json.RawMessage `json:"utility_on_entered"`
	UtilityOnPlaced       *json.RawMessage `json:"utility_on_placed"`
	UtilityOnAction       *json.RawMessage `json:"utility_on_action"`
	VendorItems           []int            `json:"vendor_items"`
	EnchanterEffects      []int            `json:"enchanter_effects"`
	Locations             []Location       `json:"locations"`
}

// SaveSettlementResponse is the response after saving a settlement
type SaveSettlementResponse struct {
	Success      bool `json:"success"`
	SettlementID int  `json:"settlementId"`
}

// UploadSettlementAssetRequest is the request for uploading an asset
type UploadSettlementAssetRequest struct {
	Filename    string `json:"filename"`
	Data        string `json:"data"` // base64 encoded
	ContentType string `json:"contentType"`
}

// UploadSettlementAssetResponse is the response after uploading
type UploadSettlementAssetResponse struct {
	Success bool   `json:"success"`
	AssetID int    `json:"assetId"`
	URL     string `json:"url"`
}

// handleGetSettlements returns all settlements from game.world_info
func handleGetSettlements(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify authentication
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	log.Println("=== GET SETTLEMENTS REQUEST ===")

	rows, err := db.Query(`
		SELECT settlement_id, COALESCE(settlement_name, ''), faction, 
		       COALESCE(blacksmith, false), COALESCE(alchemist, false), 
		       COALESCE(enchanter, false), COALESCE(trainer, false), COALESCE(church, false),
		       blessing1, blessing2, blessing3,
		       settlement_asset_id, vendor_asset_id, blacksmith_asset_id, alchemist_asset_id,
		       enchanter_asset_id, trainer_asset_id, church_asset_id,
		       description, key_issues, recent_events, context, COALESCE(version, 1),
		       expedition_asset_id, expedition_description, arena_asset_id,
		       vendor_on_entered, vendor_on_sold, vendor_on_bought,
		       utility_on_entered, utility_on_placed, utility_on_action
		FROM game.world_info
		ORDER BY settlement_id
	`)
	if err != nil {
		log.Printf("Failed to query settlements: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var settlements []Settlement
	for rows.Next() {
		var s Settlement
		err := rows.Scan(
			&s.SettlementID, &s.SettlementName, &s.Faction,
			&s.Blacksmith, &s.Alchemist, &s.Enchanter, &s.Trainer, &s.Church,
			&s.Blessing1, &s.Blessing2, &s.Blessing3,
			&s.SettlementAssetID, &s.VendorAssetID, &s.BlacksmithAssetID, &s.AlchemistAssetID,
			&s.EnchanterAssetID, &s.TrainerAssetID, &s.ChurchAssetID,
			&s.Description, &s.KeyIssues, &s.RecentEvents, &s.Context, &s.Version,
			&s.ExpeditionAssetID, &s.ExpeditionDescription, &s.ArenaAssetID,
			&s.VendorOnEntered, &s.VendorOnSold, &s.VendorOnBought,
			&s.UtilityOnEntered, &s.UtilityOnPlaced, &s.UtilityOnAction,
		)
		if err != nil {
			log.Printf("Failed to scan settlement: %v", err)
			continue
		}
		settlements = append(settlements, s)
	}

	// Load vendor and enchanter inventory for each settlement
	for i := range settlements {
		// Load vendor items
		vendorRows, err := db.Query(`SELECT item_id FROM game.vendor_inventory WHERE settlement_id = $1`, settlements[i].SettlementID)
		if err == nil {
			for vendorRows.Next() {
				var itemID int
				if err := vendorRows.Scan(&itemID); err == nil {
					settlements[i].VendorItems = append(settlements[i].VendorItems, itemID)
				}
			}
			vendorRows.Close()
		}

		// Load enchanter effects
		enchanterRows, err := db.Query(`SELECT effect_id FROM game.enchanter_inventory WHERE settlement_id = $1`, settlements[i].SettlementID)
		if err == nil {
			for enchanterRows.Next() {
				var effectID int
				if err := enchanterRows.Scan(&effectID); err == nil {
					settlements[i].EnchanterEffects = append(settlements[i].EnchanterEffects, effectID)
				}
			}
			enchanterRows.Close()
		}

		// Load locations
		locationRows, err := db.Query(`SELECT location_id, name, COALESCE(description, ''), asset_id FROM game.locations WHERE settlement_id = $1 ORDER BY location_id`, settlements[i].SettlementID)
		if err == nil {
			for locationRows.Next() {
				var loc Location
				if err := locationRows.Scan(&loc.LocationID, &loc.Name, &loc.Description, &loc.TextureID); err == nil {
					settlements[i].Locations = append(settlements[i].Locations, loc)
				}
			}
			locationRows.Close()
		}
	}

	log.Printf("✅ Loaded %d settlements", len(settlements))

	response := GetSettlementsResponse{
		Success:     true,
		Settlements: settlements,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleGetSettlementAssets returns all settlement assets from S3
func handleGetSettlementAssets(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET SETTLEMENT ASSETS REQUEST ===")

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify authentication
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if s3Client == nil {
		http.Error(w, "S3 client not initialized", http.StatusInternalServerError)
		return
	}

	// List objects in settlements folder
	prefix := "images/settlements/"
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		log.Printf("Failed to list settlement assets: %v", err)
		http.Error(w, "Failed to list assets", http.StatusInternalServerError)
		return
	}

	var assets []SettlementAsset
	for _, obj := range result.Contents {
		if obj.Key == nil || *obj.Key == prefix {
			continue
		}

		// Extract asset ID from filename (e.g., "settlements/5.webp" -> 5)
		key := *obj.Key
		filename := strings.TrimPrefix(key, prefix)
		// Remove extension
		baseName := strings.TrimSuffix(filename, filepath.Ext(filename))
		assetID, err := strconv.Atoi(baseName)
		if err != nil {
			log.Printf("Skipping non-numeric asset: %s", key)
			continue
		}

		// Generate presigned URL
		presignInput := &s3.GetObjectInput{
			Bucket: aws.String(S3_BUCKET_NAME),
			Key:    obj.Key,
		}
		presignResult, err := s3Presigner.PresignGetObject(context.TODO(), presignInput, func(opts *s3.PresignOptions) {
			opts.Expires = time.Hour * 24
		})
		if err != nil {
			log.Printf("Failed to presign URL for %s: %v", *obj.Key, err)
			continue
		}

		assets = append(assets, SettlementAsset{
			ID:  assetID,
			URL: presignResult.URL,
		})
	}

	log.Printf("Loaded %d settlement assets", len(assets))

	response := GetSettlementAssetsResponse{
		Success: true,
		Assets:  assets,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleUploadSettlementAsset uploads a new settlement asset to S3
func handleUploadSettlementAsset(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPLOAD SETTLEMENT ASSET REQUEST ===")

	// Check authentication
	if !isAuthenticated(r) {
		log.Println("Unauthorized request to upload settlement asset")
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

	log.Printf("Uploading settlement asset with ID: %d", req.AssetID)

	// Get next asset ID if not provided
	assetID := req.AssetID
	if assetID == 0 {
		assetID, err = getNextSettlementAssetID()
		if err != nil {
			log.Printf("Failed to get next asset ID: %v", err)
			assetID = 1
		}
	}

	// Decode base64 image data
	imageData := req.ImageData
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	data, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		log.Printf("Error decoding base64: %v", err)
		http.Error(w, "Invalid base64 data", http.StatusBadRequest)
		return
	}

	// Use asset ID as filename with .webp extension in settlements folder
	key := fmt.Sprintf("images/settlements/%d.webp", assetID)

	// Upload to S3 as webp
	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("image/webp"),
	})
	if err != nil {
		log.Printf("Error uploading to S3: %v", err)
		http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
		return
	}

	// Generate public URL for the uploaded asset
	publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
		S3_BUCKET_NAME, S3_REGION, key)

	// Return success response (consistent with quest asset endpoint)
	response := map[string]interface{}{
		"success": true,
		"assetId": assetID,
		"s3Key":   key,
		"url":     publicURL,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ UPLOAD SETTLEMENT ASSET RESPONSE SENT - Asset ID: %d", assetID)
}

// getNextSettlementAssetID returns the next available asset ID for settlements
func getNextSettlementAssetID() (int, error) {
	if s3Client == nil {
		return 1, fmt.Errorf("S3 client not initialized")
	}

	// List existing settlement assets to find the highest ID
	prefix := "images/settlements/"
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return 1, err
	}

	maxID := 0
	for _, obj := range result.Contents {
		if obj.Key == nil || *obj.Key == prefix {
			continue
		}

		key := *obj.Key
		filename := strings.TrimPrefix(key, prefix)
		baseName := strings.TrimSuffix(filename, filepath.Ext(filename))
		assetID, err := strconv.Atoi(baseName)
		if err != nil {
			continue
		}

		if assetID > maxID {
			maxID = assetID
		}
	}

	return maxID + 1, nil
}

// handleSaveSettlement saves or updates a settlement
func handleSaveSettlement(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify authentication
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	var req SaveSettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var settlementID int

	if req.SettlementID != nil && *req.SettlementID > 0 {
		// Update existing settlement - increment version
		_, err := db.Exec(`
			UPDATE game.world_info SET
				settlement_name = $1, faction = $2,
				blacksmith = $3, alchemist = $4, enchanter = $5, trainer = $6, church = $7,
				blessing1 = $8, blessing2 = $9, blessing3 = $10,
				settlement_asset_id = $11, vendor_asset_id = $12, blacksmith_asset_id = $13, alchemist_asset_id = $14,
				enchanter_asset_id = $15, trainer_asset_id = $16, church_asset_id = $17,
				description = $18, key_issues = $19, recent_events = $20, context = $21,
				expedition_asset_id = $22, expedition_description = $23, arena_asset_id = $24,
				vendor_on_entered = $25, vendor_on_sold = $26, vendor_on_bought = $27,
				utility_on_entered = $28, utility_on_placed = $29, utility_on_action = $30,
				version = (SELECT COALESCE(MAX(version), 0) + 1 FROM game.world_info)
			WHERE settlement_id = $31
		`, req.SettlementName, req.Faction,
			req.Blacksmith, req.Alchemist, req.Enchanter, req.Trainer, req.Church,
			req.Blessing1, req.Blessing2, req.Blessing3,
			req.SettlementAssetID, req.VendorAssetID, req.BlacksmithAssetID, req.AlchemistAssetID,
			req.EnchanterAssetID, req.TrainerAssetID, req.ChurchAssetID,
			req.Description, req.KeyIssues, req.RecentEvents, req.Context,
			req.ExpeditionAssetID, req.ExpeditionDescription, req.ArenaAssetID,
			req.VendorOnEntered, req.VendorOnSold, req.VendorOnBought,
			req.UtilityOnEntered, req.UtilityOnPlaced, req.UtilityOnAction,
			*req.SettlementID)

		if err != nil {
			log.Printf("Failed to update settlement: %v", err)
			http.Error(w, "Failed to update settlement", http.StatusInternalServerError)
			return
		}
		settlementID = *req.SettlementID
		log.Printf("Updated settlement %d", settlementID)
	} else {
		// Insert new settlement - version auto-increments
		err := db.QueryRow(`
			INSERT INTO game.world_info (
				settlement_name, faction,
				blacksmith, alchemist, enchanter, trainer, church,
				blessing1, blessing2, blessing3,
				settlement_asset_id, vendor_asset_id, blacksmith_asset_id, alchemist_asset_id,
				enchanter_asset_id, trainer_asset_id, church_asset_id,
				description, key_issues, recent_events, context,
				expedition_asset_id, expedition_description, arena_asset_id,
				vendor_on_entered, vendor_on_sold, vendor_on_bought,
				utility_on_entered, utility_on_placed, utility_on_action,
				version
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
				$19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
				(SELECT COALESCE(MAX(version), 0) + 1 FROM game.world_info)
			) RETURNING settlement_id
		`, req.SettlementName, req.Faction,
			req.Blacksmith, req.Alchemist, req.Enchanter, req.Trainer, req.Church,
			req.Blessing1, req.Blessing2, req.Blessing3,
			req.SettlementAssetID, req.VendorAssetID, req.BlacksmithAssetID, req.AlchemistAssetID,
			req.EnchanterAssetID, req.TrainerAssetID, req.ChurchAssetID,
			req.Description, req.KeyIssues, req.RecentEvents, req.Context,
			req.ExpeditionAssetID, req.ExpeditionDescription, req.ArenaAssetID,
			req.VendorOnEntered, req.VendorOnSold, req.VendorOnBought,
			req.UtilityOnEntered, req.UtilityOnPlaced, req.UtilityOnAction).Scan(&settlementID)

		if err != nil {
			log.Printf("Failed to insert settlement: %v", err)
			http.Error(w, "Failed to create settlement", http.StatusInternalServerError)
			return
		}
		log.Printf("Created new settlement %d", settlementID)
	}

	response := SaveSettlementResponse{
		Success:      true,
		SettlementID: settlementID,
	}

	// Save vendor inventory (delete and re-insert)
	if len(req.VendorItems) > 0 || req.SettlementID != nil {
		// Delete existing vendor items for this settlement
		_, err := db.Exec(`DELETE FROM game.vendor_inventory WHERE settlement_id = $1`, settlementID)
		if err != nil {
			log.Printf("Warning: Failed to delete vendor inventory: %v", err)
		}

		// Insert new vendor items
		for _, itemID := range req.VendorItems {
			_, err := db.Exec(`INSERT INTO game.vendor_inventory (settlement_id, item_id) VALUES ($1, $2)`,
				settlementID, itemID)
			if err != nil {
				log.Printf("Warning: Failed to insert vendor item %d: %v", itemID, err)
			}
		}
		log.Printf("Saved %d vendor items for settlement %d", len(req.VendorItems), settlementID)
	}

	// Save enchanter inventory (delete and re-insert)
	if len(req.EnchanterEffects) > 0 || req.SettlementID != nil {
		// Delete existing enchanter effects for this settlement
		_, err := db.Exec(`DELETE FROM game.enchanter_inventory WHERE settlement_id = $1`, settlementID)
		if err != nil {
			log.Printf("Warning: Failed to delete enchanter inventory: %v", err)
		}

		// Insert new enchanter effects
		for _, effectID := range req.EnchanterEffects {
			_, err := db.Exec(`INSERT INTO game.enchanter_inventory (settlement_id, effect_id) VALUES ($1, $2)`,
				settlementID, effectID)
			if err != nil {
				log.Printf("Warning: Failed to insert enchanter effect %d: %v", effectID, err)
			}
		}
		log.Printf("Saved %d enchanter effects for settlement %d", len(req.EnchanterEffects), settlementID)
	}

	// Save locations - delete removed ones and upsert the rest
	if req.SettlementID != nil {
		// Get existing location IDs for this settlement
		existingIDs := make(map[int64]bool)
		rows, err := db.Query(`SELECT location_id FROM game.locations WHERE settlement_id = $1`, settlementID)
		if err == nil {
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil {
					existingIDs[id] = true
				}
			}
			rows.Close()
		}

		// Track which IDs are still present in the request
		keepIDs := make(map[int64]bool)
		for _, loc := range req.Locations {
			if loc.LocationID > 0 {
				keepIDs[loc.LocationID] = true
			}
		}

		// Delete locations that are no longer in the request
		for id := range existingIDs {
			if !keepIDs[id] {
				_, err := db.Exec(`DELETE FROM game.locations WHERE location_id = $1`, id)
				if err != nil {
					log.Printf("Warning: Failed to delete location %d: %v", id, err)
				} else {
					log.Printf("Deleted location %d", id)
				}
			}
		}
	}

	// Upsert locations
	for _, loc := range req.Locations {
		if loc.LocationID > 0 {
			// Update existing location
			_, err := db.Exec(`UPDATE game.locations SET name = $1, description = $2, asset_id = $3 WHERE location_id = $4`,
				loc.Name, loc.Description, loc.TextureID, loc.LocationID)
			if err != nil {
				log.Printf("Warning: Failed to update location %d: %v", loc.LocationID, err)
			}
		} else {
			// Insert new location
			_, err := db.Exec(`INSERT INTO game.locations (settlement_id, name, description, asset_id) VALUES ($1, $2, $3, $4)`,
				settlementID, loc.Name, loc.Description, loc.TextureID)
			if err != nil {
				log.Printf("Warning: Failed to insert location: %v", err)
			}
		}
	}
	log.Printf("Saved %d locations for settlement %d", len(req.Locations), settlementID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleDeleteSettlement deletes a settlement
func handleDeleteSettlement(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify authentication
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	var req struct {
		SettlementID int `json:"settlementId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Delete locations first (due to foreign key)
	_, err := db.Exec(`DELETE FROM game.locations WHERE settlement_id = $1`, req.SettlementID)
	if err != nil {
		log.Printf("Warning: Failed to delete locations for settlement %d: %v", req.SettlementID, err)
	}

	// Delete vendor inventory
	_, err = db.Exec(`DELETE FROM game.vendor_inventory WHERE settlement_id = $1`, req.SettlementID)
	if err != nil {
		log.Printf("Warning: Failed to delete vendor inventory for settlement %d: %v", req.SettlementID, err)
	}

	// Delete enchanter inventory
	_, err = db.Exec(`DELETE FROM game.enchanter_inventory WHERE settlement_id = $1`, req.SettlementID)
	if err != nil {
		log.Printf("Warning: Failed to delete enchanter inventory for settlement %d: %v", req.SettlementID, err)
	}

	// Delete the settlement itself
	_, err = db.Exec(`DELETE FROM game.world_info WHERE settlement_id = $1`, req.SettlementID)
	if err != nil {
		log.Printf("Failed to delete settlement: %v", err)
		http.Error(w, "Failed to delete settlement", http.StatusInternalServerError)
		return
	}

	log.Printf("Deleted settlement %d and all related data", req.SettlementID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
