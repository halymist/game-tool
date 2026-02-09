package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type ConceptRecord struct {
	ID           int             `json:"id"`
	Payload      json.RawMessage `json:"payload"`
	SystemPrompt json.RawMessage `json:"system_prompt"`
	WildsPrompt  json.RawMessage `json:"wilds_prompt"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type ConceptResponse struct {
	Success      bool            `json:"success"`
	Message      string          `json:"message,omitempty"`
	Payload      json.RawMessage `json:"payload,omitempty"`
	SystemPrompt json.RawMessage `json:"systemPrompt,omitempty"`
	WildsPrompt  json.RawMessage `json:"wildsPrompt,omitempty"`
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
	err := db.QueryRow(`SELECT payload, system_prompt, wilds_prompt FROM game.concept ORDER BY id LIMIT 1`).Scan(&payload, &systemPrompt, &wildsPrompt)
	if err != nil {
		// Return empty payload if not found
		empty := json.RawMessage([]byte("{}"))
		json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: empty, SystemPrompt: empty, WildsPrompt: empty})
		return
	}

	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload, SystemPrompt: systemPrompt, WildsPrompt: wildsPrompt})
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
		Payload      json.RawMessage `json:"payload"`
		SystemPrompt json.RawMessage `json:"systemPrompt"`
		WildsPrompt  json.RawMessage `json:"wildsPrompt"`
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

	var payload json.RawMessage
	var systemPrompt json.RawMessage
	var wildsPrompt json.RawMessage
	err := db.QueryRow(`
		INSERT INTO game.concept (id, payload, system_prompt, wilds_prompt, updated_at)
		VALUES (1, $1, $2, $3, NOW())
		ON CONFLICT (id) DO UPDATE
		SET payload = EXCLUDED.payload,
			system_prompt = EXCLUDED.system_prompt,
			wilds_prompt = EXCLUDED.wilds_prompt,
			updated_at = NOW()
		RETURNING payload, system_prompt, wilds_prompt
	`, req.Payload, req.SystemPrompt, req.WildsPrompt).Scan(&payload, &systemPrompt, &wildsPrompt)

	if err != nil {
		log.Printf("Error saving concept: %v", err)
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: fmt.Sprintf("Save failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload, SystemPrompt: systemPrompt, WildsPrompt: wildsPrompt})
}
