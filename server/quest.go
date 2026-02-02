package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/lib/pq"
)

// Quest represents a quest
type Quest struct {
	QuestID        int    `json:"quest_id"`
	QuestchainID   int    `json:"questchain_id"`
	QuestName      string `json:"quest_name"`
	RequisiteQuest *int   `json:"requisite_quest"`
	Ending         *int   `json:"ending"`
	DefaultEntry   bool   `json:"default_entry"`
	SettlementID   *int   `json:"settlement_id"`
}

// QuestOption represents a quest option
type QuestOption struct {
	OptionID         int     `json:"option_id"`
	QuestID          int     `json:"quest_id"`
	NodeText         string  `json:"node_text"`
	OptionText       string  `json:"option_text"`
	StatType         *string `json:"stat_type"`
	StatRequired     *int    `json:"stat_required"`
	EffectID         *int    `json:"effect_id"`
	EffectAmount     *int    `json:"effect_amount"`
	EnemyID          *int    `json:"enemy_id"`
	Start            bool    `json:"start"`
	RewardStatType   *string `json:"reward_stat_type"`
	RewardStatAmount *int    `json:"reward_stat_amount"`
	RewardTalent     *bool   `json:"reward_talent"`
	RewardItem       *int    `json:"reward_item"`
	RewardPerk       *int    `json:"reward_perk"`
	RewardBlessing   *int    `json:"reward_blessing"`
	RewardPotion     *int    `json:"reward_potion"`
	// Position for designer
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// QuestOptionVisibility represents visibility connections between options
type QuestOptionVisibility struct {
	OptionID       int    `json:"option_id"`
	EffectType     string `json:"effect_type"`
	TargetOptionID int    `json:"target_option_id"`
}

// handleGetQuests returns quests and their options for a settlement
func handleGetQuests(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify authentication
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settlementIDStr := r.URL.Query().Get("settlementId")
	var settlementID *int
	if settlementIDStr != "" {
		id, err := strconv.Atoi(settlementIDStr)
		if err == nil {
			settlementID = &id
		}
	}

	// Get quests
	var questQuery string
	var questArgs []interface{}
	if settlementID != nil {
		questQuery = `SELECT quest_id, questchain_id, quest_name, requisite_quest, ending, default_entry, settlement_id 
			FROM game.quests WHERE settlement_id = $1 ORDER BY quest_id`
		questArgs = []interface{}{*settlementID}
	} else {
		questQuery = `SELECT quest_id, questchain_id, quest_name, requisite_quest, ending, default_entry, settlement_id 
			FROM game.quests ORDER BY quest_id`
	}

	rows, err := db.Query(questQuery, questArgs...)
	if err != nil {
		log.Printf("Error querying quests: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var quests []Quest
	for rows.Next() {
		var q Quest
		err := rows.Scan(&q.QuestID, &q.QuestchainID, &q.QuestName, &q.RequisiteQuest, &q.Ending, &q.DefaultEntry, &q.SettlementID)
		if err != nil {
			log.Printf("Error scanning quest: %v", err)
			continue
		}
		quests = append(quests, q)
	}

	// Get all quest IDs to fetch options
	questIDs := make([]int, len(quests))
	for i, q := range quests {
		questIDs[i] = q.QuestID
	}

	// Get options for these quests
	var options []QuestOption
	if len(questIDs) > 0 {
		// Build query with IN clause
		optionQuery := `SELECT option_id, quest_id, node_text, option_text, stat_type, stat_required, 
			effect_id, effect_amount, enemy_id, start, reward_stat_type, reward_stat_amount, 
			reward_talent, reward_item, reward_perk, reward_blessing, reward_potion,
			COALESCE(pos_x, 0) as pos_x, COALESCE(pos_y, 0) as pos_y
			FROM game.quest_options WHERE quest_id = ANY($1) ORDER BY quest_id, option_id`

		optionRows, err := db.Query(optionQuery, pq.Array(questIDs))
		if err != nil {
			log.Printf("Error querying quest options: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer optionRows.Close()

		for optionRows.Next() {
			var o QuestOption
			err := optionRows.Scan(&o.OptionID, &o.QuestID, &o.NodeText, &o.OptionText, &o.StatType, &o.StatRequired,
				&o.EffectID, &o.EffectAmount, &o.EnemyID, &o.Start, &o.RewardStatType, &o.RewardStatAmount,
				&o.RewardTalent, &o.RewardItem, &o.RewardPerk, &o.RewardBlessing, &o.RewardPotion,
				&o.X, &o.Y)
			if err != nil {
				log.Printf("Error scanning quest option: %v", err)
				continue
			}
			options = append(options, o)
		}
	}

	// Get visibility connections for these options
	var visibility []QuestOptionVisibility
	if len(options) > 0 {
		optionIDs := make([]int, len(options))
		for i, o := range options {
			optionIDs[i] = o.OptionID
		}

		visQuery := `SELECT option_id, effect_type, target_option_id 
			FROM game.quest_option_visibility WHERE option_id = ANY($1) OR target_option_id = ANY($1)`

		visRows, err := db.Query(visQuery, pq.Array(optionIDs))
		if err != nil {
			log.Printf("Error querying visibility: %v", err)
		} else {
			defer visRows.Close()
			for visRows.Next() {
				var v QuestOptionVisibility
				if err := visRows.Scan(&v.OptionID, &v.EffectType, &v.TargetOptionID); err != nil {
					log.Printf("Error scanning visibility: %v", err)
					continue
				}
				visibility = append(visibility, v)
			}
		}
	}

	response := map[string]interface{}{
		"quests":     quests,
		"options":    options,
		"visibility": visibility,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateQuestRequest represents the request to create a new quest
type CreateQuestRequest struct {
	QuestName    string `json:"questName"`
	SettlementID *int   `json:"settlementId"`
}

// handleCreateQuest creates a new quest
func handleCreateQuest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req CreateQuestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.QuestName == "" {
		http.Error(w, "Quest name is required", http.StatusBadRequest)
		return
	}

	// Create a new questchain for this quest
	var questchainID int
	err := db.QueryRow(`INSERT INTO game.questchain (description) VALUES ($1) RETURNING questchain_id`, req.QuestName).Scan(&questchainID)
	if err != nil {
		log.Printf("Error creating questchain: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Create the quest
	var questID int
	err = db.QueryRow(`INSERT INTO game.quests (questchain_id, quest_name, settlement_id, default_entry) 
		VALUES ($1, $2, $3, true) RETURNING quest_id`,
		questchainID, req.QuestName, req.SettlementID).Scan(&questID)
	if err != nil {
		log.Printf("Error creating quest: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success":      true,
		"questId":      questID,
		"questchainId": questchainID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// SaveQuestRequest represents the request to save quest options
type SaveQuestRequest struct {
	QuestID       int                     `json:"questId"`
	NewOptions    []NewQuestOption        `json:"newOptions"`
	OptionUpdates []QuestOptionUpdate     `json:"optionUpdates"`
	NewVisibility []QuestOptionVisibility `json:"newVisibility"`
}

// NewQuestOption represents a new option to create
type NewQuestOption struct {
	LocalID          int     `json:"localId"`
	QuestID          int     `json:"questId"`
	NodeText         string  `json:"nodeText"`
	OptionText       string  `json:"optionText"`
	IsStart          bool    `json:"isStart"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
	StatType         *string `json:"statType"`
	StatRequired     *int    `json:"statRequired"`
	EffectID         *int    `json:"effectId"`
	EffectAmount     *int    `json:"effectAmount"`
	EnemyID          *int    `json:"enemyId"`
	RewardStatType   *string `json:"rewardStatType"`
	RewardStatAmount *int    `json:"rewardStatAmount"`
	RewardTalent     *bool   `json:"rewardTalent"`
	RewardItem       *int    `json:"rewardItem"`
	RewardPerk       *int    `json:"rewardPerk"`
	RewardBlessing   *int    `json:"rewardBlessing"`
	RewardPotion     *int    `json:"rewardPotion"`
}

// QuestOptionUpdate represents an update to an existing option
type QuestOptionUpdate struct {
	OptionID         int     `json:"optionId"`
	LocalID          int     `json:"localId"`
	NodeText         string  `json:"nodeText"`
	OptionText       string  `json:"optionText"`
	IsStart          bool    `json:"isStart"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
	StatType         *string `json:"statType"`
	StatRequired     *int    `json:"statRequired"`
	EffectID         *int    `json:"effectId"`
	EffectAmount     *int    `json:"effectAmount"`
	EnemyID          *int    `json:"enemyId"`
	RewardStatType   *string `json:"rewardStatType"`
	RewardStatAmount *int    `json:"rewardStatAmount"`
	RewardTalent     *bool   `json:"rewardTalent"`
	RewardItem       *int    `json:"rewardItem"`
	RewardPerk       *int    `json:"rewardPerk"`
	RewardBlessing   *int    `json:"rewardBlessing"`
	RewardPotion     *int    `json:"rewardPotion"`
}

// handleSaveQuest saves quest options and visibility
func handleSaveQuest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req SaveQuestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Track mapping from local IDs to server IDs
	optionMapping := make(map[int]int)

	// Insert new options
	for _, opt := range req.NewOptions {
		var optionID int
		err := tx.QueryRow(`INSERT INTO game.quest_options 
			(quest_id, node_text, option_text, start, stat_type, stat_required, effect_id, effect_amount, enemy_id,
			 reward_stat_type, reward_stat_amount, reward_talent, reward_item, reward_perk, reward_blessing, reward_potion,
			 pos_x, pos_y)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
			RETURNING option_id`,
			opt.QuestID, opt.NodeText, opt.OptionText, opt.IsStart,
			opt.StatType, opt.StatRequired, opt.EffectID, opt.EffectAmount, opt.EnemyID,
			opt.RewardStatType, opt.RewardStatAmount, opt.RewardTalent, opt.RewardItem, opt.RewardPerk, opt.RewardBlessing, opt.RewardPotion,
			opt.X, opt.Y).Scan(&optionID)

		if err != nil {
			log.Printf("Error inserting option: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		optionMapping[opt.LocalID] = optionID
	}

	// Update existing options
	for _, opt := range req.OptionUpdates {
		_, err := tx.Exec(`UPDATE game.quest_options SET
			node_text = $1, option_text = $2, start = $3, stat_type = $4, stat_required = $5,
			effect_id = $6, effect_amount = $7, enemy_id = $8,
			reward_stat_type = $9, reward_stat_amount = $10, reward_talent = $11, reward_item = $12,
			reward_perk = $13, reward_blessing = $14, reward_potion = $15, pos_x = $16, pos_y = $17
			WHERE option_id = $18`,
			opt.NodeText, opt.OptionText, opt.IsStart, opt.StatType, opt.StatRequired,
			opt.EffectID, opt.EffectAmount, opt.EnemyID,
			opt.RewardStatType, opt.RewardStatAmount, opt.RewardTalent, opt.RewardItem,
			opt.RewardPerk, opt.RewardBlessing, opt.RewardPotion, opt.X, opt.Y,
			opt.OptionID)

		if err != nil {
			log.Printf("Error updating option %d: %v", opt.OptionID, err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
	}

	// Insert new visibility connections
	for _, vis := range req.NewVisibility {
		_, err := tx.Exec(`INSERT INTO game.quest_option_visibility (option_id, effect_type, target_option_id)
			VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			vis.OptionID, vis.EffectType, vis.TargetOptionID)

		if err != nil {
			log.Printf("Error inserting visibility: %v", err)
			// Continue, don't fail on visibility
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success":       true,
		"optionMapping": optionMapping,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteQuestOptionRequest represents request to delete an option
type DeleteQuestOptionRequest struct {
	OptionID int `json:"optionId"`
}

// handleDeleteQuestOption deletes a quest option and its visibility connections
func handleDeleteQuestOption(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req DeleteQuestOptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Delete visibility connections first
	_, err = tx.Exec(`DELETE FROM game.quest_option_visibility WHERE option_id = $1 OR target_option_id = $1`, req.OptionID)
	if err != nil {
		log.Printf("Error deleting visibility: %v", err)
	}

	// Delete the option
	_, err = tx.Exec(`DELETE FROM game.quest_options WHERE option_id = $1`, req.OptionID)
	if err != nil {
		log.Printf("Error deleting option: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success": true,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ==================== QUEST ASSETS ====================

// QuestAsset represents a quest background asset from S3
type QuestAsset struct {
	ID  int    `json:"id"`
	URL string `json:"url"`
}

// handleGetQuestAssets returns all quest assets from S3
func handleGetQuestAssets(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET QUEST ASSETS REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		// Return empty array if no S3 client
		json.NewEncoder(w).Encode([]QuestAsset{})
		return
	}

	assets, err := listQuestAssets()
	if err != nil {
		log.Printf("Error listing quest assets: %v", err)
		json.NewEncoder(w).Encode([]QuestAsset{})
		return
	}

	log.Printf("Found %d quest assets in S3", len(assets))
	json.NewEncoder(w).Encode(assets)
}

// listQuestAssets lists all quest assets from S3 (images/quests/)
func listQuestAssets() ([]QuestAsset, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not initialized")
	}

	prefix := "images/quests/"

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 objects: %v", err)
	}

	var assets []QuestAsset
	for _, obj := range result.Contents {
		key := *obj.Key

		ext := strings.ToLower(filepath.Ext(key))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" && ext != ".gif" {
			continue
		}

		filename := filepath.Base(key)
		nameWithoutExt := strings.TrimSuffix(filename, ext)

		assetID, err := strconv.Atoi(nameWithoutExt)
		if err != nil {
			log.Printf("Non-numeric quest asset: %s, skipping", filename)
			continue
		}

		publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
			S3_BUCKET_NAME, S3_REGION, key)

		assets = append(assets, QuestAsset{
			ID:  assetID,
			URL: publicURL,
		})
	}

	return assets, nil
}

// handleUploadQuestAsset uploads a new quest asset to S3
func handleUploadQuestAsset(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPLOAD QUEST ASSET REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		http.Error(w, "S3 client not available", http.StatusInternalServerError)
		return
	}

	var req struct {
		ImageData string `json:"imageData"`
		Filename  string `json:"filename"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error parsing request: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Find the next available asset ID
	assets, err := listQuestAssets()
	if err != nil {
		log.Printf("Error listing assets for ID: %v", err)
		// Start from 1 if we can't list
		assets = []QuestAsset{}
	}

	maxID := 0
	for _, asset := range assets {
		if asset.ID > maxID {
			maxID = asset.ID
		}
	}
	newAssetID := maxID + 1

	log.Printf("Uploading quest asset with new ID: %d", newAssetID)

	// Upload to S3
	s3Key, err := uploadQuestAssetToS3(req.ImageData, newAssetID)
	if err != nil {
		log.Printf("Error uploading to S3: %v", err)
		http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
		return
	}

	publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
		S3_BUCKET_NAME, S3_REGION, s3Key)

	response := map[string]interface{}{
		"success": true,
		"assetId": newAssetID,
		"s3Key":   s3Key,
		"url":     publicURL,
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("✅ UPLOAD QUEST ASSET SUCCESS - Asset ID: %d, URL: %s", newAssetID, publicURL)
}

// uploadQuestAssetToS3 uploads a quest asset as webp
func uploadQuestAssetToS3(imageData string, assetID int) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	// Remove data URL prefix if present
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	// Decode base64
	imageBytes, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %v", err)
	}

	// S3 key: images/quests/{assetID}.webp
	s3Key := fmt.Sprintf("images/quests/%d.webp", assetID)

	log.Printf("Uploading quest asset to S3: %s", s3Key)

	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(s3Key),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String("image/webp"),
	})

	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Quest asset uploaded to S3: %s", s3Key)
	return s3Key, nil
}

// Placeholder for unused import
var _ = sql.ErrNoRows
