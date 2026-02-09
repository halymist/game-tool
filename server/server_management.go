package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type ServerRecord struct {
	ID             int       `json:"id"`
	Name           *string   `json:"name"`
	CreatedAt      time.Time `json:"created_at"`
	EndsAt         time.Time `json:"ends_at"`
	CharacterCount int       `json:"character_count"`
	PlayerCount    int       `json:"player_count"`
}

type ServerResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Server  *ServerRecord  `json:"server,omitempty"`
	Servers []ServerRecord `json:"servers,omitempty"`
}

type CreateServerRequest struct {
	Name   *string `json:"name"`
	EndsAt *string `json:"endsAt"`
}

func handleGetServers(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET SERVERS REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := `
        SELECT s.id, s.name, s.created_at, s.ends_at,
               COUNT(c.character_id) AS character_count,
               COUNT(DISTINCT c.user_id) AS player_count
        FROM management.servers s
        LEFT JOIN game.characters c ON c.server_id = s.id
        GROUP BY s.id
        ORDER BY s.id DESC
    `

	rows, err := db.Query(query)
	if err != nil {
		log.Printf("Error querying servers: %v", err)
		json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: err.Error()})
		return
	}
	defer rows.Close()

	var servers []ServerRecord
	for rows.Next() {
		var s ServerRecord
		if err := rows.Scan(&s.ID, &s.Name, &s.CreatedAt, &s.EndsAt, &s.CharacterCount, &s.PlayerCount); err != nil {
			log.Printf("Error scanning server: %v", err)
			json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: err.Error()})
			return
		}
		servers = append(servers, s)
	}

	json.NewEncoder(w).Encode(ServerResponse{Success: true, Servers: servers})
}

func handleCreateServer(w http.ResponseWriter, r *http.Request) {
	log.Println("=== CREATE SERVER REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: "Invalid request body"})
		return
	}

	var endsAt time.Time
	var err error
	if req.EndsAt != nil && *req.EndsAt != "" {
		endsAt, err = time.Parse("2006-01-02T15:04", *req.EndsAt)
		if err != nil {
			json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: "Invalid endsAt"})
			return
		}
	}

	query := `
        INSERT INTO management.servers (name, ends_at)
        VALUES ($1, COALESCE($2, (now() + '70 days'::interval)))
        RETURNING id, name, created_at, ends_at
    `

	var s ServerRecord
	if err := db.QueryRow(query, req.Name, nullTimePtr(endsAt)).Scan(&s.ID, &s.Name, &s.CreatedAt, &s.EndsAt); err != nil {
		log.Printf("Error creating server: %v", err)
		json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: fmt.Sprintf("Create failed: %v", err)})
		return
	}

	// Notify listeners
	_, _ = db.Exec("NOTIFY management_servers, 'created'")

	json.NewEncoder(w).Encode(ServerResponse{Success: true, Server: &s})
}

func nullTimePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}
