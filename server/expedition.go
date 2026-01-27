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

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ExpeditionSlide represents a slide in the expedition designer
type ExpeditionSlide struct {
	ID             int                `json:"id"`
	Text           string             `json:"text"`
	AssetID        *int               `json:"assetId"`
	EffectID       *int               `json:"effectId"`
	EffectFactor   *int               `json:"effectFactor"`
	IsStart        bool               `json:"isStart"`
	SettlementID   *int               `json:"settlementId"`
	RewardStatType *string            `json:"rewardStatType"`
	RewardStatAmt  *int               `json:"rewardStatAmount"`
	RewardTalent   *bool              `json:"rewardTalent"`
	RewardItem     *int               `json:"rewardItem"`
	RewardPerk     *int               `json:"rewardPerk"`
	RewardBlessing *int               `json:"rewardBlessing"`
	RewardPotion   *int               `json:"rewardPotion"`
	PosX           float64            `json:"posX" db:"pos_x"`
	PosY           float64            `json:"posY" db:"pos_y"`
	Options        []ExpeditionOption `json:"options"`
}

// ExpeditionOption represents an option on a slide
type ExpeditionOption struct {
	Text         string  `json:"text"`
	StatType     *string `json:"statType"`
	StatRequired *int    `json:"statRequired"`
	EffectID     *int    `json:"effectId"`
	EffectAmount *int    `json:"effectAmount"`
	EnemyID      *int    `json:"enemyId"`
	// Connections to target slides (local IDs from the designer)
	Connections []ExpeditionConnection `json:"connections"`
}

// ExpeditionConnection represents a connection from an option to a target slide
type ExpeditionConnection struct {
	TargetSlideLocalID int  `json:"targetSlideId"`   // Local ID from designer (for new slides)
	TargetToolingID    *int `json:"targetToolingId"` // Tooling ID (for existing server slides)
	Weight             int  `json:"weight"`
}

// NewOptionForExistingSlide represents a new option being added to an existing server slide
type NewOptionForExistingSlide struct {
	SlideLocalID   int                    `json:"slideLocalId"`   // Local ID from designer
	OptionIndex    int                    `json:"optionIndex"`    // Option index on the slide
	SlideToolingID int                    `json:"slideToolingId"` // Existing slide's tooling_id
	Text           string                 `json:"text"`
	StatType       *string                `json:"statType"`
	StatRequired   *int                   `json:"statRequired"`
	EffectID       *int                   `json:"effectId"`
	EffectAmount   *int                   `json:"effectAmount"`
	EnemyID        *int                   `json:"enemyId"`
	Connections    []ExpeditionConnection `json:"connections"`
}

// NewConnectionForExistingOption represents a new connection being added to an existing server option
type NewConnectionForExistingOption struct {
	OptionToolingID    int  `json:"optionToolingId"` // Existing option's tooling_id
	TargetSlideLocalID int  `json:"targetSlideId"`   // Local ID from designer (for new slides)
	TargetToolingID    *int `json:"targetToolingId"` // Tooling ID (for existing server slides)
	Weight             int  `json:"weight"`
}

// SlideUpdate represents updates to an existing slide
type SlideUpdate struct {
	ToolingID      int     `json:"toolingId"`
	Text           string  `json:"text"`
	AssetID        *int    `json:"assetId"`
	EffectID       *int    `json:"effectId"`
	EffectFactor   *int    `json:"effectFactor"`
	IsStart        bool    `json:"isStart"`
	RewardStatType *string `json:"rewardStatType"`
	RewardStatAmt  *int    `json:"rewardStatAmount"`
	RewardTalent   *bool   `json:"rewardTalent"`
	RewardItem     *int    `json:"rewardItem"`
	RewardPerk     *int    `json:"rewardPerk"`
	RewardBlessing *int    `json:"rewardBlessing"`
	RewardPotion   *int    `json:"rewardPotion"`
	PosX           float64 `json:"posX"`
	PosY           float64 `json:"posY"`
}

