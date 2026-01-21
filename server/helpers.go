package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Effect represents the database structure for effects (game.effects)
type Effect struct {
	ID          int     `json:"id" db:"effect_id"`
	Name        string  `json:"name" db:"name"`
	Slot        *string `json:"slot" db:"slot"`
	Factor      int     `json:"factor" db:"factor"`
	Description string  `json:"description" db:"description"`
}

// getNextAssetID returns the next available assetID from the database
func getNextAssetID() (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database not available")
	}

	var maxAssetID int
	err := db.QueryRow(`SELECT COALESCE(MAX("assetID"), 0) + 1 FROM "Enemies"`).Scan(&maxAssetID)
	if err != nil {
		log.Printf("Error getting next assetID: %v", err)
		return 0, err
	}

	return maxAssetID, nil
}

// generateSignedURL generates a signed URL for private S3 object access
func generateSignedURL(key string, expiration time.Duration) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	presignClient := s3.NewPresignClient(s3Client)
	request, err := presignClient.PresignGetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(S3_BUCKET_NAME),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiration
	})

	if err != nil {
		return "", fmt.Errorf("failed to generate signed URL: %v", err)
	}

	return request.URL, nil
}

// uploadImageToS3WithCustomKey uploads an image to S3 with a specified key/filename
func uploadImageToS3WithCustomKey(imageData, contentType, customKey string) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized - AWS credentials not configured. Check server startup logs for setup instructions")
	}

	log.Printf("S3 client is available, proceeding with upload using custom key: %s", customKey)

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

	// Use custom key with proper path structure and WebP extension
	filename := fmt.Sprintf("images/enemies/%s.webp", customKey)

	// Create S3 upload input (private bucket)
	uploadInput := &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String(contentType), // Use the provided content type (image/webp)
		// Remove ACL to keep bucket private
	}

	// Upload to S3
	_, err = s3Client.PutObject(context.TODO(), uploadInput)
	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Image uploaded to S3 with custom key: %s", filename)
	return filename, nil // Return S3 key instead of signed URL
}

// getAllEffects retrieves all effects from the database (game.effects)
func getAllEffects() ([]Effect, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `SELECT effect_id, name, slot, factor, description FROM effects ORDER BY effect_id`
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying effects: %v", err)
	}
	defer rows.Close()

	var effects []Effect
	for rows.Next() {
		var effect Effect
		var slot *string

		err := rows.Scan(&effect.ID, &effect.Name, &slot, &effect.Factor, &effect.Description)
		if err != nil {
			return nil, fmt.Errorf("error scanning effect row: %v", err)
		}

		// Handle nullable slot
		effect.Slot = slot

		effects = append(effects, effect)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating effect rows: %v", err)
	}

	log.Printf("Successfully retrieved %d effects from database", len(effects))
	return effects, nil
}
