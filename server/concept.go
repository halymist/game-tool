package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type ConceptRecord struct {
	ID        int             `json:"id"`
	Payload   json.RawMessage `json:"payload"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type ConceptResponse struct {
	Success bool            `json:"success"`
	Message string          `json:"message,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
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
	err := db.QueryRow(`SELECT payload FROM game.concept ORDER BY id LIMIT 1`).Scan(&payload)
	if err != nil {
		// Return empty payload if not found
		empty := json.RawMessage([]byte("{}"))
		json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: empty})
		return
	}

	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload})
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
		Payload json.RawMessage `json:"payload"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if len(req.Payload) == 0 {
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: "Payload required"})
		return
	}

	var payload json.RawMessage
	err := db.QueryRow(`
        INSERT INTO game.concept (id, payload, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
        SET payload = EXCLUDED.payload,
            updated_at = NOW()
        RETURNING payload
    `, req.Payload).Scan(&payload)

	if err != nil {
		log.Printf("Error saving concept: %v", err)
		json.NewEncoder(w).Encode(ConceptResponse{Success: false, Message: fmt.Sprintf("Save failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(ConceptResponse{Success: true, Payload: payload})
}
