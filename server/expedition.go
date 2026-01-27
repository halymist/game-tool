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
	TargetSlideLocalID int `json:"targetSlideId"` // Local ID from designer
	Weight             int `json:"weight"`
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
				targetSlideToolingID, ok := slideMapping[conn.TargetSlideLocalID]
				if !ok {
					log.Printf("Warning: Target slide %d not found in mapping, skipping connection", conn.TargetSlideLocalID)
					continue
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
