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
	Context      string `json:"context"`
	SettlementID int    `json:"settlement_id"`
}

// Quest represents a quest
type Quest struct {
	QuestID           int     `json:"quest_id"`
	QuestchainID      int     `json:"questchain_id"`
	QuestName         string  `json:"quest_name"`
	StartText         *string `json:"start_text"`
	TravelText        *string `json:"travel_text"`
	FailureText       *string `json:"failure_text"`
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
	OptionID           int     `json:"option_id"`
	QuestID            int     `json:"quest_id"`
	NodeText           string  `json:"node_text"`
	OptionText         string  `json:"option_text"`
	StatType           *string `json:"stat_type"`
	StatRequired       *int    `json:"stat_required"`
	EffectID           *int    `json:"effect_id"`
	EffectAmount       *int    `json:"effect_amount"`
	OptionEffectID     *int    `json:"option_effect_id"`
	OptionEffectFactor *int    `json:"option_effect_factor"`
	FactionRequired    *int    `json:"faction_required"`
	SilverRequired     *int    `json:"silver_required"`
	EnemyID            *int    `json:"enemy_id"`
	Start              bool    `json:"start"`
	QuestEnd           *bool   `json:"quest_end"`
	RewardStatType     *string `json:"reward_stat_type"`
	RewardStatAmount   *int    `json:"reward_stat_amount"`
	RewardTalent       *bool   `json:"reward_talent"`
	RewardItem         *int    `json:"reward_item"`
	RewardPerk         *int    `json:"reward_perk"`
	RewardBlessing     *int    `json:"reward_blessing"`
	RewardPotion       *int    `json:"reward_potion"`
	RewardSilver       *int    `json:"reward_silver"`
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
		chainQuery = `SELECT questchain_id, COALESCE(name, ''), COALESCE(context, ''), settlement_id 
			FROM game.questchain WHERE settlement_id = $1 ORDER BY questchain_id`
		chainArgs = []interface{}{*settlementID}
	} else {
		chainQuery = `SELECT questchain_id, COALESCE(name, ''), COALESCE(context, ''), settlement_id 
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
		err := chainRows.Scan(&c.QuestchainID, &c.Name, &c.Context, &c.SettlementID)
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
		questQuery := `SELECT quest_id, questchain_id, quest_name, start_text, travel_text, failure_text, requisite_option_id, ending, default_entry, settlement_id, asset_id,
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
			err := questRows.Scan(&q.QuestID, &q.QuestchainID, &q.QuestName, &q.StartText, &q.TravelText, &q.FailureText, &q.RequisiteOptionID, &q.Ending, &q.DefaultEntry, &q.SettlementID, &q.AssetID, &q.PosX, &q.PosY, &q.SortOrder)
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
			effect_id, effect_amount, option_effect_id, option_effect_factor, faction_required, silver_required, enemy_id, start, quest_end, reward_stat_type, reward_stat_amount, 
			reward_talent, reward_item, reward_perk, reward_blessing, reward_potion, reward_silver,
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
				&o.EffectID, &o.EffectAmount, &o.OptionEffectID, &o.OptionEffectFactor, &o.FactionRequired, &o.SilverRequired, &o.EnemyID, &o.Start, &o.QuestEnd, &o.RewardStatType, &o.RewardStatAmount,
				&o.RewardTalent, &o.RewardItem, &o.RewardPerk, &o.RewardBlessing, &o.RewardPotion, &o.RewardSilver,
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
	err := db.QueryRow(`INSERT INTO game.questchain (name, context, settlement_id) VALUES ($1, '', $2) RETURNING questchain_id`, req.QuestName, req.SettlementID).Scan(&questchainID)
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
	ChainContext string `json:"chainContext"`
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
	StartText    string  `json:"startText"`
	TravelText   string  `json:"travelText"`
	FailureText  string  `json:"failureText"`
	AssetID      *int    `json:"assetId"`
	PosX         float64 `json:"posX"`
	PosY         float64 `json:"posY"`
	SortOrder    int     `json:"sortOrder"`
}

