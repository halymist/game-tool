package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

// RecentEvent represents a global recent event
type RecentEvent struct {
	EventID     int     `json:"event_id"`
	EventName   string  `json:"event_name"`
	Description *string `json:"description"`
}

// handleGetRecentEvents returns all global recent events
func handleGetRecentEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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

	rows, err := db.Query(`SELECT event_id, event_name, description FROM game.recent_events ORDER BY event_id`)
	if err != nil {
		log.Printf("Failed to query recent events: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []RecentEvent
	for rows.Next() {
		var e RecentEvent
		if err := rows.Scan(&e.EventID, &e.EventName, &e.Description); err != nil {
			log.Printf("Failed to scan recent event: %v", err)
			continue
		}
		events = append(events, e)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"events":  events,
	})
}

// handleSaveRecentEvent creates or updates a recent event
func handleSaveRecentEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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

	var req RecentEvent
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.EventName == "" {
		http.Error(w, "Event name is required", http.StatusBadRequest)
		return
	}

	var eventID int
	if req.EventID > 0 {
		// Update
		_, err := db.Exec(`UPDATE game.recent_events SET event_name = $1, description = $2 WHERE event_id = $3`,
			req.EventName, req.Description, req.EventID)
		if err != nil {
			log.Printf("Failed to update recent event: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		eventID = req.EventID
	} else {
		// Insert
		err := db.QueryRow(`INSERT INTO game.recent_events (event_name, description) VALUES ($1, $2) RETURNING event_id`,
			req.EventName, req.Description).Scan(&eventID)
		if err != nil {
			log.Printf("Failed to insert recent event: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"event_id": eventID,
	})
}

// handleDeleteRecentEvent deletes a recent event
func handleDeleteRecentEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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

	var req struct {
		EventID int `json:"event_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	eventIDStr := r.URL.Query().Get("eventId")
	eventID := req.EventID
	if eventID == 0 && eventIDStr != "" {
		eventID, _ = strconv.Atoi(eventIDStr)
	}

	if eventID == 0 {
		http.Error(w, "Event ID is required", http.StatusBadRequest)
		return
	}

	_, err := db.Exec(`DELETE FROM game.recent_events WHERE event_id = $1`, eventID)
	if err != nil {
		log.Printf("Failed to delete recent event: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
