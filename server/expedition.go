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
)

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
	RewardSilver   *int               `json:"rewardSilver"`
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
	FactionReq   *string `json:"factionRequired"`
	// Connections to target slides (local IDs from the designer)
	Connections []ExpeditionConnection `json:"connections"`
}

// ExpeditionConnection represents a connection from an option to a target slide
type ExpeditionConnection struct {
	TargetSlideLocalID int  `json:"targetSlideId"`
	TargetSlideDBID    *int `json:"targetSlideDbId"`
}

// NewOptionForExistingSlide represents a new option being added to an existing server slide
type NewOptionForExistingSlide struct {
	SlideLocalID int                    `json:"slideLocalId"`
	OptionIndex  int                    `json:"optionIndex"`
	SlideID      int                    `json:"slideId"`
	Text         string                 `json:"text"`
	StatType     *string                `json:"statType"`
	StatRequired *int                   `json:"statRequired"`
	EffectID     *int                   `json:"effectId"`
	EffectAmount *int                   `json:"effectAmount"`
	EnemyID      *int                   `json:"enemyId"`
	FactionReq   *string                `json:"factionRequired"`
	Connections  []ExpeditionConnection `json:"connections"`
}

// NewConnectionForExistingOption represents a new connection being added to an existing server option
type NewConnectionForExistingOption struct {
	OptionID           int  `json:"optionId"`
	TargetSlideLocalID int  `json:"targetSlideId"`
	TargetSlideDBID    *int `json:"targetSlideDbId"`
}

// SlideUpdate represents updates to an existing slide
type SlideUpdate struct {
	SlideID        int     `json:"slideId"`
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
	RewardSilver   *int    `json:"rewardSilver"`
	PosX           float64 `json:"posX"`
	PosY           float64 `json:"posY"`
}

// OptionUpdate represents updates to an existing option
type OptionUpdate struct {
	OptionID     int     `json:"optionId"`
	Text         string  `json:"text"`
	StatType     *string `json:"statType"`
	StatRequired *int    `json:"statRequired"`
	EffectID     *int    `json:"effectId"`
	EffectAmount *int    `json:"effectAmount"`
	EnemyID      *int    `json:"enemyId"`
	FactionReq   *string `json:"factionRequired"`
}

// DeletedConnection represents a staged removal of an outcome row
type DeletedConnection struct {
	OptionID      int `json:"optionId"`
	TargetSlideID int `json:"targetSlideId"`
}

// SaveExpeditionRequest is the request body for saving an expedition
type SaveExpeditionRequest struct {
	Slides             []ExpeditionSlide                `json:"slides"`
	NewOptions         []NewOptionForExistingSlide      `json:"newOptions"`     // New options for existing slides
	NewConnections     []NewConnectionForExistingOption `json:"newConnections"` // New connections for existing options
	SlideUpdates       []SlideUpdate                    `json:"slideUpdates"`   // Updates to existing slides
	OptionUpdates      []OptionUpdate                   `json:"optionUpdates"`  // Updates to existing options
	DeletedSlides      []int                            `json:"deletedSlides"`
	DeletedOptions     []int                            `json:"deletedOptions"`
	DeletedConnections []DeletedConnection              `json:"deletedConnections"`
	SettlementID       *int                             `json:"settlementId"`
}

