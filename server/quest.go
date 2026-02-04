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

// QuestChain represents a quest chain (group of related quests)
type QuestChain struct {
	QuestchainID int    `json:"questchain_id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	SettlementID int    `json:"settlement_id"`
}

// Quest represents a quest
type Quest struct {
	QuestID           int     `json:"quest_id"`
	QuestchainID      int     `json:"questchain_id"`
	QuestName         string  `json:"quest_name"`
	RequisiteOptionID *int    `json:"requisite_option_id"`
	Ending            *int    `json:"ending"`
	DefaultEntry      bool    `json:"default_entry"`
	SettlementID      *int    `json:"settlement_id"`
	AssetID           *int    `json:"asset_id"`
	PosX              float64 `json:"pos_x"`
	PosY              float64 `json:"pos_y"`
	SortOrder         int     `json:"sort_order"`
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

// QuestOptionRequirement represents a visibility requirement for an option
// The option_id requires required_option_id to have been selected before it becomes visible
type QuestOptionRequirement struct {
	OptionID         int `json:"optionId"`
	RequiredOptionID int `json:"requiredOptionId"`
}

// handleGetQuests returns quest chains, quests, and their options for a settlement
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

	// Get quest chains for this settlement
	var chainQuery string
	var chainArgs []interface{}
	if settlementID != nil {
		chainQuery = `SELECT questchain_id, COALESCE(name, ''), COALESCE(description, ''), settlement_id 
			FROM game.questchain WHERE settlement_id = $1 ORDER BY questchain_id`
		chainArgs = []interface{}{*settlementID}
	} else {
		chainQuery = `SELECT questchain_id, COALESCE(name, ''), COALESCE(description, ''), settlement_id 
			FROM game.questchain ORDER BY questchain_id`
	}

	chainRows, err := db.Query(chainQuery, chainArgs...)
	if err != nil {
		log.Printf("Error querying quest chains: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer chainRows.Close()

	log.Printf("GET QUESTS: settlementId=%v, chainQuery=%s", settlementID, chainQuery)

	var chains []QuestChain
	chainIDs := []int{}
	for chainRows.Next() {
		var c QuestChain
		err := chainRows.Scan(&c.QuestchainID, &c.Name, &c.Description, &c.SettlementID)
		if err != nil {
			log.Printf("Error scanning quest chain: %v", err)
			continue
		}
		chains = append(chains, c)
		chainIDs = append(chainIDs, c.QuestchainID)
	}
	log.Printf("GET QUESTS: Found %d chains, chainIDs=%v", len(chains), chainIDs)

	// Get quests for these chains
	var quests []Quest
	if len(chainIDs) > 0 {
		questQuery := `SELECT quest_id, questchain_id, quest_name, requisite_option_id, ending, default_entry, settlement_id, asset_id,
			COALESCE(pos_x, 50) as pos_x, COALESCE(pos_y, 100) as pos_y, COALESCE(sort_order, 0) as sort_order
			FROM game.quests WHERE questchain_id = ANY($1) ORDER BY questchain_id, sort_order, quest_id`

		questRows, err := db.Query(questQuery, pq.Array(chainIDs))
		if err != nil {
			log.Printf("Error querying quests: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer questRows.Close()

		for questRows.Next() {
			var q Quest
			err := questRows.Scan(&q.QuestID, &q.QuestchainID, &q.QuestName, &q.RequisiteOptionID, &q.Ending, &q.DefaultEntry, &q.SettlementID, &q.AssetID, &q.PosX, &q.PosY, &q.SortOrder)
			if err != nil {
				log.Printf("Error scanning quest: %v", err)
				continue
			}
			quests = append(quests, q)
		}
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

	// Get requirements for these options
	var requirements []QuestOptionRequirement
	if len(options) > 0 {
		optionIDs := make([]int, len(options))
		for i, o := range options {
			optionIDs[i] = o.OptionID
		}

		reqQuery := `SELECT option_id, required_option_id 
			FROM game.quest_option_requirements WHERE option_id = ANY($1) OR required_option_id = ANY($1)`

		reqRows, err := db.Query(reqQuery, pq.Array(optionIDs))
		if err != nil {
			log.Printf("Error querying requirements: %v", err)
		} else {
			defer reqRows.Close()
			for reqRows.Next() {
				var r QuestOptionRequirement
				if err := reqRows.Scan(&r.OptionID, &r.RequiredOptionID); err != nil {
					log.Printf("Error scanning requirement: %v", err)
					continue
				}
				requirements = append(requirements, r)
			}
		}
	}

	response := map[string]interface{}{
		"chains":       chains,
		"quests":       quests,
		"options":      options,
		"requirements": requirements,
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
	err = db.QueryRow(`INSERT INTO game.quests (questchain_id, quest_name, settlement_id, default_entry, pos_x, pos_y) 
		VALUES ($1, $2, $3, true, 50, 100) RETURNING quest_id`,
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

// SaveQuestRequest represents the request to save quest chain/quest options
type SaveQuestRequest struct {
	// Chain-level fields
	QuestchainID int    `json:"questchainId"`
	ChainName    string `json:"chainName"`
	IsNewChain   bool   `json:"isNewChain"`
	SettlementID *int   `json:"settlementId"`
	// Quest-level fields (for new quests within the chain)
	NewQuests    []NewQuestData    `json:"newQuests"`
	QuestUpdates []QuestUpdateData `json:"questUpdates"`
	// Deletion tracking
	DeletedQuestIds  []int `json:"deletedQuestIds"`
	DeletedOptionIds []int `json:"deletedOptionIds"`
	// Option-level fields
	NewOptions          []NewQuestOption         `json:"newOptions"`
	OptionUpdates       []QuestOptionUpdate      `json:"optionUpdates"`
	NewRequirements     []QuestOptionRequirement `json:"newRequirements"`
	PendingRequirements []PendingRequirement     `json:"pendingRequirements"`
	// Quest requisite mappings (option -> quest connections)
	QuestRequisites []QuestRequisiteMapping `json:"questRequisites"`
	// Legacy fields for backwards compat
	QuestID    int    `json:"questId"`
	QuestName  string `json:"questName"`
	AssetID    *int   `json:"assetId"`
	IsNewQuest bool   `json:"isNewQuest"`
}

// QuestRequisiteMapping maps an option to a quest (option leads to quest)
type QuestRequisiteMapping struct {
	OptionId      int `json:"optionId"`      // server ID of the option
	LocalOptionId int `json:"localOptionId"` // local ID if option is new
	QuestId       int `json:"questId"`       // server ID of the quest
	LocalQuestId  int `json:"localQuestId"`  // local ID if quest is new
}

// NewQuestData represents a new quest to create within a chain
type NewQuestData struct {
	LocalQuestID int     `json:"localQuestId"`
	QuestName    string  `json:"questName"`
	AssetID      *int    `json:"assetId"`
	PosX         float64 `json:"posX"`
	PosY         float64 `json:"posY"`
	SortOrder    int     `json:"sortOrder"`
}

// QuestUpdateData represents an update to an existing quest
type QuestUpdateData struct {
	QuestID   int     `json:"questId"`
	QuestName string  `json:"questName"`
	AssetID   *int    `json:"assetId"`
	PosX      float64 `json:"posX"`
	PosY      float64 `json:"posY"`
	SortOrder int     `json:"sortOrder"`
}

// PendingRequirement represents a requirement between unsaved local options
type PendingRequirement struct {
	LocalOptionID         int `json:"localOptionId"`
	LocalRequiredOptionID int `json:"localRequiredOptionId"`
	OptionServerID        int `json:"optionServerId"`   // Server ID if already known (0 if new)
	RequiredServerID      int `json:"requiredServerId"` // Server ID if already known (0 if new)
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

	log.Printf("SaveQuest request: IsNewChain=%v, QuestchainID=%d, IsNewQuest=%v, QuestID=%d, NewOptions=%d, PendingRequirements=%d",
		req.IsNewChain, req.QuestchainID, req.IsNewQuest, req.QuestID, len(req.NewOptions), len(req.PendingRequirements))

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	questchainID := req.QuestchainID
	questID := req.QuestID
	questMapping := make(map[int]int) // local quest ID -> server quest ID

	// Create new chain if isNewChain
	if req.IsNewChain {
		err := tx.QueryRow(`INSERT INTO game.questchain (name, description, settlement_id)
			VALUES ($1, '', $2) RETURNING questchain_id`,
			req.ChainName, req.SettlementID).Scan(&questchainID)
		if err != nil {
			log.Printf("Error creating new chain: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Created new chain with ID: %d", questchainID)
	} else if questchainID > 0 && req.ChainName != "" {
		// Update chain name
		_, err := tx.Exec(`UPDATE game.questchain SET name = $1 WHERE questchain_id = $2`, req.ChainName, questchainID)
		if err != nil {
			log.Printf("Error updating chain name: %v", err)
		}
	}

	// Create new quests within the chain
	for _, newQuest := range req.NewQuests {
		var newQuestID int
		err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, asset_id, default_entry, pos_x, pos_y, sort_order)
			VALUES ($1, $2, $3, true, $4, $5, $6) RETURNING quest_id`,
			newQuest.QuestName, questchainID, newQuest.AssetID, newQuest.PosX, newQuest.PosY, newQuest.SortOrder).Scan(&newQuestID)
		if err != nil {
			log.Printf("Error creating new quest in chain: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		questMapping[newQuest.LocalQuestID] = newQuestID
		log.Printf("Created new quest: local %d -> server %d", newQuest.LocalQuestID, newQuestID)
	}

	// Update existing quests
	for _, questUpdate := range req.QuestUpdates {
		_, err := tx.Exec(`UPDATE game.quests SET quest_name = $1, asset_id = $2, pos_x = $3, pos_y = $4, sort_order = $5 WHERE quest_id = $6`,
			questUpdate.QuestName, questUpdate.AssetID, questUpdate.PosX, questUpdate.PosY, questUpdate.SortOrder, questUpdate.QuestID)
		if err != nil {
			log.Printf("Error updating quest %d: %v", questUpdate.QuestID, err)
		} else {
			log.Printf("Updated quest: %d", questUpdate.QuestID)
		}
	}

	// Delete removed options first (before quests, due to foreign keys)
	for _, optionId := range req.DeletedOptionIds {
		// First delete any requirements referencing this option
		_, err := tx.Exec(`DELETE FROM game.quest_option_requirements WHERE option_id = $1 OR required_option_id = $1`, optionId)
		if err != nil {
			log.Printf("Error deleting requirements for option %d: %v", optionId, err)
		}
		// Clear any quest requisite_option_id pointing to this option
		_, err = tx.Exec(`UPDATE game.quests SET requisite_option_id = NULL WHERE requisite_option_id = $1`, optionId)
		if err != nil {
			log.Printf("Error clearing quest requisite for option %d: %v", optionId, err)
		}
		// Delete the option
		_, err = tx.Exec(`DELETE FROM game.quest_options WHERE option_id = $1`, optionId)
		if err != nil {
			log.Printf("Error deleting option %d: %v", optionId, err)
		} else {
			log.Printf("Deleted option: %d", optionId)
		}
	}

	// Delete removed quests
	for _, questId := range req.DeletedQuestIds {
		// Options will cascade delete, but let's be explicit
		_, err := tx.Exec(`DELETE FROM game.quest_options WHERE quest_id = $1`, questId)
		if err != nil {
			log.Printf("Error deleting options for quest %d: %v", questId, err)
		}
		_, err = tx.Exec(`DELETE FROM game.quests WHERE quest_id = $1`, questId)
		if err != nil {
			log.Printf("Error deleting quest %d: %v", questId, err)
		} else {
			log.Printf("Deleted quest: %d", questId)
		}
	}

	// Legacy: Create new quest if isNewQuest (backwards compat)
	if req.IsNewQuest && questID == 0 {
		err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, asset_id, default_entry, pos_x, pos_y)
			VALUES ($1, $2, $3, true, 50, 100) RETURNING quest_id`,
			req.QuestName, questchainID, req.AssetID).Scan(&questID)
		if err != nil {
			log.Printf("Error creating new quest: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Created new quest (legacy) with ID: %d", questID)
	} else if questID > 0 {
		// Update existing quest's asset_id and name if provided
		if req.AssetID != nil {
			_, err := tx.Exec(`UPDATE game.quests SET asset_id = $1 WHERE quest_id = $2`, *req.AssetID, questID)
			if err != nil {
				log.Printf("Error updating quest asset: %v", err)
			}
		}
		if req.QuestName != "" {
			_, err := tx.Exec(`UPDATE game.quests SET quest_name = $1 WHERE quest_id = $2`, req.QuestName, questID)
			if err != nil {
				log.Printf("Error updating quest name: %v", err)
			}
		}
	}

	// Track mapping from local IDs to server IDs
	optionMapping := make(map[int]int)

	// Collect all unique local quest IDs from new options that need a quest to be created
	localQuestIdsNeedingQuest := make(map[int]bool)
	for _, opt := range req.NewOptions {
		// Local IDs are negative numbers
		if opt.QuestID < 0 {
			if _, exists := questMapping[opt.QuestID]; !exists {
				localQuestIdsNeedingQuest[opt.QuestID] = true
			}
		}
	}

	// Create quests for any local IDs that weren't in NewQuests
	questCounter := len(req.NewQuests) + 1
	for localQuestID := range localQuestIdsNeedingQuest {
		var newQuestID int
		questName := fmt.Sprintf("Quest %d", questCounter)
		err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, default_entry, pos_x, pos_y)
			VALUES ($1, $2, true, 50, 100) RETURNING quest_id`,
			questName, questchainID).Scan(&newQuestID)
		if err != nil {
			log.Printf("Error creating auto quest in chain: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		questMapping[localQuestID] = newQuestID
		log.Printf("Auto-created quest for local %d -> server %d", localQuestID, newQuestID)
		questCounter++
	}

	// Update quest IDs in new options if needed
	for i := range req.NewOptions {
		// Check if this option's questId needs to be mapped from local to server
		if serverQuestID, ok := questMapping[req.NewOptions[i].QuestID]; ok {
			req.NewOptions[i].QuestID = serverQuestID
		} else if req.NewOptions[i].QuestID == 0 && questID > 0 {
			// Legacy: use the single questID
			req.NewOptions[i].QuestID = questID
		} else if req.NewOptions[i].QuestID <= 0 {
			// Option has no valid quest ID - create one
			var newQuestID int
			questName := fmt.Sprintf("Quest %d", questCounter)
			err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, default_entry, pos_x, pos_y)
				VALUES ($1, $2, true, 50, 100) RETURNING quest_id`,
				questName, questchainID).Scan(&newQuestID)
			if err != nil {
				log.Printf("Error creating fallback quest: %v", err)
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			questMapping[req.NewOptions[i].QuestID] = newQuestID
			req.NewOptions[i].QuestID = newQuestID
			log.Printf("Created fallback quest: server %d", newQuestID)
			questCounter++
		}
	}
	// Insert new options
	for _, opt := range req.NewOptions {
		log.Printf("Processing new option: LocalID=%d, QuestID=%d, NodeText=%s, OptionText=%s",
			opt.LocalID, opt.QuestID, opt.NodeText, opt.OptionText)
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
		log.Printf("Option mapping: LocalID=%d -> ServerID=%d", opt.LocalID, optionID)
	}

	log.Printf("Final option mapping: %+v", optionMapping)

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

	// Insert new requirements
	for _, reqItem := range req.NewRequirements {
		if reqItem.OptionID == 0 || reqItem.RequiredOptionID == 0 {
			log.Printf("Skipping invalid requirement: %+v", reqItem)
			continue
		}
		_, err := tx.Exec(`INSERT INTO game.quest_option_requirements (option_id, required_option_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			reqItem.OptionID, reqItem.RequiredOptionID)

		if err != nil {
			log.Printf("Error inserting requirement: %v", err)
			// Continue, don't fail on requirements
		}
	}

	// Insert pending requirements (between newly created options using local ID mapping)
	for _, pendingReq := range req.PendingRequirements {
		// Use server ID if already known, otherwise look up from optionMapping
		var optionServerId, requiredServerId int
		var hasOption, hasRequired bool

		if pendingReq.OptionServerID > 0 {
			optionServerId = pendingReq.OptionServerID
			hasOption = true
			log.Printf("Using pre-existing OptionServerID: %d", optionServerId)
		} else {
			optionServerId, hasOption = optionMapping[pendingReq.LocalOptionID]
			log.Printf("Looking up LocalOptionID %d in mapping: found=%v, serverID=%d", pendingReq.LocalOptionID, hasOption, optionServerId)
		}

		if pendingReq.RequiredServerID > 0 {
			requiredServerId = pendingReq.RequiredServerID
			hasRequired = true
			log.Printf("Using pre-existing RequiredServerID: %d", requiredServerId)
		} else {
			requiredServerId, hasRequired = optionMapping[pendingReq.LocalRequiredOptionID]
			log.Printf("Looking up LocalRequiredOptionID %d in mapping: found=%v, serverID=%d", pendingReq.LocalRequiredOptionID, hasRequired, requiredServerId)
		}

		if !hasOption || !hasRequired {
			log.Printf("Skipping pending requirement - missing mapping: local %d -> %v, local %d -> %v",
				pendingReq.LocalOptionID, hasOption, pendingReq.LocalRequiredOptionID, hasRequired)
			continue
		}

		log.Printf("Inserting requirement: option_id=%d, required_option_id=%d", optionServerId, requiredServerId)
		_, err := tx.Exec(`INSERT INTO game.quest_option_requirements (option_id, required_option_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			optionServerId, requiredServerId)

		if err != nil {
			log.Printf("Error inserting pending requirement: %v", err)
			// Continue, don't fail on requirements
		} else {
			log.Printf("Successfully inserted requirement: option_id=%d requires required_option_id=%d", optionServerId, requiredServerId)
		}
	}

	// Handle quest requisites (option -> quest connections)
	// This sets the requisite_option_id on quests
	for _, reqMapping := range req.QuestRequisites {
		var optionServerId, questServerId int

		// Get option server ID
		if reqMapping.OptionId > 0 {
			optionServerId = reqMapping.OptionId
		} else if reqMapping.LocalOptionId != 0 {
			if mappedId, ok := optionMapping[reqMapping.LocalOptionId]; ok {
				optionServerId = mappedId
			}
		}

		// Get quest server ID
		if reqMapping.QuestId > 0 {
			questServerId = reqMapping.QuestId
		} else if reqMapping.LocalQuestId != 0 {
			if mappedId, ok := questMapping[reqMapping.LocalQuestId]; ok {
				questServerId = mappedId
			}
		}

		if optionServerId > 0 && questServerId > 0 {
			_, err := tx.Exec(`UPDATE game.quests SET requisite_option_id = $1 WHERE quest_id = $2`,
				optionServerId, questServerId)
			if err != nil {
				log.Printf("Error setting quest requisite: quest %d <- option %d: %v", questServerId, optionServerId, err)
			} else {
				log.Printf("Set quest %d requisite_option_id = %d", questServerId, optionServerId)
			}
		} else {
			log.Printf("Skipping quest requisite - missing IDs: option=%d, quest=%d", optionServerId, questServerId)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success":       true,
		"questchainId":  questchainID,
		"questId":       questID,
		"optionMapping": optionMapping,
		"questMapping":  questMapping,
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

	// Delete requirements first
	_, err = tx.Exec(`DELETE FROM game.quest_option_requirements WHERE option_id = $1 OR required_option_id = $1`, req.OptionID)
	if err != nil {
		log.Printf("Error deleting requirements: %v", err)
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
