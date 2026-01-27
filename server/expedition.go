package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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

// SaveExpeditionRequest is the request body for saving an expedition
type SaveExpeditionRequest struct {
	Slides       []ExpeditionSlide `json:"slides"`
	SettlementID *int              `json:"settlementId"`
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
				reward_perk, reward_blessing, reward_potion, approved
			) VALUES (
				'insert', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false
			) RETURNING tooling_id
		`, slideText, assetID, effectID, effectFactor, slide.IsStart, req.SettlementID,
			rewardStatType, rewardStatAmount, rewardTalent, rewardItem,
			rewardPerk, rewardBlessing, rewardPotion).Scan(&toolingID)

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
		       reward_perk, reward_blessing, reward_potion, COALESCE(approved, false)
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
			&s.RewardPerk, &s.RewardBlessing, &s.RewardPotion, &s.Approved,
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