// SaveExpeditionResponse contains the result of saving
type SaveExpeditionResponse struct {
	Success       bool           `json:"success"`
	Message       string         `json:"message"`
	SlideMapping  map[int]int    `json:"slideMapping"`  // local ID -> slide_id
	OptionMapping map[string]int `json:"optionMapping"` // "slideLocalId-optionIndex" -> option_id
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

	markSlideState := func(slideID int) error {
		_, err := tx.Exec(`
			UPDATE tooling.expedition_slides
			SET slide_state = CASE WHEN slide_state = 'insert' THEN 'insert' ELSE 'update' END
			WHERE slide_id = $1
		`, slideID)
		return err
	}

	markSlideStateForOption := func(optionID int) error {
		_, err := tx.Exec(`
			UPDATE tooling.expedition_slides
			SET slide_state = CASE WHEN slide_state = 'insert' THEN 'insert' ELSE 'update' END
			WHERE slide_id = (
				SELECT slide_id FROM tooling.expedition_options WHERE option_id = $1
			)
		`, optionID)
		return err
	}

	slideMapping := make(map[int]int)
	optionMapping := make(map[string]int)

	// Handle staged deletions within the same transaction before new work
	processedSlideDeletes := make(map[int]struct{})
	for _, slideID := range req.DeletedSlides {
		if slideID <= 0 {
			continue
		}
		if _, exists := processedSlideDeletes[slideID]; exists {
			continue
		}
		processedSlideDeletes[slideID] = struct{}{}
		if _, err := tx.Exec(`
			UPDATE tooling.expedition_slides
			SET slide_state = 'delete'
			WHERE slide_id = $1
		`, slideID); err != nil {
			log.Printf("Failed to queue slide %d for deletion: %v", slideID, err)
			http.Error(w, "Failed to delete slide", http.StatusInternalServerError)
			return
		}
		log.Printf("Queued slide_id=%d for deletion via saveExpedition", slideID)
	}

	processedOptionDeletes := make(map[int]struct{})
	for _, optionID := range req.DeletedOptions {
		if optionID <= 0 {
			continue
		}
		if _, exists := processedOptionDeletes[optionID]; exists {
			continue
		}
		processedOptionDeletes[optionID] = struct{}{}

		var slideID int
		err := tx.QueryRow(`SELECT slide_id FROM tooling.expedition_options WHERE option_id = $1`, optionID).Scan(&slideID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			log.Printf("Failed to resolve slide for option %d deletion: %v", optionID, err)
			http.Error(w, "Failed to delete option", http.StatusInternalServerError)
			return
		}

		if _, err := tx.Exec(`DELETE FROM tooling.expedition_options WHERE option_id = $1`, optionID); err != nil {
			log.Printf("Failed to delete option %d: %v", optionID, err)
			http.Error(w, "Failed to delete option", http.StatusInternalServerError)
			return
		}

		if err := markSlideState(slideID); err != nil {
			log.Printf("Failed to mark slide %d updated after option delete: %v", slideID, err)
			http.Error(w, "Failed to update slide state", http.StatusInternalServerError)
			return
		}

		log.Printf("Deleted option_id=%d and marked slide_id=%d updated", optionID, slideID)
	}

	processedConnectionDeletes := make(map[string]DeletedConnection)
	for _, conn := range req.DeletedConnections {
		if conn.OptionID <= 0 || conn.TargetSlideID <= 0 {
			continue
		}
		key := fmt.Sprintf("%d-%d", conn.OptionID, conn.TargetSlideID)
		processedConnectionDeletes[key] = conn
	}

	for _, conn := range processedConnectionDeletes {
		result, err := tx.Exec(`
			DELETE FROM tooling.expedition_outcomes
			WHERE option_id = $1 AND target_slide_id = $2
		`, conn.OptionID, conn.TargetSlideID)
		if err != nil {
			log.Printf("Failed to delete connection option_id=%d -> slide_id=%d: %v", conn.OptionID, conn.TargetSlideID, err)
			http.Error(w, "Failed to delete connection", http.StatusInternalServerError)
			return
		}

		if rows, _ := result.RowsAffected(); rows > 0 {
			if err := markSlideStateForOption(conn.OptionID); err != nil {
				log.Printf("Failed to mark slide updated after connection delete (option %d): %v", conn.OptionID, err)
				http.Error(w, "Failed to update slide state", http.StatusInternalServerError)
				return
			}
			log.Printf("Deleted %d connection row(s) for option_id=%d -> slide_id=%d", rows, conn.OptionID, conn.TargetSlideID)
		}
	}

	for _, slide := range req.Slides {
		var slideID int

		assetID := 0
		if slide.AssetID != nil {
			assetID = *slide.AssetID
		}

		rewardStatType := slide.RewardStatType
		rewardStatAmount := slide.RewardStatAmt
		rewardTalent := slide.RewardTalent
		rewardItem := slide.RewardItem
		rewardPerk := slide.RewardPerk
		rewardBlessing := slide.RewardBlessing
		rewardPotion := slide.RewardPotion
		rewardSilver := slide.RewardSilver

		err := tx.QueryRow(`
			INSERT INTO tooling.expedition_slides (
				slide_text, asset_id, effect_id, effect_factor, is_start, settlement_id,
				reward_stat_type, reward_stat_amount, reward_talent, reward_item,
				reward_perk, reward_blessing, reward_potion, reward_silver,
				pos_x, pos_y, slide_state
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
			) RETURNING slide_id
		`, slide.Text, assetID, slide.EffectID, slide.EffectFactor, slide.IsStart, req.SettlementID,
			rewardStatType, rewardStatAmount, rewardTalent, rewardItem,
			rewardPerk, rewardBlessing, rewardPotion, rewardSilver,
			slide.PosX, slide.PosY, "insert").Scan(&slideID)

		if err != nil {
			log.Printf("Failed to insert slide %d: %v", slide.ID, err)
			http.Error(w, fmt.Sprintf("Failed to save slide: %v", err), http.StatusInternalServerError)
			return
		}

		slideMapping[slide.ID] = slideID
		log.Printf("Inserted slide local:%d -> slide_id:%d", slide.ID, slideID)
	}

	for _, slide := range req.Slides {
		slideID := slideMapping[slide.ID]

		for optIdx, option := range slide.Options {
			var optionID int

			err := tx.QueryRow(`
				INSERT INTO tooling.expedition_options (
					slide_id, option_text, stat_type, stat_required,
					effect_id, effect_amount, enemy_id, faction_required
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8
				) RETURNING option_id
			`, slideID, option.Text, option.StatType, option.StatRequired,
				option.EffectID, option.EffectAmount, option.EnemyID, option.FactionReq).Scan(&optionID)

			if err != nil {
				log.Printf("Failed to insert option for slide %d: %v", slide.ID, err)
				http.Error(w, "Failed to save option", http.StatusInternalServerError)
				return
			}

			optionKey := formatOptionKey(slide.ID, optIdx)
			optionMapping[optionKey] = optionID
			log.Printf("Inserted option slide:%d opt:%d -> option_id:%d", slide.ID, optIdx, optionID)
		}
	}

	for _, slide := range req.Slides {
		for optIdx, option := range slide.Options {
			optionKey := formatOptionKey(slide.ID, optIdx)
			optionID := optionMapping[optionKey]

			for _, conn := range option.Connections {
				var targetSlideID int
				if conn.TargetSlideDBID != nil && *conn.TargetSlideDBID > 0 {
					targetSlideID = *conn.TargetSlideDBID
				} else {
					var ok bool
					targetSlideID, ok = slideMapping[conn.TargetSlideLocalID]
					if !ok {
						log.Printf("Warning: Target slide %d not found in mapping, skipping connection", conn.TargetSlideLocalID)
						continue
					}
				}

				_, err := tx.Exec(`
					INSERT INTO tooling.expedition_outcomes (
						option_id, target_slide_id
					) VALUES ($1, $2)
				`, optionID, targetSlideID)

				if err != nil {
					log.Printf("Failed to insert outcome: %v", err)
					http.Error(w, "Failed to save connection", http.StatusInternalServerError)
					return
				}

				log.Printf("Inserted outcome: option:%d -> slide:%d", optionID, targetSlideID)
			}
		}
	}

	for _, newOpt := range req.NewOptions {
		var optionID int

		slideID := newOpt.SlideID
		if slideID == 0 {
			if mappedID, ok := slideMapping[newOpt.SlideLocalID]; ok {
				slideID = mappedID
			}
		}

		if slideID == 0 {
			log.Printf("Failed to resolve slide ID for new option (local slide %d, provided slideId %d)", newOpt.SlideLocalID, newOpt.SlideID)
			http.Error(w, "Failed to determine slide for new option", http.StatusBadRequest)
			return
		}

		err := tx.QueryRow(`
			INSERT INTO tooling.expedition_options (
				slide_id, option_text, stat_type, stat_required,
				effect_id, effect_amount, enemy_id, faction_required
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8
			) RETURNING option_id
		`, slideID, newOpt.Text, newOpt.StatType, newOpt.StatRequired,
			newOpt.EffectID, newOpt.EffectAmount, newOpt.EnemyID, newOpt.FactionReq).Scan(&optionID)

		if err != nil {
			log.Printf("Failed to insert new option for slide %d: %v", newOpt.SlideID, err)
			http.Error(w, "Failed to save new option", http.StatusInternalServerError)
			return
		}

		if err := markSlideState(newOpt.SlideID); err != nil {
			log.Printf("Failed to mark slide %d updated: %v", newOpt.SlideID, err)
			http.Error(w, "Failed to update slide state", http.StatusInternalServerError)
			return
		}

		optionKey := formatOptionKey(newOpt.SlideLocalID, newOpt.OptionIndex)
		optionMapping[optionKey] = optionID
		log.Printf("Inserted new option for slide:%d -> option_id:%d (mapped as %s)", newOpt.SlideID, optionID, optionKey)

		for _, conn := range newOpt.Connections {
			var targetSlideID int
			if conn.TargetSlideDBID != nil && *conn.TargetSlideDBID > 0 {
				targetSlideID = *conn.TargetSlideDBID
			} else {
				var ok bool
				targetSlideID, ok = slideMapping[conn.TargetSlideLocalID]
				if !ok {
					log.Printf("Warning: Target slide %d not found in mapping, skipping connection for new option", conn.TargetSlideLocalID)
					continue
				}
			}

			_, err := tx.Exec(`
				INSERT INTO tooling.expedition_outcomes (option_id, target_slide_id)
				VALUES ($1, $2)
			`, optionID, targetSlideID)

			if err != nil {
				log.Printf("Failed to insert outcome for new option: %v", err)
				http.Error(w, "Failed to save connection for new option", http.StatusInternalServerError)
				return
			}

			log.Printf("Inserted outcome for new option: option:%d -> slide:%d", optionID, targetSlideID)
		}
	}

	for _, newConn := range req.NewConnections {
		var targetSlideID int
		if newConn.TargetSlideDBID != nil && *newConn.TargetSlideDBID > 0 {
			targetSlideID = *newConn.TargetSlideDBID
		} else {
			var ok bool
			targetSlideID, ok = slideMapping[newConn.TargetSlideLocalID]
			if !ok {
				log.Printf("Warning: Target slide %d not found in mapping, skipping new connection", newConn.TargetSlideLocalID)
				continue
			}
		}

		_, err := tx.Exec(`
			INSERT INTO tooling.expedition_outcomes (option_id, target_slide_id)
			VALUES ($1, $2)
		`, newConn.OptionID, targetSlideID)

		if err != nil {
			log.Printf("Failed to insert new connection for option %d: %v", newConn.OptionID, err)
			http.Error(w, "Failed to save new connection", http.StatusInternalServerError)
			return
		}

		if err := markSlideStateForOption(newConn.OptionID); err != nil {
			log.Printf("Failed to mark slide updated for option %d: %v", newConn.OptionID, err)
			http.Error(w, "Failed to update slide state", http.StatusInternalServerError)
			return
		}

		log.Printf("Inserted new connection: option:%d -> slide:%d", newConn.OptionID, targetSlideID)
	}

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
				reward_blessing = $11, reward_potion = $12, reward_silver = $13,
				pos_x = $14, pos_y = $15,
				slide_state = CASE WHEN slide_state = 'insert' THEN 'insert' ELSE 'update' END
			WHERE slide_id = $16
		`, update.Text, assetID, update.EffectID, update.EffectFactor,
			update.IsStart, update.RewardStatType, update.RewardStatAmt,
			update.RewardTalent, update.RewardItem, update.RewardPerk,
			update.RewardBlessing, update.RewardPotion, update.RewardSilver,
			update.PosX, update.PosY, update.SlideID)

		if err != nil {
			log.Printf("Failed to update slide %d: %v", update.SlideID, err)
			http.Error(w, "Failed to update slide", http.StatusInternalServerError)
			return
		}

		log.Printf("Updated slide slide_id:%d", update.SlideID)
	}

	for _, update := range req.OptionUpdates {
		_, err := tx.Exec(`
			UPDATE tooling.expedition_options SET
				option_text = $1, stat_type = $2, stat_required = $3,
				effect_id = $4, effect_amount = $5, enemy_id = $6,
				faction_required = $7
			WHERE option_id = $8
		`, update.Text, update.StatType, update.StatRequired,
			update.EffectID, update.EffectAmount, update.EnemyID,
			update.FactionReq, update.OptionID)

		if err != nil {
			log.Printf("Failed to update option %d: %v", update.OptionID, err)
			http.Error(w, "Failed to update option", http.StatusInternalServerError)
			return
		}

		if err := markSlideStateForOption(update.OptionID); err != nil {
			log.Printf("Failed to mark slide updated for option %d: %v", update.OptionID, err)
			http.Error(w, "Failed to update slide state", http.StatusInternalServerError)
			return
		}

		log.Printf("Updated option option_id:%d", update.OptionID)
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
	SlideID        int            `json:"slideId"`
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
	RewardSilver   *int           `json:"rewardSilver"`
	PosX           float64        `json:"posX"`
	PosY           float64        `json:"posY"`
	Options        []LoadedOption `json:"options"`
}

// LoadedOption represents an option loaded from the database
type LoadedOption struct {
	OptionID     int             `json:"optionId"`
	OptionText   string          `json:"text"`
	StatType     *string         `json:"statType"`
	StatRequired *int            `json:"statRequired"`
	EffectID     *int            `json:"effectId"`
	EffectAmount *int            `json:"effectAmount"`
	EnemyID      *int            `json:"enemyId"`
	FactionReq   *string         `json:"factionRequired"`
	Outcomes     []LoadedOutcome `json:"outcomes"`
}

// LoadedOutcome represents an outcome (connection) from database
type LoadedOutcome struct {
	OutcomeID     int `json:"outcomeId"`
	TargetSlideID int `json:"targetSlideId"`
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
		SELECT slide_id, COALESCE(slide_text, ''), asset_id, effect_id, effect_factor,
		       COALESCE(is_start, false), settlement_id,
		       reward_stat_type, reward_stat_amount, reward_talent, reward_item,
		       reward_perk, reward_blessing, reward_potion, reward_silver,
		       COALESCE(pos_x, 100), COALESCE(pos_y, 100)
		FROM tooling.expedition_slides
		WHERE COALESCE(slide_state, 'unchanged') <> 'delete'
		ORDER BY slide_id
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
			&s.SlideID, &s.SlideText, &s.AssetID, &s.EffectID, &s.EffectFactor,
			&s.IsStart, &s.SettlementID,
			&s.RewardStatType, &s.RewardStatAmt, &s.RewardTalent, &s.RewardItem,
			&s.RewardPerk, &s.RewardBlessing, &s.RewardPotion, &s.RewardSilver,
			&s.PosX, &s.PosY,
		)
		if err != nil {
			log.Printf("Failed to scan slide: %v", err)
			continue
		}
		s.Options = []LoadedOption{}
		slides[s.SlideID] = &s
	}

	log.Printf("Loaded %d slides from tooling", len(slides))

	// Step 2: Load all options and attach to slides
	optionRows, err := db.Query(`
		SELECT option_id, slide_id, COALESCE(option_text, ''), stat_type, stat_required,
		       effect_id, effect_amount, enemy_id, faction_required
		FROM tooling.expedition_options
		ORDER BY option_id
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
			&o.OptionID, &slideID, &o.OptionText, &o.StatType, &o.StatRequired,
			&o.EffectID, &o.EffectAmount, &o.EnemyID, &o.FactionReq,
		)
		if err != nil {
			log.Printf("Failed to scan option: %v", err)
			continue
		}
		o.Outcomes = []LoadedOutcome{}
		options[o.OptionID] = &o

		if slide, ok := slides[slideID]; ok {
			slide.Options = append(slide.Options, o)
		}
	}

	log.Printf("Loaded %d options from tooling", len(options))

	// Step 3: Load all outcomes and attach to options
	outcomeRows, err := db.Query(`
		SELECT outcome_id, option_id, target_slide_id
		FROM tooling.expedition_outcomes
		ORDER BY outcome_id
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
			&oc.OutcomeID, &optionID, &oc.TargetSlideID,
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
				if slide.Options[i].OptionID == optionID {
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
		SlideID int `json:"slideId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	// Instead of removing the row, mark it for deletion so merge can soft-delete in game schema
	result, err := db.Exec(`
		UPDATE tooling.expedition_slides
		SET slide_state = 'delete'
		WHERE slide_id = $1
	`, req.SlideID)
	if err != nil {
		log.Printf("Failed to mark slide %d deleted: %v", req.SlideID, err)
		http.Error(w, "Failed to delete slide", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Slide not found", http.StatusNotFound)
		return
	}

	log.Printf("Marked slide_id=%d as deleted (slide_state='delete')", req.SlideID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Slide %d marked for deletion", req.SlideID),
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
		OptionID int `json:"optionId"`
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
	result, err := db.Exec(`DELETE FROM tooling.expedition_options WHERE option_id = $1`, req.OptionID)
	if err != nil {
		log.Printf("Failed to delete option %d: %v", req.OptionID, err)
		http.Error(w, "Failed to delete option", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("Deleted option option_id=%d (rows affected: %d)", req.OptionID, rowsAffected)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Option %d deleted", req.OptionID),
	})
}

// handleMergeExpeditions copies the tooling expedition graph into the game schema
func handleMergeExpeditions(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if db == nil {
		http.Error(w, "Database not connected", http.StatusInternalServerError)
		return
	}

	log.Printf("Merging expeditions from tooling into game schema")
	stats, err := runExpeditionMerge()
	if err != nil {
		log.Printf("Failed to merge expeditions: %v", err)
		http.Error(w, fmt.Sprintf("Failed to merge expeditions: %v", err), http.StatusInternalServerError)
		return
	}

	message := "No pending expedition changes"
	if stats.Version > 0 {
		message = fmt.Sprintf(
			"Expeditions merged into game schema (version %d: %d inserts, %d updates, %d deletes)",
			stats.Version, stats.InsertedSlides, stats.UpdatedSlides, stats.DeletedSlides,
		)
	}

	response := map[string]interface{}{
		"success":        true,
		"message":        message,
		"version":        stats.Version,
		"slidesInserted": stats.InsertedSlides,
		"slidesUpdated":  stats.UpdatedSlides,
		"slidesDeleted":  stats.DeletedSlides,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type expeditionMergeStats struct {
	Version        int
	InsertedSlides int
	UpdatedSlides  int
	DeletedSlides  int
}

type toolingSlide struct {
	ID               int
	Text             string
	AssetID          int
	EffectID         sql.NullInt64
	EffectFactor     sql.NullInt64
	IsStart          bool
	SettlementID     sql.NullInt64
	RewardStatType   sql.NullString
	RewardStatAmount sql.NullInt64
	RewardTalent     sql.NullBool
	RewardItem       sql.NullInt64
	RewardPerk       sql.NullInt64
	RewardBlessing   sql.NullInt64
	RewardPotion     sql.NullInt64
	RewardSilver     sql.NullInt64
	State            string
}

type toolingOption struct {
	ID              int
	SlideID         int
	Text            string
	StatType        sql.NullString
	StatRequired    sql.NullInt64
	EffectID        sql.NullInt64
	EffectAmount    sql.NullInt64
	EnemyID         sql.NullInt64
	FactionRequired sql.NullString
	SilverRequired  sql.NullInt64
}

type toolingOutcome struct {
	ID            int
	TargetSlideID int
}

func runExpeditionMerge() (expeditionMergeStats, error) {
	stats := expeditionMergeStats{}
	tx, err := db.Begin()
	if err != nil {
		return stats, err
	}
	defer tx.Rollback()

	slides, err := loadPendingToolingSlides(tx)
	if err != nil {
		return stats, err
	}

	if len(slides) == 0 {
		if err := tx.Commit(); err != nil {
			return stats, err
		}
		return stats, nil
	}

	version, err := nextExpeditionVersion(tx)
	if err != nil {
		return stats, err
	}
	stats.Version = version

	deletedSlideSet := make(map[int]struct{})
	var deletedSlideIDs []int
	for _, slide := range slides {
		isDeleted := strings.EqualFold(slide.State, "delete")
		if err := upsertGameSlide(tx, slide, version, isDeleted); err != nil {
			return stats, err
		}
		switch strings.ToLower(slide.State) {
		case "insert":
			stats.InsertedSlides++
		case "update":
			stats.UpdatedSlides++
		case "delete":
			stats.DeletedSlides++
			if _, exists := deletedSlideSet[slide.ID]; !exists {
				deletedSlideSet[slide.ID] = struct{}{}
				deletedSlideIDs = append(deletedSlideIDs, slide.ID)
			}
		}
	}

	for _, slide := range slides {
		isDeleted := strings.EqualFold(slide.State, "delete")
		if err := syncSlideOptionsAndOutcomes(tx, slide.ID, isDeleted); err != nil {
			return stats, err
		}
	}

	if _, err := tx.Exec(`
		DELETE FROM game.expedition_outcomes
		WHERE target_slide_id IN (
			SELECT slide_id FROM game.expedition_slides WHERE is_deleted = TRUE
		)
	`); err != nil {
		return stats, err
	}

	for _, slideID := range deletedSlideIDs {
		if _, err := tx.Exec(`
			DELETE FROM tooling.expedition_outcomes
			WHERE option_id IN (
				SELECT option_id FROM tooling.expedition_options WHERE slide_id = $1
			)
		`, slideID); err != nil {
			return stats, err
		}

		if _, err := tx.Exec(`DELETE FROM tooling.expedition_options WHERE slide_id = $1`, slideID); err != nil {
			return stats, err
		}

		if _, err := tx.Exec(`DELETE FROM tooling.expedition_slides WHERE slide_id = $1`, slideID); err != nil {
			return stats, err
		}
	}

	if _, err := tx.Exec(`
		UPDATE tooling.expedition_slides
		SET slide_state = 'unchanged'
		WHERE slide_state IN ('insert','update')
	`); err != nil {
		return stats, err
	}

	if err := tx.Commit(); err != nil {
		return stats, err
	}

	return stats, nil
}

func loadPendingToolingSlides(tx *sql.Tx) ([]toolingSlide, error) {
	rows, err := tx.Query(`
		SELECT
			slide_id,
			slide_text,
			asset_id,
			effect_id,
			effect_factor,
			is_start,
			settlement_id,
			reward_stat_type,
			reward_stat_amount,
			reward_talent,
			reward_item,
			reward_perk,
			reward_blessing,
			reward_potion,
			reward_silver,
			slide_state
		FROM tooling.expedition_slides
		WHERE slide_state IN ('insert','update','delete')
		ORDER BY slide_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var slides []toolingSlide
	for rows.Next() {
		var s toolingSlide
		if err := rows.Scan(
			&s.ID,
			&s.Text,
			&s.AssetID,
			&s.EffectID,
			&s.EffectFactor,
			&s.IsStart,
			&s.SettlementID,
			&s.RewardStatType,
			&s.RewardStatAmount,
			&s.RewardTalent,
			&s.RewardItem,
			&s.RewardPerk,
			&s.RewardBlessing,
			&s.RewardPotion,
			&s.RewardSilver,
			&s.State,
		); err != nil {
			return nil, err
		}
		slides = append(slides, s)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return slides, nil
}

func nextExpeditionVersion(tx *sql.Tx) (int, error) {
	var current int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM game.expedition_slides`).Scan(&current); err != nil {
		return 0, err
	}
	return current + 1, nil
}

func upsertGameSlide(tx *sql.Tx, slide toolingSlide, version int, markDeleted bool) error {
	_, err := tx.Exec(`
		INSERT INTO game.expedition_slides (
			slide_id, slide_text, asset_id, effect_id, effect_factor,
			is_start, settlement_id, reward_stat_type, reward_stat_amount,
			reward_talent, reward_item, reward_perk, reward_blessing,
			reward_potion, reward_silver, is_deleted, version
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12, $13,
			$14, $15, $16, $17
		)
		ON CONFLICT (slide_id) DO UPDATE SET
			slide_text = EXCLUDED.slide_text,
			asset_id = EXCLUDED.asset_id,
			effect_id = EXCLUDED.effect_id,
			effect_factor = EXCLUDED.effect_factor,
			is_start = EXCLUDED.is_start,
			settlement_id = EXCLUDED.settlement_id,
			reward_stat_type = EXCLUDED.reward_stat_type,
			reward_stat_amount = EXCLUDED.reward_stat_amount,
			reward_talent = EXCLUDED.reward_talent,
			reward_item = EXCLUDED.reward_item,
			reward_perk = EXCLUDED.reward_perk,
			reward_blessing = EXCLUDED.reward_blessing,
			reward_potion = EXCLUDED.reward_potion,
			reward_silver = EXCLUDED.reward_silver,
			is_deleted = EXCLUDED.is_deleted,
			version = EXCLUDED.version
	`,
		slide.ID,
		slide.Text,
		slide.AssetID,
		slide.EffectID,
		slide.EffectFactor,
		slide.IsStart,
		slide.SettlementID,
		slide.RewardStatType,
		slide.RewardStatAmount,
		slide.RewardTalent,
		slide.RewardItem,
		slide.RewardPerk,
		slide.RewardBlessing,
		slide.RewardPotion,
		slide.RewardSilver,
		markDeleted,
		version,
	)
	return err
}

func syncSlideOptionsAndOutcomes(tx *sql.Tx, slideID int, deleteOnly bool) error {
	if _, err := tx.Exec(`DELETE FROM game.expedition_options WHERE slide_id = $1`, slideID); err != nil {
		return err
	}

	if deleteOnly {
		return nil
	}

	rows, err := tx.Query(`
		SELECT
			option_id,
			slide_id,
			option_text,
			stat_type,
			stat_required,
			effect_id,
			effect_amount,
			enemy_id,
			faction_required,
			silver_required
		FROM tooling.expedition_options
		WHERE slide_id = $1
		ORDER BY option_id
	`, slideID)
	if err != nil {
		return err
	}

	var options []toolingOption
	for rows.Next() {
		var opt toolingOption
		if err := rows.Scan(
			&opt.ID,
			&opt.SlideID,
			&opt.Text,
			&opt.StatType,
			&opt.StatRequired,
			&opt.EffectID,
			&opt.EffectAmount,
			&opt.EnemyID,
			&opt.FactionRequired,
			&opt.SilverRequired,
		); err != nil {
			rows.Close()
			return err
		}
		options = append(options, opt)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}

	if err := rows.Close(); err != nil {
		return err
	}

	for _, opt := range options {
		if err := upsertGameOption(tx, opt); err != nil {
			return err
		}
		if err := syncOptionOutcomes(tx, opt.ID); err != nil {
			return err
		}
	}

	return nil
}

func upsertGameOption(tx *sql.Tx, opt toolingOption) error {
	_, err := tx.Exec(`
		INSERT INTO game.expedition_options (
			option_id, slide_id, option_text, stat_type, stat_required,
			effect_id, effect_amount, enemy_id, faction_required, silver_required
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10
		)
		ON CONFLICT (option_id) DO UPDATE SET
			slide_id = EXCLUDED.slide_id,
			option_text = EXCLUDED.option_text,
			stat_type = EXCLUDED.stat_type,
			stat_required = EXCLUDED.stat_required,
			effect_id = EXCLUDED.effect_id,
			effect_amount = EXCLUDED.effect_amount,
			enemy_id = EXCLUDED.enemy_id,
			faction_required = EXCLUDED.faction_required,
			silver_required = EXCLUDED.silver_required
	`,
		opt.ID,
		opt.SlideID,
		opt.Text,
		opt.StatType,
		opt.StatRequired,
		opt.EffectID,
		opt.EffectAmount,
		opt.EnemyID,
		opt.FactionRequired,
		opt.SilverRequired,
	)
	return err
}

func syncOptionOutcomes(tx *sql.Tx, optionID int) error {
	if _, err := tx.Exec(`DELETE FROM game.expedition_outcomes WHERE option_id = $1`, optionID); err != nil {
		return err
	}

	rows, err := tx.Query(`
		SELECT outcome_id, target_slide_id
		FROM tooling.expedition_outcomes
		WHERE option_id = $1
		ORDER BY outcome_id
	`, optionID)
	if err != nil {
		return err
	}

	var outcomes []toolingOutcome
	for rows.Next() {
		var oc toolingOutcome
		if err := rows.Scan(&oc.ID, &oc.TargetSlideID); err != nil {
			rows.Close()
			return err
		}
		outcomes = append(outcomes, oc)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}

	if err := rows.Close(); err != nil {
		return err
	}

	for _, oc := range outcomes {
		if _, err := tx.Exec(`
			INSERT INTO game.expedition_outcomes (outcome_id, option_id, target_slide_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (outcome_id) DO UPDATE SET
				option_id = EXCLUDED.option_id,
				target_slide_id = EXCLUDED.target_slide_id
		`, oc.ID, optionID, oc.TargetSlideID); err != nil {
			return err
		}
	}

	return nil
}
