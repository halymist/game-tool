package main

import (
	"database/sql"
	"fmt"
	"log"
)

// nullInt converts a *int into a sql.NullInt64 (NULL when nil).
func nullInt(v *int) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*v), Valid: true}
}

// nullStr converts a *string into a sql.NullString (NULL when nil).
func nullStr(v *string) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *v, Valid: true}
}

// nullBool converts a *bool into a sql.NullBool (NULL when nil).
func nullBool(v *bool) sql.NullBool {
	if v == nil {
		return sql.NullBool{}
	}
	return sql.NullBool{Bool: *v, Valid: true}
}

// Silence unused import when database/sql is not otherwise referenced here.
var _ = sql.ErrNoRows

// Effect represents the database structure for effects (game.effects)
type Effect struct {
	ID             int     `json:"id" db:"effect_id"`
	Name           string  `json:"name" db:"name"`
	Slot           *string `json:"slot" db:"slot"`
	Factor         int     `json:"factor" db:"factor"`
	Description    string  `json:"description" db:"description"`
	CoreEffectCode *string `json:"coreEffectCode,omitempty"`
	TriggerType    *string `json:"triggerType,omitempty"`
	FactorType     *string `json:"factorType,omitempty"`
	TargetSelf     *bool   `json:"targetSelf,omitempty"`
	ConditionType  *string `json:"conditionType,omitempty"`
	ConditionValue *int    `json:"conditionValue,omitempty"`
	Duration       *int    `json:"duration,omitempty"`
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

// uploadImageToS3WithCustomKey uploads an image to S3 with a specified key/filename
func uploadImageToS3WithCustomKey(imageData, contentType, customKey string) (string, error) {
	log.Printf("S3 client is available, proceeding with upload using custom key: %s", customKey)
	filename := fmt.Sprintf("images/enemies/%s.webp", customKey)
	return UploadAssetToS3Key(filename, imageData, contentType)
}

// getAllEffects retrieves all effects from the database (game.effects)
func getAllEffects() ([]Effect, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	query := `SELECT e.effect_id, e.name, e.slot, e.factor, e.description,
		ce.code, e.trigger_type, e.factor_type, e.target_self,
		e.condition_type, e.condition_value, e.duration
		FROM game.effects e
		LEFT JOIN game.core_effects ce ON e.core_effect_id = ce.core_effect_id
		ORDER BY e.effect_id`
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying effects: %v", err)
	}
	defer rows.Close()

	var effects []Effect
	for rows.Next() {
		var effect Effect
		var slot *string

		err := rows.Scan(&effect.ID, &effect.Name, &slot, &effect.Factor, &effect.Description,
			&effect.CoreEffectCode, &effect.TriggerType, &effect.FactorType, &effect.TargetSelf,
			&effect.ConditionType, &effect.ConditionValue, &effect.Duration)
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
