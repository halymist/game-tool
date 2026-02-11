package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type ConceptRecord struct {
	ID                      int             `json:"id"`
	Payload                 json.RawMessage `json:"payload"`
	SystemPrompt            json.RawMessage `json:"system_prompt"`
	WildsPrompt             json.RawMessage `json:"wilds_prompt"`
	ExpeditionClusterPrompt json.RawMessage `json:"expedition_cluster_prompt"`
	ExpeditionJsonSchema    json.RawMessage `json:"expedition_json_schema"`
	UpdatedAt               time.Time       `json:"updated_at"`
}

type ConceptResponse struct {
	Success                 bool            `json:"success"`
	Message                 string          `json:"message,omitempty"`
	Payload                 json.RawMessage `json:"payload,omitempty"`
	SystemPrompt            json.RawMessage `json:"systemPrompt,omitempty"`
	WildsPrompt             json.RawMessage `json:"wildsPrompt,omitempty"`
	ExpeditionClusterPrompt json.RawMessage `json:"expeditionClusterPrompt,omitempty"`
	ExpeditionJsonSchema    json.RawMessage `json:"expeditionJsonSchema,omitempty"`
}

func handleGetConcept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var payload json.RawMessage
	var systemPrompt json.RawMessage
	var wildsPrompt json.RawMessage
	var expeditionClusterPrompt sql.NullString
	var expeditionJsonSchema sql.NullString
	err := db.QueryRow(`SELECT payload, system_prompt, wilds_prompt, expedition_cluster_prompt, expedition_json_schema FROM game.concept ORDER BY id LIMIT 1`).Scan(&payload, &systemPrompt, &wildsPrompt, &expeditionClusterPrompt, &expeditionJsonSchema)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return empty payload if not found
			empty := json.RawMessage([]byte("{}"))
			json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: empty, SystemPrompt: empty, WildsPrompt: empty, ExpeditionClusterPrompt: empty, ExpeditionJsonSchema: empty})
			return
		}
		log.Printf("Error loading concept: %v", err)
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: "Failed to load concept"})
		return
	}

	clusterPrompt := json.RawMessage([]byte("{}"))
	if expeditionClusterPrompt.Valid {
		clusterPrompt = json.RawMessage([]byte(expeditionClusterPrompt.String))
	}
	expeditionSchema := json.RawMessage([]byte("{}"))
	if expeditionJsonSchema.Valid {
		expeditionSchema = json.RawMessage([]byte(expeditionJsonSchema.String))
	}
	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload, SystemPrompt: systemPrompt, WildsPrompt: wildsPrompt, ExpeditionClusterPrompt: clusterPrompt, ExpeditionJsonSchema: expeditionSchema})
}

func handleSaveConcept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Payload                 json.RawMessage `json:"payload"`
		SystemPrompt            json.RawMessage `json:"systemPrompt"`
		WildsPrompt             json.RawMessage `json:"wildsPrompt"`
		ExpeditionClusterPrompt json.RawMessage `json:"expeditionClusterPrompt"`
		ExpeditionJsonSchema    json.RawMessage `json:"expeditionJsonSchema"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if len(req.Payload) == 0 {
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: "Payload required"})
		return
	}
	if len(req.SystemPrompt) == 0 {
		req.SystemPrompt = json.RawMessage([]byte("{}"))
	}
	if len(req.WildsPrompt) == 0 {
		req.WildsPrompt = json.RawMessage([]byte("{}"))
	}
	if len(req.ExpeditionClusterPrompt) == 0 {
		req.ExpeditionClusterPrompt = json.RawMessage([]byte("{}"))
	}
	if len(req.ExpeditionJsonSchema) == 0 {
		req.ExpeditionJsonSchema = json.RawMessage([]byte("{}"))
	}

	var payload json.RawMessage
	var systemPrompt json.RawMessage
	var wildsPrompt json.RawMessage
	var expeditionClusterPrompt json.RawMessage
	var expeditionJsonSchema json.RawMessage
	err := db.QueryRow(`
		INSERT INTO game.concept (id, payload, system_prompt, wilds_prompt, expedition_cluster_prompt, expedition_json_schema, updated_at)
		VALUES (1, $1, $2, $3, $4, $5, NOW())
		ON CONFLICT (id) DO UPDATE
		SET payload = EXCLUDED.payload,
			system_prompt = EXCLUDED.system_prompt,
			wilds_prompt = EXCLUDED.wilds_prompt,
			expedition_cluster_prompt = EXCLUDED.expedition_cluster_prompt,
			expedition_json_schema = EXCLUDED.expedition_json_schema,
			updated_at = NOW()
		RETURNING payload, system_prompt, wilds_prompt, expedition_cluster_prompt, expedition_json_schema
	`, req.Payload, req.SystemPrompt, req.WildsPrompt, req.ExpeditionClusterPrompt, req.ExpeditionJsonSchema).Scan(&payload, &systemPrompt, &wildsPrompt, &expeditionClusterPrompt, &expeditionJsonSchema)

	if err != nil {
		log.Printf("Error saving concept: %v", err)
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: fmt.Sprintf("Save failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload, SystemPrompt: systemPrompt, WildsPrompt: wildsPrompt, ExpeditionClusterPrompt: expeditionClusterPrompt, ExpeditionJsonSchema: expeditionJsonSchema})
}