// QuestUpdateData represents an update to an existing quest
type QuestUpdateData struct {
	QuestID     int     `json:"questId"`
	QuestName   string  `json:"questName"`
	StartText   string  `json:"startText"`
	TravelText  string  `json:"travelText"`
	FailureText string  `json:"failureText"`
	AssetID     *int    `json:"assetId"`
	PosX        float64 `json:"posX"`
	PosY        float64 `json:"posY"`
	SortOrder   int     `json:"sortOrder"`
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
	LocalID            int     `json:"localId"`
	QuestID            int     `json:"questId"`
	NodeText           string  `json:"nodeText"`
	OptionText         string  `json:"optionText"`
	IsStart            bool    `json:"isStart"`
	X                  float64 `json:"x"`
	Y                  float64 `json:"y"`
	StatType           *string `json:"statType"`
	StatRequired       *int    `json:"statRequired"`
	EffectID           *int    `json:"effectId"`
	EffectAmount       *int    `json:"effectAmount"`
	OptionEffectID     *int    `json:"optionEffectId"`
	OptionEffectFactor *int    `json:"optionEffectFactor"`
	FactionRequired    *int    `json:"factionRequired"`
	SilverRequired     *int    `json:"silverRequired"`
	EnemyID            *int    `json:"enemyId"`
	QuestEnd           *bool   `json:"questEnd"`
	RewardStatType     *string `json:"rewardStatType"`
	RewardStatAmount   *int    `json:"rewardStatAmount"`
	RewardTalent       *bool   `json:"rewardTalent"`
	RewardItem         *int    `json:"rewardItem"`
	RewardPerk         *int    `json:"rewardPerk"`
	RewardBlessing     *int    `json:"rewardBlessing"`
	RewardPotion       *int    `json:"rewardPotion"`
	RewardSilver       *int    `json:"rewardSilver"`
}

