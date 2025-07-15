package main

import (
	"fmt"
	"log"
)

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
