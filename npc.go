package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/lib/pq"
)

type Npc struct {
	NpcID          int      `json:"npc_id"`
	Name           string   `json:"name"`
	Context        *string  `json:"context"`
	Role           *string  `json:"role"`
	Personality    []string `json:"personality"`
	Goals          []string `json:"goals"`
	SettlementID   *int64   `json:"settlement_id"`
	SettlementName *string  `json:"settlement_name"`
}

type NpcResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Npc     *Npc   `json:"npc,omitempty"`
	Npcs    []Npc  `json:"npcs,omitempty"`
}

type NpcRequest struct {
	NpcID        *int     `json:"npcId"`
	Name         string   `json:"name"`
	Context      *string  `json:"context"`
	Role         *string  `json:"role"`
	Personality  []string `json:"personality"`
	Goals        []string `json:"goals"`
	SettlementID *int64   `json:"settlementId"`
}

func handleGetNpcs(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET NPCS REQUEST ===")

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
		SELECT n.npc_id, n.name, n.context, n.role, n.personality, n.goals, n.settlement_id, w.settlement_name
        FROM game.npc n
        LEFT JOIN game.world_info w ON w.settlement_id = n.settlement_id
        ORDER BY n.npc_id DESC
    `

	rows, err := db.Query(query)
	if err != nil {
		log.Printf("Error querying NPCs: %v", err)
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: err.Error()})
		return
	}
	defer rows.Close()

	var npcs []Npc
	for rows.Next() {
		var npc Npc
		if err := rows.Scan(&npc.NpcID, &npc.Name, &npc.Context, &npc.Role, pq.Array(&npc.Personality), pq.Array(&npc.Goals), &npc.SettlementID, &npc.SettlementName); err != nil {
			log.Printf("Error scanning NPC: %v", err)
			json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: err.Error()})
			return
		}
		npcs = append(npcs, npc)
	}

	json.NewEncoder(w).Encode(NpcResponse{Success: true, Npcs: npcs})
}

func handleCreateNpc(w http.ResponseWriter, r *http.Request) {
	log.Println("=== CREATE NPC REQUEST ===")

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

	var req NpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if req.Name == "" {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Name required"})
		return
	}

	query := `
		INSERT INTO game.npc (name, context, role, personality, goals, settlement_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING npc_id, name, context, role, personality, goals, settlement_id
    `

	var npc Npc
	err := db.QueryRow(query, req.Name, req.Context, req.Role, pq.Array(req.Personality), pq.Array(req.Goals), req.SettlementID).Scan(
		&npc.NpcID, &npc.Name, &npc.Context, &npc.Role, pq.Array(&npc.Personality), pq.Array(&npc.Goals), &npc.SettlementID,
	)
	if err != nil {
		log.Printf("Error creating NPC: %v", err)
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: fmt.Sprintf("Create failed: %v", err)})
		return
	}

	// Attach settlement name if available
	if npc.SettlementID != nil {
		_ = db.QueryRow(`SELECT settlement_name FROM game.world_info WHERE settlement_id = $1`, *npc.SettlementID).Scan(&npc.SettlementName)
	}

	json.NewEncoder(w).Encode(NpcResponse{Success: true, Npc: &npc})
}

func handleUpdateNpc(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPDATE NPC REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "PUT" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req NpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if req.NpcID == nil || req.Name == "" {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Missing fields"})
		return
	}

	query := `
        UPDATE game.npc
        SET name = $1,
			context = $2,
			role = $3,
			personality = $4,
			goals = $5,
			settlement_id = $6
		WHERE npc_id = $7
		RETURNING npc_id, name, context, role, personality, goals, settlement_id
    `

	var npc Npc
	err := db.QueryRow(query, req.Name, req.Context, req.Role, pq.Array(req.Personality), pq.Array(req.Goals), req.SettlementID, *req.NpcID).Scan(
		&npc.NpcID, &npc.Name, &npc.Context, &npc.Role, pq.Array(&npc.Personality), pq.Array(&npc.Goals), &npc.SettlementID,
	)
	if err != nil {
		log.Printf("Error updating NPC: %v", err)
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: fmt.Sprintf("Update failed: %v", err)})
		return
	}

	if npc.SettlementID != nil {
		_ = db.QueryRow(`SELECT settlement_name FROM game.world_info WHERE settlement_id = $1`, *npc.SettlementID).Scan(&npc.SettlementName)
	}

	json.NewEncoder(w).Encode(NpcResponse{Success: true, Npc: &npc})
}

func handleDeleteNpc(w http.ResponseWriter, r *http.Request) {
	log.Println("=== DELETE NPC REQUEST ===")

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "DELETE" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	npcIDParam := r.URL.Query().Get("npcId")
	if npcIDParam == "" {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Missing npcId"})
		return
	}

	var npcID int
	if _, err := fmt.Sscanf(npcIDParam, "%d", &npcID); err != nil {
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: "Invalid npcId"})
		return
	}

	_, err := db.Exec(`DELETE FROM game.npc WHERE npc_id = $1`, npcID)
	if err != nil {
		log.Printf("Error deleting NPC: %v", err)
		json.NewEncoder(w).Encode(NpcResponse{Success: false, Message: fmt.Sprintf("Delete failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(NpcResponse{Success: true})
}
