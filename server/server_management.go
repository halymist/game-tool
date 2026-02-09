package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type ServerRecord struct {
	ID             int         `json:"id"`
	Name           *string     `json:"name"`
	CreatedAt      time.Time   `json:"created_at"`
	EndsAt         time.Time   `json:"ends_at"`
	CharacterCount int         `json:"character_count"`
	PlayerCount    int         `json:"player_count"`
	Plan           []WorldPlan `json:"plan"`
}

type WorldPlan struct {
	ServerDay      int     `json:"server_day"`
	Faction        int     `json:"faction"`
	SettlementID   int     `json:"settlement_id"`
	SettlementName *string `json:"settlement_name"`
	Blacksmith     bool    `json:"blacksmith"`
	Alchemist      bool    `json:"alchemist"`
	Enchanter      bool    `json:"enchanter"`
	Trainer        bool    `json:"trainer"`
	Church         bool    `json:"church"`
	Blessing1      *int    `json:"blessing1"`
	Blessing2      *int    `json:"blessing2"`
	Blessing3      *int    `json:"blessing3"`
}

type ServerResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Server  *ServerRecord  `json:"server,omitempty"`
	Servers []ServerRecord `json:"servers,omitempty"`
}

type CreateServerRequest struct {
	Name     *string `json:"name"`
	StartsAt *string `json:"startsAt"`
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
	       COUNT(DISTINCT c.player_id) AS player_count
        FROM management.servers s
	LEFT JOIN public.characters c ON c.server_id = s.id
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
		plan, planErr := getWorldPlanForServer(s.ID)
		if planErr != nil {
			log.Printf("Warning: could not load world plan for server %d: %v", s.ID, planErr)
			s.Plan = []WorldPlan{}
		} else {
			s.Plan = plan
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

	startAt := time.Now()
	if req.StartsAt != nil && *req.StartsAt != "" {
		parsed, err := time.Parse("2006-01-02T15:04", *req.StartsAt)
		if err != nil {
			json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: "Invalid startsAt"})
			return
		}
		startAt = parsed
	}
	endsAt := startAt.Add(70 * 24 * time.Hour)

	query := `
		INSERT INTO management.servers (name, created_at, ends_at)
		VALUES ($1, $2, $3)
		RETURNING id, name, created_at, ends_at
	`

	var s ServerRecord
	if err := db.QueryRow(query, req.Name, startAt, endsAt).Scan(&s.ID, &s.Name, &s.CreatedAt, &s.EndsAt); err != nil {
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

func getWorldPlanForServer(serverID int) ([]WorldPlan, error) {
	query := `
		SELECT w.server_day, w.faction, w.settlement_id, wi.settlement_name,
		       w.blacksmith, w.alchemist, w.enchanter, w.trainer, w.church,
		       w.blessing1, w.blessing2, w.blessing3
		FROM public.world w
		LEFT JOIN game.world_info wi ON wi.settlement_id = w.settlement_id
		WHERE w.server_id = $1
		ORDER BY w.server_day, w.settlement_id
	`

	rows, err := db.Query(query, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var plan []WorldPlan
	for rows.Next() {
		var p WorldPlan
		if err := rows.Scan(&p.ServerDay, &p.Faction, &p.SettlementID, &p.SettlementName,
			&p.Blacksmith, &p.Alchemist, &p.Enchanter, &p.Trainer, &p.Church,
			&p.Blessing1, &p.Blessing2, &p.Blessing3); err != nil {
			return nil, err
		}
		plan = append(plan, p)
	}
	return plan, nil
}