// OptionUpdate represents updates to an existing option
type OptionUpdate struct {
	ToolingID    int     `json:"toolingId"`
	Text         string  `json:"text"`
	StatType     *string `json:"statType"`
	StatRequired *int    `json:"statRequired"`
	EffectID     *int    `json:"effectId"`
	EffectAmount *int    `json:"effectAmount"`
	EnemyID      *int    `json:"enemyId"`
}

// SaveExpeditionRequest is the request body for saving an expedition
type SaveExpeditionRequest struct {
	Slides         []ExpeditionSlide                `json:"slides"`
	NewOptions     []NewOptionForExistingSlide      `json:"newOptions"`     // New options for existing slides
	NewConnections []NewConnectionForExistingOption `json:"newConnections"` // New connections for existing options
	SlideUpdates   []SlideUpdate                    `json:"slideUpdates"`   // Updates to existing slides
	OptionUpdates  []OptionUpdate                   `json:"optionUpdates"`  // Updates to existing options
	SettlementID   *int                             `json:"settlementId"`
}

// SaveExpeditionResponse contains the result of saving
type SaveExpeditionResponse struct {
	Success       bool           `json:"success"`
	Message       string         `json:"message"`
	SlideMapping  map[int]int    `json:"slideMapping"`  // local ID -> tooling_id
	OptionMapping map[string]int `json:"optionMapping"` // "slideLocalId-optionIndex" -> tooling_id
}