// QuestOptionUpdate represents an update to an existing option
type QuestOptionUpdate struct {
	OptionID           int     `json:"optionId"`
	LocalID            int     `json:"localId"`
	NodeText           string  `json:"nodeText"`
	OptionText         string  `json:"optionText"`
	IsStart            bool    `json:"isStart"`
	X                  float64 `json:"x"`
	Y                  float64 `json:"y"`
	StatType           *string `json:"statType"`
	StatRequired       *int    `json:"statRequired"`
	EffectID           *int    `json:"effectId"`
	EffectAmount       *int    `json:"effectAmount"`
	OptionEffectID     *int    `json:"optionEffectId"`
	OptionEffectFactor *int    `json:"optionEffectFactor"`
	FactionRequired    *int    `json:"factionRequired"`
	SilverRequired     *int    `json:"silverRequired"`
	EnemyID            *int    `json:"enemyId"`
	QuestEnd           *bool   `json:"questEnd"`
	RewardStatType     *string `json:"rewardStatType"`
	RewardStatAmount   *int    `json:"rewardStatAmount"`
	RewardTalent       *bool   `json:"rewardTalent"`
	RewardItem         *int    `json:"rewardItem"`
	RewardPerk         *int    `json:"rewardPerk"`
	RewardBlessing     *int    `json:"rewardBlessing"`
	RewardPotion       *int    `json:"rewardPotion"`
	RewardSilver       *int    `json:"rewardSilver"`
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
		log.Printf("SaveQuest decode error: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("SaveQuest: IsNewChain=%v, QuestchainID=%d, NewQuests=%d, QuestUpdates=%d, NewOptions=%d, OptionUpdates=%d, PendingReqs=%d",
		req.IsNewChain, req.QuestchainID, len(req.NewQuests), len(req.QuestUpdates), len(req.NewOptions), len(req.OptionUpdates), len(req.PendingRequirements))

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	questchainID := req.QuestchainID
	questID := req.QuestID
	questMapping := make(map[int]int)

	// ---- Create or update chain ----
	if req.IsNewChain {
		if err := tx.QueryRow(`INSERT INTO game.questchain (name, context, settlement_id)
			VALUES ($1, $2, $3) RETURNING questchain_id`,
			req.ChainName, req.ChainContext, req.SettlementID).Scan(&questchainID); err != nil {
			log.Printf("Error creating chain: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Created new chain: %d", questchainID)
	} else if questchainID > 0 && req.ChainName != "" {
		if _, err := tx.Exec(`UPDATE game.questchain SET name = $1, context = $2 WHERE questchain_id = $3`,
			req.ChainName, req.ChainContext, questchainID); err != nil {
			log.Printf("Error updating chain: %v", err)
		}
	}

	// ---- Bulk insert new quests ----
	if len(req.NewQuests) > 0 {
		inserted, err := bulkInsertQuests(tx, req.NewQuests, questchainID)
		if err != nil {
			log.Printf("Error bulk inserting quests: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		for localID, serverID := range inserted {
			questMapping[localID] = serverID
		}
		log.Printf("Bulk inserted %d quests", len(inserted))
	}

	// ---- Bulk update existing quests ----
	if len(req.QuestUpdates) > 0 {
		if err := bulkUpdateQuests(tx, req.QuestUpdates); err != nil {
			log.Printf("Error bulk updating quests: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Bulk updated %d quests", len(req.QuestUpdates))
	}

	// ---- Bulk delete options (before quests, FK order) ----
	if len(req.DeletedOptionIds) > 0 {
		if err := bulkDeleteQuestOptions(tx, req.DeletedOptionIds); err != nil {
			log.Printf("Error bulk deleting options: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Bulk deleted %d options", len(req.DeletedOptionIds))
	}

	// ---- Bulk delete quests ----
	if len(req.DeletedQuestIds) > 0 {
		if err := bulkDeleteQuests(tx, req.DeletedQuestIds); err != nil {
			log.Printf("Error bulk deleting quests: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Bulk deleted %d quests", len(req.DeletedQuestIds))
	}

	// ---- Legacy single-quest handling ----
	if req.IsNewQuest && questID == 0 {
		if err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, asset_id, default_entry, pos_x, pos_y)
			VALUES ($1, $2, $3, true, 50, 100) RETURNING quest_id`,
			req.QuestName, questchainID, req.AssetID).Scan(&questID); err != nil {
			log.Printf("Error creating legacy quest: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
	} else if questID > 0 {
		if req.AssetID != nil {
			tx.Exec(`UPDATE game.quests SET asset_id = $1 WHERE quest_id = $2`, *req.AssetID, questID)
		}
		if req.QuestName != "" {
			tx.Exec(`UPDATE game.quests SET quest_name = $1 WHERE quest_id = $2`, req.QuestName, questID)
		}
	}

	// ---- Resolve quest IDs for new options ----
	questCounter := len(req.NewQuests) + 1
	for i := range req.NewOptions {
		if serverID, ok := questMapping[req.NewOptions[i].QuestID]; ok {
			req.NewOptions[i].QuestID = serverID
		} else if req.NewOptions[i].QuestID == 0 && questID > 0 {
			req.NewOptions[i].QuestID = questID
		} else if req.NewOptions[i].QuestID <= 0 {
			var newQuestID int
			if err := tx.QueryRow(`INSERT INTO game.quests (quest_name, questchain_id, default_entry, pos_x, pos_y)
				VALUES ($1, $2, true, 50, 100) RETURNING quest_id`,
				fmt.Sprintf("Quest %d", questCounter), questchainID).Scan(&newQuestID); err != nil {
				log.Printf("Error creating fallback quest: %v", err)
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			questMapping[req.NewOptions[i].QuestID] = newQuestID
			req.NewOptions[i].QuestID = newQuestID
			questCounter++
		}
	}

	// ---- Bulk insert new options ----
	optionMapping := make(map[int]int)
	if len(req.NewOptions) > 0 {
		inserted, err := bulkInsertQuestOptions(tx, req.NewOptions)
		if err != nil {
			log.Printf("Error bulk inserting options: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		for localID, serverID := range inserted {
			optionMapping[localID] = serverID
		}
		log.Printf("Bulk inserted %d options", len(inserted))
	}

	// ---- Bulk update existing options ----
	if len(req.OptionUpdates) > 0 {
		if err := bulkUpdateQuestOptions(tx, req.OptionUpdates); err != nil {
			log.Printf("Error bulk updating options: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		log.Printf("Bulk updated %d options", len(req.OptionUpdates))
	}

	// ---- Bulk insert requirements ----
	if err := bulkInsertQuestRequirements(tx, req.NewRequirements, req.PendingRequirements, optionMapping); err != nil {
		log.Printf("Error inserting requirements: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// ---- Bulk update quest requisites ----
	if len(req.QuestRequisites) > 0 {
		if err := bulkUpdateQuestRequisites(tx, req.QuestRequisites, optionMapping, questMapping); err != nil {
			log.Printf("Error updating quest requisites: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing: %v", err)
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

// ==================== BULK QUEST HELPERS ====================

func bulkInsertQuests(tx *sql.Tx, newQuests []NewQuestData, questchainID int) (map[int]int, error) {
	n := len(newQuests)
	names := make([]string, n)
	startTexts := make([]string, n)
	travelTexts := make([]string, n)
	failureTexts := make([]string, n)
	chainIDs := make([]int64, n)
	assetIDs := make([]sql.NullInt64, n)
	defaults := make([]bool, n)
	posXs := make([]float64, n)
	posYs := make([]float64, n)
	sortOrders := make([]int64, n)

	for i, q := range newQuests {
		names[i] = q.QuestName
		startTexts[i] = q.StartText
		travelTexts[i] = q.TravelText
		failureTexts[i] = q.FailureText
		chainIDs[i] = int64(questchainID)
		assetIDs[i] = nullInt(q.AssetID)
		defaults[i] = true
		posXs[i] = q.PosX
		posYs[i] = q.PosY
		sortOrders[i] = int64(q.SortOrder)
	}

	rows, err := tx.Query(`
		INSERT INTO game.quests (quest_name, start_text, travel_text, failure_text, questchain_id, asset_id, default_entry, pos_x, pos_y, sort_order)
		SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::bool[], $8::float8[], $9::float8[], $10::int[])
		RETURNING quest_id
	`, pq.Array(names), pq.Array(startTexts), pq.Array(travelTexts), pq.Array(failureTexts),
		pq.Array(chainIDs), pq.Array(assetIDs), pq.Array(defaults),
		pq.Array(posXs), pq.Array(posYs), pq.Array(sortOrders))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	mapping := make(map[int]int, n)
	i := 0
	for rows.Next() {
		var dbID int
		if err := rows.Scan(&dbID); err != nil {
			return nil, err
		}
		mapping[newQuests[i].LocalQuestID] = dbID
		i++
	}
	return mapping, rows.Err()
}

func bulkUpdateQuests(tx *sql.Tx, updates []QuestUpdateData) error {
	n := len(updates)
	ids := make([]int64, n)
	names := make([]string, n)
	startTexts := make([]string, n)
	travelTexts := make([]string, n)
	failureTexts := make([]string, n)
	assetIDs := make([]sql.NullInt64, n)
	posXs := make([]float64, n)
	posYs := make([]float64, n)
	sortOrders := make([]int64, n)

	for i, u := range updates {
		ids[i] = int64(u.QuestID)
		names[i] = u.QuestName
		startTexts[i] = u.StartText
		travelTexts[i] = u.TravelText
		failureTexts[i] = u.FailureText
		assetIDs[i] = nullInt(u.AssetID)
		posXs[i] = u.PosX
		posYs[i] = u.PosY
		sortOrders[i] = int64(u.SortOrder)
	}

	_, err := tx.Exec(`
		UPDATE game.quests AS q SET
			quest_name   = v.quest_name,
			start_text   = v.start_text,
			travel_text  = v.travel_text,
			failure_text = v.failure_text,
			asset_id     = v.asset_id,
			pos_x        = v.pos_x,
			pos_y        = v.pos_y,
			sort_order   = v.sort_order
		FROM (
			SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::float8[], $8::float8[], $9::int[])
			AS t(quest_id, quest_name, start_text, travel_text, failure_text, asset_id, pos_x, pos_y, sort_order)
		) AS v
		WHERE q.quest_id = v.quest_id
	`, pq.Array(ids), pq.Array(names), pq.Array(startTexts), pq.Array(travelTexts), pq.Array(failureTexts),
		pq.Array(assetIDs), pq.Array(posXs), pq.Array(posYs), pq.Array(sortOrders))
	return err
}

func bulkDeleteQuestOptions(tx *sql.Tx, optionIDs []int) error {
	ids := make([]int64, len(optionIDs))
	for i, id := range optionIDs {
		ids[i] = int64(id)
	}
	idArr := pq.Array(ids)
	if _, err := tx.Exec(`DELETE FROM game.quest_option_requirements WHERE option_id = ANY($1) OR required_option_id = ANY($1)`, idArr); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE game.quests SET requisite_option_id = NULL WHERE requisite_option_id = ANY($1)`, idArr); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM game.quest_options WHERE option_id = ANY($1)`, idArr); err != nil {
		return err
	}
	return nil
}

func bulkDeleteQuests(tx *sql.Tx, questIDs []int) error {
	ids := make([]int64, len(questIDs))
	for i, id := range questIDs {
		ids[i] = int64(id)
	}
	idArr := pq.Array(ids)
	if _, err := tx.Exec(`DELETE FROM game.quest_options WHERE quest_id = ANY($1)`, idArr); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM game.quests WHERE quest_id = ANY($1)`, idArr); err != nil {
		return err
	}
	return nil
}

func bulkInsertQuestOptions(tx *sql.Tx, opts []NewQuestOption) (map[int]int, error) {
	n := len(opts)
	questIDs := make([]int64, n)
	nodeTexts := make([]string, n)
	optionTexts := make([]string, n)
	starts := make([]bool, n)
	statTypes := make([]sql.NullString, n)
	statReqs := make([]sql.NullInt64, n)
	effectIDs := make([]sql.NullInt64, n)
	effectAmts := make([]sql.NullInt64, n)
	optEffectIDs := make([]sql.NullInt64, n)
	optEffectFactors := make([]sql.NullInt64, n)
	factionReqs := make([]sql.NullInt64, n)
	silverReqs := make([]sql.NullInt64, n)
	enemyIDs := make([]sql.NullInt64, n)
	questEnds := make([]sql.NullBool, n)
	rewardStatTypes := make([]sql.NullString, n)
	rewardStatAmts := make([]sql.NullInt64, n)
	rewardTalents := make([]sql.NullBool, n)
	rewardItems := make([]sql.NullInt64, n)
	rewardPerks := make([]sql.NullInt64, n)
	rewardBlessings := make([]sql.NullInt64, n)
	rewardPotions := make([]sql.NullInt64, n)
	rewardSilvers := make([]sql.NullInt64, n)
	posXs := make([]float64, n)
	posYs := make([]float64, n)

	for i, o := range opts {
		questIDs[i] = int64(o.QuestID)
		nodeTexts[i] = o.NodeText
		optionTexts[i] = o.OptionText
		starts[i] = o.IsStart
		statTypes[i] = nullStr(o.StatType)
		statReqs[i] = nullInt(o.StatRequired)
		effectIDs[i] = nullInt(o.EffectID)
		effectAmts[i] = nullInt(o.EffectAmount)
		optEffectIDs[i] = nullInt(o.OptionEffectID)
		optEffectFactors[i] = nullInt(o.OptionEffectFactor)
		factionReqs[i] = nullInt(o.FactionRequired)
		silverReqs[i] = nullInt(o.SilverRequired)
		enemyIDs[i] = nullInt(o.EnemyID)
		questEnds[i] = nullBool(o.QuestEnd)
		rewardStatTypes[i] = nullStr(o.RewardStatType)
		rewardStatAmts[i] = nullInt(o.RewardStatAmount)
		rewardTalents[i] = nullBool(o.RewardTalent)
		rewardItems[i] = nullInt(o.RewardItem)
		rewardPerks[i] = nullInt(o.RewardPerk)
		rewardBlessings[i] = nullInt(o.RewardBlessing)
		rewardPotions[i] = nullInt(o.RewardPotion)
		rewardSilvers[i] = nullInt(o.RewardSilver)
		posXs[i] = o.X
		posYs[i] = o.Y
	}

	dbRows, err := tx.Query(`
		INSERT INTO game.quest_options (
			quest_id, node_text, option_text, start,
			stat_type, stat_required, effect_id, effect_amount, option_effect_id, option_effect_factor,
			faction_required, silver_required, enemy_id, quest_end,
			reward_stat_type, reward_stat_amount, reward_talent, reward_item, reward_perk,
			reward_blessing, reward_potion, reward_silver, pos_x, pos_y
		)
		SELECT * FROM unnest(
			$1::int[], $2::text[], $3::text[], $4::bool[],
			$5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[],
			$11::int[], $12::int[], $13::int[], $14::bool[],
			$15::text[], $16::int[], $17::bool[], $18::int[], $19::int[],
			$20::int[], $21::int[], $22::int[], $23::float8[], $24::float8[]
		)
		RETURNING option_id
	`,
		pq.Array(questIDs), pq.Array(nodeTexts), pq.Array(optionTexts), pq.Array(starts),
		pq.Array(statTypes), pq.Array(statReqs), pq.Array(effectIDs), pq.Array(effectAmts), pq.Array(optEffectIDs), pq.Array(optEffectFactors),
		pq.Array(factionReqs), pq.Array(silverReqs), pq.Array(enemyIDs), pq.Array(questEnds),
		pq.Array(rewardStatTypes), pq.Array(rewardStatAmts), pq.Array(rewardTalents), pq.Array(rewardItems), pq.Array(rewardPerks),
		pq.Array(rewardBlessings), pq.Array(rewardPotions), pq.Array(rewardSilvers), pq.Array(posXs), pq.Array(posYs),
	)
	if err != nil {
		return nil, err
	}
	defer dbRows.Close()

	mapping := make(map[int]int, n)
	i := 0
	for dbRows.Next() {
		var id int
		if err := dbRows.Scan(&id); err != nil {
			return nil, err
		}
		mapping[opts[i].LocalID] = id
		i++
	}
	return mapping, dbRows.Err()
}

func bulkUpdateQuestOptions(tx *sql.Tx, updates []QuestOptionUpdate) error {
	n := len(updates)
	ids := make([]int64, n)
	nodeTexts := make([]string, n)
	optionTexts := make([]string, n)
	starts := make([]bool, n)
	statTypes := make([]sql.NullString, n)
	statReqs := make([]sql.NullInt64, n)
	effectIDs := make([]sql.NullInt64, n)
	effectAmts := make([]sql.NullInt64, n)
	optEffectIDs := make([]sql.NullInt64, n)
	optEffectFactors := make([]sql.NullInt64, n)
	factionReqs := make([]sql.NullInt64, n)
	silverReqs := make([]sql.NullInt64, n)
	enemyIDs := make([]sql.NullInt64, n)
	questEnds := make([]sql.NullBool, n)
	rewardStatTypes := make([]sql.NullString, n)
	rewardStatAmts := make([]sql.NullInt64, n)
	rewardTalents := make([]sql.NullBool, n)
	rewardItems := make([]sql.NullInt64, n)
	rewardPerks := make([]sql.NullInt64, n)
	rewardBlessings := make([]sql.NullInt64, n)
	rewardPotions := make([]sql.NullInt64, n)
	rewardSilvers := make([]sql.NullInt64, n)
	posXs := make([]float64, n)
	posYs := make([]float64, n)

	for i, u := range updates {
		ids[i] = int64(u.OptionID)
		nodeTexts[i] = u.NodeText
		optionTexts[i] = u.OptionText
		starts[i] = u.IsStart
		statTypes[i] = nullStr(u.StatType)
		statReqs[i] = nullInt(u.StatRequired)
		effectIDs[i] = nullInt(u.EffectID)
		effectAmts[i] = nullInt(u.EffectAmount)
		optEffectIDs[i] = nullInt(u.OptionEffectID)
		optEffectFactors[i] = nullInt(u.OptionEffectFactor)
		factionReqs[i] = nullInt(u.FactionRequired)
		silverReqs[i] = nullInt(u.SilverRequired)
		enemyIDs[i] = nullInt(u.EnemyID)
		questEnds[i] = nullBool(u.QuestEnd)
		rewardStatTypes[i] = nullStr(u.RewardStatType)
		rewardStatAmts[i] = nullInt(u.RewardStatAmount)
		rewardTalents[i] = nullBool(u.RewardTalent)
		rewardItems[i] = nullInt(u.RewardItem)
		rewardPerks[i] = nullInt(u.RewardPerk)
		rewardBlessings[i] = nullInt(u.RewardBlessing)
		rewardPotions[i] = nullInt(u.RewardPotion)
		rewardSilvers[i] = nullInt(u.RewardSilver)
		posXs[i] = u.X
		posYs[i] = u.Y
	}

	_, err := tx.Exec(`
		UPDATE game.quest_options AS o SET
			node_text            = v.node_text,
			option_text          = v.option_text,
			start                = v.start,
			stat_type            = v.stat_type,
			stat_required        = v.stat_required,
			effect_id            = v.effect_id,
			effect_amount        = v.effect_amount,
			option_effect_id     = v.option_effect_id,
			option_effect_factor = v.option_effect_factor,
			faction_required     = v.faction_required,
			silver_required      = v.silver_required,
			enemy_id             = v.enemy_id,
			quest_end            = v.quest_end,
			reward_stat_type     = v.reward_stat_type,
			reward_stat_amount   = v.reward_stat_amount,
			reward_talent        = v.reward_talent,
			reward_item          = v.reward_item,
			reward_perk          = v.reward_perk,
			reward_blessing      = v.reward_blessing,
			reward_potion        = v.reward_potion,
			reward_silver        = v.reward_silver,
			pos_x                = v.pos_x,
			pos_y                = v.pos_y
		FROM (
			SELECT * FROM unnest(
				$1::int[], $2::text[], $3::text[], $4::bool[],
				$5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[],
				$11::int[], $12::int[], $13::int[], $14::bool[],
				$15::text[], $16::int[], $17::bool[], $18::int[], $19::int[],
				$20::int[], $21::int[], $22::int[], $23::float8[], $24::float8[]
			) AS t(option_id, node_text, option_text, start,
			       stat_type, stat_required, effect_id, effect_amount, option_effect_id, option_effect_factor,
			       faction_required, silver_required, enemy_id, quest_end,
			       reward_stat_type, reward_stat_amount, reward_talent, reward_item, reward_perk,
			       reward_blessing, reward_potion, reward_silver, pos_x, pos_y)
		) AS v
		WHERE o.option_id = v.option_id
	`,
		pq.Array(ids), pq.Array(nodeTexts), pq.Array(optionTexts), pq.Array(starts),
		pq.Array(statTypes), pq.Array(statReqs), pq.Array(effectIDs), pq.Array(effectAmts), pq.Array(optEffectIDs), pq.Array(optEffectFactors),
		pq.Array(factionReqs), pq.Array(silverReqs), pq.Array(enemyIDs), pq.Array(questEnds),
		pq.Array(rewardStatTypes), pq.Array(rewardStatAmts), pq.Array(rewardTalents), pq.Array(rewardItems), pq.Array(rewardPerks),
		pq.Array(rewardBlessings), pq.Array(rewardPotions), pq.Array(rewardSilvers), pq.Array(posXs), pq.Array(posYs),
	)
	return err
}

func bulkInsertQuestRequirements(tx *sql.Tx, newReqs []QuestOptionRequirement, pendingReqs []PendingRequirement, optionMapping map[int]int) error {
	var optionIDs, requiredIDs []int64

	for _, r := range newReqs {
		if r.OptionID > 0 && r.RequiredOptionID > 0 {
			optionIDs = append(optionIDs, int64(r.OptionID))
			requiredIDs = append(requiredIDs, int64(r.RequiredOptionID))
		}
	}

	for _, pr := range pendingReqs {
		var optID, reqID int
		if pr.OptionServerID > 0 {
			optID = pr.OptionServerID
		} else {
			optID = optionMapping[pr.LocalOptionID]
		}
		if pr.RequiredServerID > 0 {
			reqID = pr.RequiredServerID
		} else {
			reqID = optionMapping[pr.LocalRequiredOptionID]
		}
		if optID > 0 && reqID > 0 {
			optionIDs = append(optionIDs, int64(optID))
			requiredIDs = append(requiredIDs, int64(reqID))
		} else {
			log.Printf("Skipping requirement - missing mapping: local %d->%d, local %d->%d",
				pr.LocalOptionID, optID, pr.LocalRequiredOptionID, reqID)
		}
	}

	if len(optionIDs) == 0 {
		return nil
	}

	_, err := tx.Exec(`
		INSERT INTO game.quest_option_requirements (option_id, required_option_id)
		SELECT * FROM unnest($1::int[], $2::int[])
		ON CONFLICT DO NOTHING
	`, pq.Array(optionIDs), pq.Array(requiredIDs))
	return err
}

func bulkUpdateQuestRequisites(tx *sql.Tx, requisites []QuestRequisiteMapping, optionMapping, questMapping map[int]int) error {
	var questIDs, optionIDs []int64

	for _, r := range requisites {
		optID := r.OptionId
		if optID == 0 && r.LocalOptionId != 0 {
			optID = optionMapping[r.LocalOptionId]
		}
		qID := r.QuestId
		if qID == 0 && r.LocalQuestId != 0 {
			qID = questMapping[r.LocalQuestId]
		}
		if optID > 0 && qID > 0 {
			questIDs = append(questIDs, int64(qID))
			optionIDs = append(optionIDs, int64(optID))
		} else {
			log.Printf("Skipping quest requisite - missing IDs: option=%d, quest=%d", optID, qID)
		}
	}

	if len(questIDs) == 0 {
		return nil
	}

	_, err := tx.Exec(`
		UPDATE game.quests AS q
		SET requisite_option_id = v.option_id
		FROM (SELECT * FROM unnest($1::int[], $2::int[]) AS t(quest_id, option_id)) AS v
		WHERE q.quest_id = v.quest_id
	`, pq.Array(questIDs), pq.Array(optionIDs))
	return err
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
