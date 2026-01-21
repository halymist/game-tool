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

// ==================== COMMON TYPES ====================

// ToolingResponse is a generic response for tooling operations
type ToolingResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// AssetInfo represents an asset from S3
type AssetInfo struct {
	AssetID int    `json:"assetID"`
	Name    string `json:"name"`
	Icon    string `json:"icon"`
}

// AssetsResponse is the response for asset listing
type AssetsResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Assets  []AssetInfo `json:"assets,omitempty"`
}

// UploadAssetRequest is the request body for uploading assets
type UploadAssetRequest struct {
	AssetID     int    `json:"assetID"`
	ImageData   string `json:"imageData"`
	ContentType string `json:"contentType"`
}

// UploadAssetResponse is the response for asset upload
type UploadAssetResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	AssetID int    `json:"assetID,omitempty"`
	S3Key   string `json:"s3Key,omitempty"`
	Icon    string `json:"icon,omitempty"`
}

// ==================== S3 ASSET OPERATIONS ====================

// ListAssetsFromS3 lists all assets from a specific S3 folder
func ListAssetsFromS3(folder string) ([]AssetInfo, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not initialized")
	}

	prefix := fmt.Sprintf("images/%s/", folder)

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 objects: %v", err)
	}

	var assets []AssetInfo
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
			log.Printf("Non-numeric asset filename: %s, skipping", filename)
			continue
		}

		// Direct public S3 URL
		publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
			S3_BUCKET_NAME, S3_REGION, key)

		assets = append(assets, AssetInfo{
			AssetID: assetID,
			Name:    nameWithoutExt,
			Icon:    publicURL,
		})
	}

	log.Printf("Found %d assets in S3 folder: %s", len(assets), folder)
	return assets, nil
}

// UploadAssetToS3 uploads an asset to a specific S3 folder
func UploadAssetToS3(folder string, assetID int, imageData, contentType string) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	log.Printf("Uploading asset to S3 folder %s with ID: %d", folder, assetID)

	// Decode base64 image data
	// Remove data URL prefix if present (data:image/png;base64,...)
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	decoded, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	// Determine file extension based on content type
	ext := ".webp"
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg") {
		ext = ".jpg"
	}

	// Create S3 key
	s3Key := fmt.Sprintf("images/%s/%d%s", folder, assetID, ext)

	// Upload to S3
	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(s3Key),
		Body:        bytes.NewReader(decoded),
		ContentType: aws.String(contentType),
	})

	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Successfully uploaded asset to S3: %s", s3Key)
	return s3Key, nil
}

// ==================== GENERIC ASSET HANDLERS ====================

// CreateGetAssetsHandler creates a handler for getting assets from a specific folder
func CreateGetAssetsHandler(folder string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("=== GET %s ASSETS REQUEST ===", strings.ToUpper(folder))

		if !isAuthenticated(r) {
			log.Println("Unauthorized request")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

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

		assets, err := ListAssetsFromS3(folder)
		if err != nil {
			log.Printf("Error listing assets: %v", err)
			json.NewEncoder(w).Encode(AssetsResponse{
				Success: false,
				Message: err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(AssetsResponse{
			Success: true,
			Assets:  assets,
		})
		log.Printf("✅ GET %s ASSETS RESPONSE SENT", strings.ToUpper(folder))
	}
}

// CreateUploadAssetHandler creates a handler for uploading assets to a specific folder
func CreateUploadAssetHandler(folder string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("=== UPLOAD %s ASSET REQUEST ===", strings.ToUpper(folder))

		if !isAuthenticated(r) {
			log.Println("Unauthorized request")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

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
		var req UploadAssetRequest
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

		log.Printf("Uploading %s asset with ID: %d", folder, req.AssetID)

		// Upload to S3
		s3Key, err := UploadAssetToS3(folder, req.AssetID, req.ImageData, req.ContentType)
		if err != nil {
			log.Printf("Error uploading to S3: %v", err)
			http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
			return
		}

		// Generate public URL
		publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
			S3_BUCKET_NAME, S3_REGION, s3Key)

		json.NewEncoder(w).Encode(UploadAssetResponse{
			Success: true,
			AssetID: req.AssetID,
			S3Key:   s3Key,
			Icon:    publicURL,
		})

		log.Printf("✅ UPLOAD %s ASSET RESPONSE SENT - Asset ID: %d", strings.ToUpper(folder), req.AssetID)
	}
}

// ==================== GENERIC TOOLING HANDLERS ====================

// ToggleApproveRequest is the request body for toggling approval
type ToggleApproveRequest struct {
	ToolingID int  `json:"toolingId"`
	Approved  bool `json:"approved"`
}

// CreateToggleApproveHandler creates a handler for toggling approval
// tableName should be the full schema-qualified name (e.g., "tooling.items")
// functionName should be the stored procedure name (e.g., "tooling.toggle_approve_item")
func CreateToggleApproveHandler(functionName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("=== TOGGLE APPROVE REQUEST (using %s) ===", functionName)

		if !isAuthenticated(r) {
			log.Println("Unauthorized request")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

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

		var req ToggleApproveRequest
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

		log.Printf("Toggle approve: toolingId=%d, approved=%v", req.ToolingID, req.Approved)

		// Call the stored procedure
		query := fmt.Sprintf("SELECT %s($1, $2)", functionName)
		_, err = db.Exec(query, req.ToolingID, req.Approved)
		if err != nil {
			log.Printf("Error toggling approval: %v", err)
			json.NewEncoder(w).Encode(ToolingResponse{
				Success: false,
				Message: err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(ToolingResponse{
			Success: true,
			Message: "Approval toggled successfully",
		})

		log.Printf("✅ TOGGLE APPROVE RESPONSE SENT")
	}
}

// CreateMergeHandler creates a handler for merging approved items
// functionName should be the stored procedure name (e.g., "tooling.merge_items")
func CreateMergeHandler(functionName string, entityName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("=== MERGE %s REQUEST (using %s) ===", strings.ToUpper(entityName), functionName)

		if !isAuthenticated(r) {
			log.Println("Unauthorized request")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

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

		log.Printf("Merging approved %s...", entityName)

		// Call the stored procedure
		query := fmt.Sprintf("SELECT %s()", functionName)
		_, err := db.Exec(query)
		if err != nil {
			log.Printf("Error merging %s: %v", entityName, err)
			json.NewEncoder(w).Encode(ToolingResponse{
				Success: false,
				Message: err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(ToolingResponse{
			Success: true,
			Message: fmt.Sprintf("%s merged successfully", entityName),
		})

		log.Printf("✅ MERGE %s RESPONSE SENT", strings.ToUpper(entityName))
	}
}

// GeneratePublicURL generates a public S3 URL for an asset
func GeneratePublicURL(folder string, assetID int) string {
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/images/%s/%d.webp",
		S3_BUCKET_NAME, S3_REGION, folder, assetID)
}