func handleSaveExpedition(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Authenticate
	if !isAuthenticated(r) {
		log.Printf("Authentication failed for saveExpedition")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	log.Printf("Saving expedition - authenticated")

	// Parse request
	var req SaveExpeditionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Failed to parse request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("Received %d slides to save", len(req.Slides))

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	// Begin transaction
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Maps to track local IDs to database IDs
	slideMapping := make(map[int]int)     // localID -> tooling_id
	optionMapping := make(map[string]int) // "localSlideID-optionIndex" -> tooling_id

	// Step 1: Insert all slides first (without options) to get their tooling_ids
	for _, slide := range req.Slides {
		var toolingID int

		// Build reward fields from the slide's reward object
		var rewardStatType *string
		var rewardStatAmount *int
		var rewardTalent *bool
		var rewardItem *int
		var rewardPerk *int
		var rewardBlessing *int
		var rewardPotion *int

		// These come directly from the slide struct now
		rewardStatType = slide.RewardStatType
		rewardStatAmount = slide.RewardStatAmt
		rewardTalent = slide.RewardTalent
		rewardItem = slide.RewardItem
		rewardPerk = slide.RewardPerk
		rewardBlessing = slide.RewardBlessing
		rewardPotion = slide.RewardPotion

		// Extract effect fields
		var effectID *int
		var effectFactor *int
		effectID = slide.EffectID
		effectFactor = slide.EffectFactor

		// Handle NOT NULL columns with defaults
		slideText := slide.Text
		if slideText == "" {
			slideText = "" // Keep empty string, not NULL
		}

		// asset_id is NOT NULL, use 0 as default
		assetID := 0
		if slide.AssetID != nil {
			assetID = *slide.AssetID
		}

		err := tx.QueryRow(`
			INSERT INTO tooling.expedition_slides (
				action, slide_text, asset_id, effect_id, effect_factor, is_start, settlement_id,
				reward_stat_type, reward_stat_amount, reward_talent, reward_item, 
				reward_perk, reward_blessing, reward_potion, pos_x, pos_y, approved
			) VALUES (
				'insert', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false
			) RETURNING tooling_id
		`, slideText, assetID, effectID, effectFactor, slide.IsStart, req.SettlementID,
			rewardStatType, rewardStatAmount, rewardTalent, rewardItem,
			rewardPerk, rewardBlessing, rewardPotion, slide.PosX, slide.PosY).Scan(&toolingID)

		if err != nil {
			log.Printf("Failed to insert slide %d: %v", slide.ID, err)
			http.Error(w, fmt.Sprintf("Failed to save slide: %v", err), http.StatusInternalServerError)
			return
		}

		slideMapping[slide.ID] = toolingID
		log.Printf("Inserted slide local:%d -> tooling:%d", slide.ID, toolingID)
	}

	// Step 2: Insert all options for each slide
	for _, slide := range req.Slides {
		slideToolingID := slideMapping[slide.ID]

		for optIdx, option := range slide.Options {
			var optionToolingID int

			err := tx.QueryRow(`
				INSERT INTO tooling.expedition_options (
					action, slide_id, option_text, stat_type, stat_required, 
					effect_id, effect_amount, enemy_id, approved
				) VALUES (
					'insert', $1, $2, $3, $4, $5, $6, $7, false
				) RETURNING tooling_id
			`, slideToolingID, option.Text, option.StatType, option.StatRequired,
				option.EffectID, option.EffectAmount, option.EnemyID).Scan(&optionToolingID)

			if err != nil {
				log.Printf("Failed to insert option for slide %d: %v", slide.ID, err)
				http.Error(w, "Failed to save option", http.StatusInternalServerError)
				return
			}

			optionKey := formatOptionKey(slide.ID, optIdx)
			optionMapping[optionKey] = optionToolingID
			log.Printf("Inserted option slide:%d opt:%d -> tooling:%d", slide.ID, optIdx, optionToolingID)
		}
	}

	// Step 3: Insert all outcomes (connections)
	for _, slide := range req.Slides {
		for optIdx, option := range slide.Options {
			optionKey := formatOptionKey(slide.ID, optIdx)
			optionToolingID := optionMapping[optionKey]

			for _, conn := range option.Connections {
				var targetSlideToolingID int

				// If connection has a TargetToolingID, use it (connecting to existing server slide)
				// Otherwise, look up in our slideMapping (connecting to a new slide)
				if conn.TargetToolingID != nil && *conn.TargetToolingID > 0 {
					targetSlideToolingID = *conn.TargetToolingID
					log.Printf("Connection to existing server slide: toolingId=%d", targetSlideToolingID)
				} else {
					var ok bool
					targetSlideToolingID, ok = slideMapping[conn.TargetSlideLocalID]
					if !ok {
						log.Printf("Warning: Target slide %d not found in mapping, skipping connection", conn.TargetSlideLocalID)
						continue
					}
				}

				weight := conn.Weight
				if weight <= 0 {
					weight = 1
				}

				_, err := tx.Exec(`
					INSERT INTO tooling.expedition_outcomes (
						action, option_id, target_slide_id, weight, approved
					) VALUES (
						'insert', $1, $2, $3, false
					)
				`, optionToolingID, targetSlideToolingID, weight)

				if err != nil {
					log.Printf("Failed to insert outcome: %v", err)
					http.Error(w, "Failed to save connection", http.StatusInternalServerError)
					return
				}

				log.Printf("Inserted outcome: option:%d -> slide:%d (weight:%d)",
					optionToolingID, targetSlideToolingID, weight)
			}
		}
	}

	// Step 4: Insert new options for existing slides
	for _, newOpt := range req.NewOptions {
		var optionToolingID int

		err := tx.QueryRow(`
			INSERT INTO tooling.expedition_options (
				action, slide_id, option_text, stat_type, stat_required, 
				effect_id, effect_amount, enemy_id, approved
			) VALUES (
				'insert', $1, $2, $3, $4, $5, $6, $7, false
			) RETURNING tooling_id
		`, newOpt.SlideToolingID, newOpt.Text, newOpt.StatType, newOpt.StatRequired,
			newOpt.EffectID, newOpt.EffectAmount, newOpt.EnemyID).Scan(&optionToolingID)

		if err != nil {
			log.Printf("Failed to insert new option for existing slide %d: %v", newOpt.SlideToolingID, err)
			http.Error(w, "Failed to save new option", http.StatusInternalServerError)
			return
		}

		// Track in optionMapping using the local slide ID and option index
		optionKey := formatOptionKey(newOpt.SlideLocalID, newOpt.OptionIndex)
		optionMapping[optionKey] = optionToolingID
		log.Printf("Inserted new option for existing slide:%d -> option tooling:%d (mapped as %s)", newOpt.SlideToolingID, optionToolingID, optionKey)

		// Insert connections for this new option
		for _, conn := range newOpt.Connections {
			var targetSlideToolingID int

			if conn.TargetToolingID != nil && *conn.TargetToolingID > 0 {
				targetSlideToolingID = *conn.TargetToolingID
			} else {
				var ok bool
				targetSlideToolingID, ok = slideMapping[conn.TargetSlideLocalID]
				if !ok {
					log.Printf("Warning: Target slide %d not found in mapping, skipping connection for new option", conn.TargetSlideLocalID)
					continue
				}
			}

			weight := conn.Weight
			if weight <= 0 {
				weight = 1
			}

			_, err := tx.Exec(`
				INSERT INTO tooling.expedition_outcomes (
					action, option_id, target_slide_id, weight, approved
				) VALUES (
					'insert', $1, $2, $3, false
				)
			`, optionToolingID, targetSlideToolingID, weight)

			if err != nil {
				log.Printf("Failed to insert outcome for new option: %v", err)
				http.Error(w, "Failed to save connection for new option", http.StatusInternalServerError)
				return
			}

			log.Printf("Inserted outcome for new option: option:%d -> slide:%d", optionToolingID, targetSlideToolingID)
		}
	}

	// Step 5: Insert new connections for existing options
	for _, newConn := range req.NewConnections {
		var targetSlideToolingID int

		if newConn.TargetToolingID != nil && *newConn.TargetToolingID > 0 {
			targetSlideToolingID = *newConn.TargetToolingID
		} else {
			var ok bool
			targetSlideToolingID, ok = slideMapping[newConn.TargetSlideLocalID]
			if !ok {
				log.Printf("Warning: Target slide %d not found in mapping, skipping new connection", newConn.TargetSlideLocalID)
				continue
			}
		}

		weight := newConn.Weight
		if weight <= 0 {
			weight = 1
		}

		_, err := tx.Exec(`
			INSERT INTO tooling.expedition_outcomes (
				action, option_id, target_slide_id, weight, approved
			) VALUES (
				'insert', $1, $2, $3, false
			)
		`, newConn.OptionToolingID, targetSlideToolingID, weight)

		if err != nil {
			log.Printf("Failed to insert new connection for existing option %d: %v", newConn.OptionToolingID, err)
			http.Error(w, "Failed to save new connection", http.StatusInternalServerError)
			return
		}

		log.Printf("Inserted new connection: existing option:%d -> slide:%d", newConn.OptionToolingID, targetSlideToolingID)
	}

	// Step 6: Update existing slides
	for _, update := range req.SlideUpdates {
		assetID := 0
		if update.AssetID != nil {
			assetID = *update.AssetID
		}

		_, err := tx.Exec(`
			UPDATE tooling.expedition_slides SET
				slide_text = $1, asset_id = $2, effect_id = $3, effect_factor = $4,
				is_start = $5, reward_stat_type = $6, reward_stat_amount = $7,
				reward_talent = $8, reward_item = $9, reward_perk = $10,
				reward_blessing = $11, reward_potion = $12, pos_x = $13, pos_y = $14
			WHERE tooling_id = $15
		`, update.Text, assetID, update.EffectID, update.EffectFactor,
			update.IsStart, update.RewardStatType, update.RewardStatAmt,
			update.RewardTalent, update.RewardItem, update.RewardPerk,
			update.RewardBlessing, update.RewardPotion, update.PosX, update.PosY,
			update.ToolingID)

		if err != nil {
			log.Printf("Failed to update slide %d: %v", update.ToolingID, err)
			http.Error(w, "Failed to update slide", http.StatusInternalServerError)
			return
		}

		log.Printf("Updated slide tooling_id:%d", update.ToolingID)
	}

	// Step 7: Update existing options
	for _, update := range req.OptionUpdates {
		_, err := tx.Exec(`
			UPDATE tooling.expedition_options SET
				option_text = $1, stat_type = $2, stat_required = $3,
				effect_id = $4, effect_amount = $5, enemy_id = $6
			WHERE tooling_id = $7
		`, update.Text, update.StatType, update.StatRequired,
			update.EffectID, update.EffectAmount, update.EnemyID,
			update.ToolingID)

		if err != nil {
			log.Printf("Failed to update option %d: %v", update.ToolingID, err)
			http.Error(w, "Failed to update option", http.StatusInternalServerError)
			return
		}

		log.Printf("Updated option tooling_id:%d", update.ToolingID)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		http.Error(w, "Failed to save expedition", http.StatusInternalServerError)
		return
	}

	// Return success response
	response := SaveExpeditionResponse{
		Success:       true,
		Message:       "Expedition saved successfully",
		SlideMapping:  slideMapping,
		OptionMapping: optionMapping,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("Expedition saved: %d slides, %d options", len(slideMapping), len(optionMapping))
}

func formatOptionKey(slideID, optionIndex int) string {
	return fmt.Sprintf("%d-%d", slideID, optionIndex)
}

// ==================== LOAD EXPEDITION DATA ====================

// LoadedSlide represents a slide loaded from the database
type LoadedSlide struct {
	ToolingID      int            `json:"toolingId"`
	SlideText      string         `json:"text"`
	AssetID        *int           `json:"assetId"`
	EffectID       *int           `json:"effectId"`
	EffectFactor   *int           `json:"effectFactor"`
	IsStart        bool           `json:"isStart"`
	SettlementID   *int           `json:"settlementId"`
	RewardStatType *string        `json:"rewardStatType"`
	RewardStatAmt  *int           `json:"rewardStatAmount"`
	RewardTalent   *bool          `json:"rewardTalent"`
	RewardItem     *int           `json:"rewardItem"`
	RewardPerk     *int           `json:"rewardPerk"`
	RewardBlessing *int           `json:"rewardBlessing"`
	RewardPotion   *int           `json:"rewardPotion"`
	PosX           float64        `json:"posX"`
	PosY           float64        `json:"posY"`
	Approved       bool           `json:"approved"`
	Options        []LoadedOption `json:"options"`
}

// LoadedOption represents an option loaded from the database
type LoadedOption struct {
	ToolingID    int             `json:"toolingId"`
	OptionText   string          `json:"text"`
	StatType     *string         `json:"statType"`
	StatRequired *int            `json:"statRequired"`
	EffectID     *int            `json:"effectId"`
	EffectAmount *int            `json:"effectAmount"`
	EnemyID      *int            `json:"enemyId"`
	Approved     bool            `json:"approved"`
	Outcomes     []LoadedOutcome `json:"outcomes"`
}

// LoadedOutcome represents an outcome (connection) from database
type LoadedOutcome struct {
	ToolingID     int  `json:"toolingId"`
	TargetSlideID int  `json:"targetSlideId"` // This is the tooling_id of the target slide
	Weight        int  `json:"weight"`
	Approved      bool `json:"approved"`
}

// GetExpeditionResponse is the response for loading expedition data
type GetExpeditionResponse struct {
	Success bool          `json:"success"`
	Slides  []LoadedSlide `json:"slides"`
}

func handleGetExpedition(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Authenticate
	if !isAuthenticated(r) {
		log.Printf("Authentication failed for getExpedition")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	// Step 1: Load all slides from tooling
	slides := make(map[int]*LoadedSlide)

	slideRows, err := db.Query(`
		SELECT tooling_id, COALESCE(slide_text, ''), asset_id, effect_id, effect_factor, 
		       COALESCE(is_start, false), settlement_id,
		       reward_stat_type, reward_stat_amount, reward_talent, reward_item,
		       reward_perk, reward_blessing, reward_potion, 
		       COALESCE(pos_x, 100), COALESCE(pos_y, 100), COALESCE(approved, false)
		FROM tooling.expedition_slides
		WHERE action = 'insert'
		ORDER BY tooling_id
	`)
	if err != nil {
		log.Printf("Failed to query slides: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer slideRows.Close()

	for slideRows.Next() {
		var s LoadedSlide
		err := slideRows.Scan(
			&s.ToolingID, &s.SlideText, &s.AssetID, &s.EffectID, &s.EffectFactor,
			&s.IsStart, &s.SettlementID,
			&s.RewardStatType, &s.RewardStatAmt, &s.RewardTalent, &s.RewardItem,
			&s.RewardPerk, &s.RewardBlessing, &s.RewardPotion, &s.PosX, &s.PosY, &s.Approved,
		)
		if err != nil {
			log.Printf("Failed to scan slide: %v", err)
			continue
		}
		s.Options = []LoadedOption{}
		slides[s.ToolingID] = &s
	}

	log.Printf("Loaded %d slides from tooling", len(slides))

	// Step 2: Load all options and attach to slides
	optionRows, err := db.Query(`
		SELECT tooling_id, slide_id, COALESCE(option_text, ''), stat_type, stat_required,
		       effect_id, effect_amount, enemy_id, COALESCE(approved, false)
		FROM tooling.expedition_options
		WHERE action = 'insert'
		ORDER BY tooling_id
	`)
	if err != nil {
		log.Printf("Failed to query options: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer optionRows.Close()

	options := make(map[int]*LoadedOption)

	for optionRows.Next() {
		var o LoadedOption
		var slideID int
		err := optionRows.Scan(
			&o.ToolingID, &slideID, &o.OptionText, &o.StatType, &o.StatRequired,
			&o.EffectID, &o.EffectAmount, &o.EnemyID, &o.Approved,
		)
		if err != nil {
			log.Printf("Failed to scan option: %v", err)
			continue
		}
		o.Outcomes = []LoadedOutcome{}
		options[o.ToolingID] = &o

		// Attach to slide
		if slide, ok := slides[slideID]; ok {
			slide.Options = append(slide.Options, o)
		}
	}

	log.Printf("Loaded %d options from tooling", len(options))

	// Step 3: Load all outcomes and attach to options
	outcomeRows, err := db.Query(`
		SELECT tooling_id, option_id, target_slide_id, COALESCE(weight, 1), COALESCE(approved, false)
		FROM tooling.expedition_outcomes
		WHERE action = 'insert'
		ORDER BY tooling_id
	`)
	if err != nil {
		log.Printf("Failed to query outcomes: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer outcomeRows.Close()

	outcomeCount := 0
	for outcomeRows.Next() {
		var oc LoadedOutcome
		var optionID int
		err := outcomeRows.Scan(
			&oc.ToolingID, &optionID, &oc.TargetSlideID, &oc.Weight, &oc.Approved,
		)
		if err != nil {
			log.Printf("Failed to scan outcome: %v", err)
			continue
		}
		outcomeCount++

		// Find the option and add the outcome
		// Need to find it in the slides' options
		for _, slide := range slides {
			for i := range slide.Options {
				if slide.Options[i].ToolingID == optionID {
					slide.Options[i].Outcomes = append(slide.Options[i].Outcomes, oc)
				}
			}
		}
	}

	log.Printf("Loaded %d outcomes from tooling", outcomeCount)

	// Convert map to slice
	slideList := make([]LoadedSlide, 0, len(slides))
	for _, slide := range slides {
		slideList = append(slideList, *slide)
	}

	response := GetExpeditionResponse{
		Success: true,
		Slides:  slideList,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ==================== EXPEDITION ASSETS ====================

// ExpeditionAsset represents an asset for expedition backgrounds
type ExpeditionAsset struct {
	AssetID int    `json:"assetID"`
	Name    string `json:"name"`
	Icon    string `json:"icon"`
}

// handleGetExpeditionAssets lists all expedition assets from S3
func handleGetExpeditionAssets(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET EXPEDITION ASSETS REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		http.Error(w, "S3 client not available", http.StatusInternalServerError)
		return
	}

	assets, err := listExpeditionAssets()
	if err != nil {
		log.Printf("Error listing expedition assets: %v", err)
		http.Error(w, fmt.Sprintf("Failed to list assets: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("Found %d expedition assets in S3", len(assets))

	response := map[string]interface{}{
		"success": true,
		"assets":  assets,
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("✅ GET EXPEDITION ASSETS RESPONSE SENT")
}

// listExpeditionAssets lists all expedition assets from S3 (images/expedition/)
func listExpeditionAssets() ([]ExpeditionAsset, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not initialized")
	}

	prefix := "images/expedition/"

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(S3_BUCKET_NAME),
		Prefix: aws.String(prefix),
	}

	result, err := s3Client.ListObjectsV2(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 objects: %v", err)
	}

	var assets []ExpeditionAsset
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
			log.Printf("Non-numeric expedition asset: %s, skipping", filename)
			continue
		}

		publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
			S3_BUCKET_NAME, S3_REGION, key)

		assets = append(assets, ExpeditionAsset{
			AssetID: assetID,
			Name:    nameWithoutExt,
			Icon:    publicURL,
		})
	}

	return assets, nil
}

// handleUploadExpeditionAsset uploads a new expedition asset to S3
func handleUploadExpeditionAsset(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPLOAD EXPEDITION ASSET REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s3Client == nil {
		http.Error(w, "S3 client not available", http.StatusInternalServerError)
		return
	}

	var req struct {
		ImageData   string `json:"imageData"`
		ContentType string `json:"contentType"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error parsing request: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Find the next available asset ID
	assets, err := listExpeditionAssets()
	if err != nil {
		log.Printf("Error listing assets for ID: %v", err)
		http.Error(w, "Failed to determine asset ID", http.StatusInternalServerError)
		return
	}

	maxID := 0
	for _, asset := range assets {
		if asset.AssetID > maxID {
			maxID = asset.AssetID
		}
	}
	newAssetID := maxID + 1

	log.Printf("Uploading expedition asset with new ID: %d", newAssetID)

	// Upload to S3
	s3Key, err := uploadExpeditionAssetToS3(req.ImageData, newAssetID)
	if err != nil {
		log.Printf("Error uploading to S3: %v", err)
		http.Error(w, fmt.Sprintf("Failed to upload: %v", err), http.StatusInternalServerError)
		return
	}

	publicURL := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s",
		S3_BUCKET_NAME, S3_REGION, s3Key)

	response := map[string]interface{}{
		"success": true,
		"assetID": newAssetID,
		"s3Key":   s3Key,
		"icon":    publicURL,
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("✅ UPLOAD EXPEDITION ASSET SUCCESS - Asset ID: %d, URL: %s", newAssetID, publicURL)
}

// uploadExpeditionAssetToS3 uploads an expedition asset as webp
func uploadExpeditionAssetToS3(imageData string, assetID int) (string, error) {
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

	// S3 key: images/expedition/{assetID}.webp
	s3Key := fmt.Sprintf("images/expedition/%d.webp", assetID)

	log.Printf("Uploading expedition asset to S3: %s", s3Key)

	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(s3Key),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String("image/webp"),
	})

	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Expedition asset uploaded to S3: %s", s3Key)
	return s3Key, nil
}

// ==================== DELETE ENDPOINTS ====================

// handleDeleteExpeditionSlide deletes a slide and all its options/outcomes (via CASCADE)
func handleDeleteExpeditionSlide(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ToolingID int `json:"toolingId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	// Delete the slide - CASCADE will handle options and outcomes
	result, err := db.Exec(`DELETE FROM tooling.expedition_slides WHERE tooling_id = $1`, req.ToolingID)
	if err != nil {
		log.Printf("Failed to delete slide %d: %v", req.ToolingID, err)
		http.Error(w, "Failed to delete slide", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("Deleted slide tooling_id=%d (rows affected: %d)", req.ToolingID, rowsAffected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Slide %d deleted", req.ToolingID),
	})
}

// handleDeleteExpeditionOption deletes an option and its outcomes (via CASCADE)
func handleDeleteExpeditionOption(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ToolingID int `json:"toolingId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	// Delete the option - CASCADE will handle outcomes
	result, err := db.Exec(`DELETE FROM tooling.expedition_options WHERE tooling_id = $1`, req.ToolingID)
	if err != nil {
		log.Printf("Failed to delete option %d: %v", req.ToolingID, err)
		http.Error(w, "Failed to delete option", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("Deleted option tooling_id=%d (rows affected: %d)", req.ToolingID, rowsAffected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Option %d deleted", req.ToolingID),
	})
}
