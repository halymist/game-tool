package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type CoreEffect struct {
	ID          int    `json:"id"`
	Code        string `json:"code"`
	Description string `json:"description"`
}

type EffectMetadata struct {
	CoreEffects    []CoreEffect `json:"coreEffects"`
	Slots          []string     `json:"slots"`
	TriggerTypes   []string     `json:"triggerTypes"`
	FactorTypes    []string     `json:"factorTypes"`
	ConditionTypes []string     `json:"conditionTypes"`
}

type SaveEffectRequest struct {
	ID             int     `json:"id"`
	Name           string  `json:"name"`
	AssetID        *int    `json:"assetID"`
	Slot           *string `json:"slot"`
	Factor         int     `json:"factor"`
	Description    string  `json:"description"`
	CoreEffectID   *int    `json:"coreEffectID"`
	TriggerType    string  `json:"triggerType"`
	FactorType     string  `json:"factorType"`
	TargetSelf     bool    `json:"targetSelf"`
	ConditionType  *string `json:"conditionType"`
	ConditionValue *int    `json:"conditionValue"`
	Duration       *int    `json:"duration"`
}

func getEffectMetadata() (EffectMetadata, error) {
	meta := EffectMetadata{}
	if db == nil {
		return meta, fmt.Errorf("database not available")
	}

	coreRows, err := db.Query(`SELECT core_effect_id, code, COALESCE(description, '') FROM game.core_effects ORDER BY core_effect_id`)
	if err != nil {
		return meta, err
	}
	defer coreRows.Close()
	for coreRows.Next() {
		var core CoreEffect
		if err := coreRows.Scan(&core.ID, &core.Code, &core.Description); err != nil {
			return meta, err
		}
		meta.CoreEffects = append(meta.CoreEffects, core)
	}
	if err := coreRows.Err(); err != nil {
		return meta, err
	}

	enumLists := []struct {
		typeName string
		target   *[]string
	}{
		{"item_type", &meta.Slots},
		{"trigger_type", &meta.TriggerTypes},
		{"factor_type", &meta.FactorTypes},
		{"condition_type", &meta.ConditionTypes},
	}

	for _, enumList := range enumLists {
		rows, err := db.Query(`
			SELECT e.enumlabel
			FROM pg_type t
			JOIN pg_enum e ON t.oid = e.enumtypid
			JOIN pg_namespace n ON n.oid = t.typnamespace
			WHERE n.nspname = 'game' AND t.typname = $1
			ORDER BY e.enumsortorder`, enumList.typeName)
		if err != nil {
			return meta, err
		}
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return meta, err
			}
			*enumList.target = append(*enumList.target, value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return meta, err
		}
		rows.Close()
	}

	return meta, nil
}

func handleSaveEffect(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusInternalServerError)
		return
	}

	var req SaveEffectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	if req.Name == "" {
		http.Error(w, "Effect name is required", http.StatusBadRequest)
		return
	}
	if req.Description == "" {
		http.Error(w, "Effect description is required", http.StatusBadRequest)
		return
	}
	if req.TriggerType == "" {
		req.TriggerType = "passive"
	}
	if req.FactorType == "" {
		req.FactorType = "percent"
	}

	slot := cleanNullableString(req.Slot)
	conditionType := cleanNullableString(req.ConditionType)
	coreEffectID := nullInt(req.CoreEffectID)
	assetIDValue := 1
	if req.AssetID != nil && *req.AssetID > 0 {
		assetIDValue = *req.AssetID
	}
	assetID := sql.NullInt64{Int64: int64(assetIDValue), Valid: true}
	conditionValue := nullInt(req.ConditionValue)
	duration := nullInt(req.Duration)

	effectID := req.ID
	var exists bool
	if effectID > 0 {
		if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM game.effects WHERE effect_id = $1)`, effectID).Scan(&exists); err != nil {
			http.Error(w, "Failed to check effect", http.StatusInternalServerError)
			return
		}
	}
	if effectID <= 0 {
		if err := db.QueryRow(`SELECT COALESCE(MAX(effect_id), 0) + 1 FROM game.effects`).Scan(&effectID); err != nil {
			http.Error(w, "Failed to allocate effect id", http.StatusInternalServerError)
			return
		}
	}

	if exists {
		_, err := db.Exec(`
			UPDATE game.effects
			SET name = $2,
				asset_id = $3,
				slot = $4::game.item_type,
				factor = $5,
				description = $6,
				core_effect_id = $7,
				trigger_type = $8::game.trigger_type,
				factor_type = $9::game.factor_type,
				target_self = $10,
				condition_type = $11::game.condition_type,
				condition_value = $12,
				duration = $13,
				version = version + 1
			WHERE effect_id = $1`,
			effectID, req.Name, assetID, slot, req.Factor, req.Description, coreEffectID,
			req.TriggerType, req.FactorType, req.TargetSelf, conditionType, conditionValue, duration)
		if err != nil {
			log.Printf("Failed to update effect %d: %v", effectID, err)
			http.Error(w, "Failed to update effect: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		_, err := db.Exec(`
			INSERT INTO game.effects (
				effect_id, name, asset_id, slot, factor, description, core_effect_id,
				trigger_type, factor_type, target_self, condition_type, condition_value, duration
			)
			VALUES ($1, $2, $3, $4::game.item_type, $5, $6, $7, $8::game.trigger_type,
				$9::game.factor_type, $10, $11::game.condition_type, $12, $13)`,
			effectID, req.Name, assetID, slot, req.Factor, req.Description, coreEffectID,
			req.TriggerType, req.FactorType, req.TargetSelf, conditionType, conditionValue, duration)
		if err != nil {
			log.Printf("Failed to create effect %d: %v", effectID, err)
			http.Error(w, "Failed to create effect: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	effect, err := getEffectByID(effectID)
	if err != nil {
		http.Error(w, "Effect saved but failed to reload", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"effect":  effect,
	})
}

func cleanNullableString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: trimmed, Valid: true}
}

func getEffectByID(effectID int) (Effect, error) {
	effects, err := getAllEffects()
	if err != nil {
		return Effect{}, err
	}
	for _, effect := range effects {
		if effect.ID == effectID {
			return effect, nil
		}
	}
	return Effect{}, sql.ErrNoRows
}
