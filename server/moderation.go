package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type BannedWord struct {
	ID       int    `json:"id"`
	Word     string `json:"word"`
	Severity int    `json:"severity"`
}

type BannedWordResponse struct {
	Success bool         `json:"success"`
	Message string       `json:"message,omitempty"`
	Words   []BannedWord `json:"words,omitempty"`
	Word    *BannedWord  `json:"word,omitempty"`
}

func handleGetBannedWords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Database not available"})
		return
	}

	query := `SELECT id, word, severity FROM management.banned_words ORDER BY id DESC`
	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: err.Error()})
		return
	}
	defer rows.Close()

	words := []BannedWord{}
	for rows.Next() {
		var bw BannedWord
		if err := rows.Scan(&bw.ID, &bw.Word, &bw.Severity); err != nil {
			json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: err.Error()})
			return
		}
		words = append(words, bw)
	}

	if err := rows.Err(); err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(BannedWordResponse{Success: true, Words: words})
}

func handleAddBannedWord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Database not available"})
		return
	}

	var req struct {
		Word     string `json:"word"`
		Severity *int   `json:"severity"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if req.Word == "" {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Word is required"})
		return
	}

	severity := 1
	if req.Severity != nil {
		severity = *req.Severity
	}

	var bw BannedWord
	err := db.QueryRow(`INSERT INTO management.banned_words (word, severity) VALUES ($1, $2) RETURNING id, word, severity`, req.Word, severity).Scan(&bw.ID, &bw.Word, &bw.Severity)
	if err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: fmt.Sprintf("Insert failed: %v", err)})
		return
	}

	notifyBannedWordChange("added", bw)

	json.NewEncoder(w).Encode(BannedWordResponse{Success: true, Word: &bw})
}

func handleDeleteBannedWord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Database not available"})
		return
	}

	var req struct {
		ID int `json:"id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if req.ID == 0 {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: "Missing id"})
		return
	}

	var bw BannedWord
	err := db.QueryRow(`DELETE FROM management.banned_words WHERE id = $1 RETURNING id, word, severity`, req.ID).Scan(&bw.ID, &bw.Word, &bw.Severity)
	if err != nil {
		json.NewEncoder(w).Encode(BannedWordResponse{Success: false, Message: fmt.Sprintf("Delete failed: %v", err)})
		return
	}

	notifyBannedWordChange("deleted", bw)

	json.NewEncoder(w).Encode(BannedWordResponse{Success: true, Word: &bw})
}

func notifyBannedWordChange(action string, bw BannedWord) {
	if db == nil {
		return
	}

	payload := map[string]interface{}{
		"action":   action,
		"id":       bw.ID,
		"word":     bw.Word,
		"severity": bw.Severity,
	}

	bytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal banned word notify payload: %v", err)
		return
	}

	_, err = db.Exec(`NOTIFY management_banned_words, $1`, string(bytes))
	if err != nil {
		log.Printf("Failed to notify banned word change: %v", err)
	}
}
