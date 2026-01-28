package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	SettlementID      int    `json:"settlement_id"`
	SettlementName    string `json:"settlement_name"`
	Faction           *int   `json:"faction"`
	Blacksmith        bool   `json:"blacksmith"`
	Alchemist         bool   `json:"alchemist"`
	Enchanter         bool   `json:"enchanter"`
	Trainer           bool   `json:"trainer"`
	Church            bool   `json:"church"`
	Blessing1         *int   `json:"blessing1"`
	Blessing2         *int   `json:"blessing2"`
	Blessing3         *int   `json:"blessing3"`
	SettlementAssetID *int   `json:"settlement_asset_id"`
	BlacksmithAssetID *int   `json:"blacksmith_asset_id"`
	AlchemistAssetID  *int   `json:"alchemist_asset_id"`
	EnchanterAssetID  *int   `json:"enchanter_asset_id"`
	TrainerAssetID    *int   `json:"trainer_asset_id"`
	ChurchAssetID     *int   `json:"church_asset_id"`
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
	SettlementID      *int   `json:"settlement_id"`
	SettlementName    string `json:"settlement_name"`
	Faction           *int   `json:"faction"`
	Blacksmith        bool   `json:"blacksmith"`
	Alchemist         bool   `json:"alchemist"`
	Enchanter         bool   `json:"enchanter"`
	Trainer           bool   `json:"trainer"`
	Church            bool   `json:"church"`
	Blessing1         *int   `json:"blessing1"`
	Blessing2         *int   `json:"blessing2"`
	Blessing3         *int   `json:"blessing3"`
	SettlementAssetID *int   `json:"settlement_asset_id"`
	BlacksmithAssetID *int   `json:"blacksmith_asset_id"`
	AlchemistAssetID  *int   `json:"alchemist_asset_id"`
	EnchanterAssetID  *int   `json:"enchanter_asset_id"`
	TrainerAssetID    *int   `json:"trainer_asset_id"`
	ChurchAssetID     *int   `json:"church_asset_id"`
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

	rows, err := db.Query(`
		SELECT settlement_id, COALESCE(settlement_name, ''), faction, 
		       COALESCE(blacksmith, false), COALESCE(alchemist, false), 
		       COALESCE(enchanter, false), COALESCE(trainer, false), COALESCE(church, false),
		       blessing1, blessing2, blessing3,
		       settlement_asset_id, blacksmith_asset_id, alchemist_asset_id,
		       enchanter_asset_id, trainer_asset_id, church_asset_id
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
			&s.SettlementAssetID, &s.BlacksmithAssetID, &s.AlchemistAssetID,
			&s.EnchanterAssetID, &s.TrainerAssetID, &s.ChurchAssetID,
		)
		if err != nil {
			log.Printf("Failed to scan settlement: %v", err)
			continue
		}
		settlements = append(settlements, s)
	}

	log.Printf("Loaded %d settlements", len(settlements))

	response := GetSettlementsResponse{
		Success:     true,
		Settlements: settlements,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleGetSettlementAssets returns all settlement assets from S3
func handleGetSettlementAssets(w http.ResponseWriter, r *http.Request) {
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
	if r.Method != "POST" {
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

	var req UploadSettlementAssetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Decode base64 data
	data, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil {
		http.Error(w, "Invalid base64 data", http.StatusBadRequest)
		return
	}

	// Get next asset ID
	nextID, err := getNextSettlementAssetID()
	if err != nil {
		log.Printf("Failed to get next asset ID: %v", err)
		// Default to 1 if we can't determine
		nextID = 1
	}

	// Use asset ID as filename with .webp extension
	key := fmt.Sprintf("images/settlements/%d.webp", nextID)

	// Upload to S3 as webp
	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("image/webp"),
	})
	if err != nil {
		log.Printf("Failed to upload to S3: %v", err)
		http.Error(w, "Failed to upload asset", http.StatusInternalServerError)
		return
	}

	// Generate presigned URL for the uploaded file
	presignInput := &s3.GetObjectInput{
		Bucket: aws.String(S3_BUCKET_NAME),
		Key:    aws.String(key),
	}
	presignResult, err := s3Presigner.PresignGetObject(context.TODO(), presignInput, func(opts *s3.PresignOptions) {
		opts.Expires = time.Hour * 24
	})
	if err != nil {
		log.Printf("Failed to presign URL: %v", err)
		http.Error(w, "Failed to generate URL", http.StatusInternalServerError)
		return
	}

	log.Printf("Uploaded settlement asset: %s (ID: %d)", key, nextID)

	response := UploadSettlementAssetResponse{
		Success: true,
		AssetID: nextID,
		URL:     presignResult.URL,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
		// Update existing settlement
		_, err := db.Exec(`
			UPDATE game.world_info SET
				settlement_name = $1, faction = $2,
				blacksmith = $3, alchemist = $4, enchanter = $5, trainer = $6, church = $7,
				blessing1 = $8, blessing2 = $9, blessing3 = $10,
				settlement_asset_id = $11, blacksmith_asset_id = $12, alchemist_asset_id = $13,
				enchanter_asset_id = $14, trainer_asset_id = $15, church_asset_id = $16
			WHERE settlement_id = $17
		`, req.SettlementName, req.Faction,
			req.Blacksmith, req.Alchemist, req.Enchanter, req.Trainer, req.Church,
			req.Blessing1, req.Blessing2, req.Blessing3,
			req.SettlementAssetID, req.BlacksmithAssetID, req.AlchemistAssetID,
			req.EnchanterAssetID, req.TrainerAssetID, req.ChurchAssetID,
			*req.SettlementID)

		if err != nil {
			log.Printf("Failed to update settlement: %v", err)
			http.Error(w, "Failed to update settlement", http.StatusInternalServerError)
			return
		}
		settlementID = *req.SettlementID
		log.Printf("Updated settlement %d", settlementID)
	} else {
		// Insert new settlement
		err := db.QueryRow(`
			INSERT INTO game.world_info (
				settlement_name, faction,
				blacksmith, alchemist, enchanter, trainer, church,
				blessing1, blessing2, blessing3,
				settlement_asset_id, blacksmith_asset_id, alchemist_asset_id,
				enchanter_asset_id, trainer_asset_id, church_asset_id
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
			) RETURNING settlement_id
		`, req.SettlementName, req.Faction,
			req.Blacksmith, req.Alchemist, req.Enchanter, req.Trainer, req.Church,
			req.Blessing1, req.Blessing2, req.Blessing3,
			req.SettlementAssetID, req.BlacksmithAssetID, req.AlchemistAssetID,
			req.EnchanterAssetID, req.TrainerAssetID, req.ChurchAssetID).Scan(&settlementID)

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

	_, err := db.Exec(`DELETE FROM game.world_info WHERE settlement_id = $1`, req.SettlementID)
	if err != nil {
		log.Printf("Failed to delete settlement: %v", err)
		http.Error(w, "Failed to delete settlement", http.StatusInternalServerError)
		return
	}

	log.Printf("Deleted settlement %d", req.SettlementID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
