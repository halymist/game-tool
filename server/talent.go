package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// TalentInfoResponse is the response for talent info endpoints
// Uses TalentInfo from enemy.go

type TalentInfoResponse struct {
	Success bool         `json:"success"`
	Message string       `json:"message,omitempty"`
	Talent  *TalentInfo  `json:"talent,omitempty"`
	Talents []TalentInfo `json:"talents,omitempty"`
}

type UpdateTalentInfoRequest struct {
	TalentID    int     `json:"talentId"`
	TalentName  string  `json:"talentName"`
	AssetID     int     `json:"assetId"`
	MaxPoints   int     `json:"maxPoints"`
	PerkSlot    *bool   `json:"perkSlot"`
	EffectID    *int    `json:"effectId"`
	Factor      *int    `json:"factor"`
	Description *string `json:"description"`
}

// handleGetTalentsInfo returns all talents from game.talents_info
func handleGetTalentsInfo(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET TALENTS INFO REQUEST ===")

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

	talents, err := getAllTalentsInfo()
	if err != nil {
		log.Printf("Error getting talents: %v", err)
		json.NewEncoder(w).Encode(TalentInfoResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(TalentInfoResponse{Success: true, Talents: talents})
	log.Printf("✅ GET TALENTS INFO: %d talents", len(talents))
}

// handleUpdateTalentInfo updates a single talent in game.talents_info
func handleUpdateTalentInfo(w http.ResponseWriter, r *http.Request) {
	log.Println("=== UPDATE TALENT INFO REQUEST ===")

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

	var req UpdateTalentInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(TalentInfoResponse{Success: false, Message: "Invalid request body"})
		return
	}

	if req.TalentID == 0 || strings.TrimSpace(req.TalentName) == "" || req.MaxPoints == 0 || req.AssetID == 0 {
		json.NewEncoder(w).Encode(TalentInfoResponse{Success: false, Message: "Missing required fields"})
		return
	}

	if req.Description != nil {
		desc := strings.TrimSpace(*req.Description)
		if desc == "" {
			req.Description = nil
		} else {
			req.Description = &desc
		}
	}

	// Update and return updated talent
	query := `
	    UPDATE game.talents_info
	    SET talent_name = $1,
	        asset_id = $2,
	        max_points = $3,
	        perk_slot = $4,
	        effect_id = $5,
	        factor = $6,
	        description = $7,
	        version = COALESCE(version, 1) + 1
	    WHERE talent_id = $8
	    RETURNING talent_id, talent_name, asset_id, max_points, perk_slot, effect_id, factor, description, row, col, COALESCE(version, 1)
	`

	var updated TalentInfo
	err := db.QueryRow(query,
		req.TalentName,
		req.AssetID,
		req.MaxPoints,
		req.PerkSlot,
		req.EffectID,
		req.Factor,
		req.Description,
		req.TalentID,
	).Scan(
		&updated.TalentID,
		&updated.TalentName,
		&updated.AssetID,
		&updated.MaxPoints,
		&updated.PerkSlot,
		&updated.EffectID,
		&updated.Factor,
		&updated.Description,
		&updated.Row,
		&updated.Col,
		&updated.Version,
	)

	if err != nil {
		log.Printf("Error updating talent: %v", err)
		json.NewEncoder(w).Encode(TalentInfoResponse{Success: false, Message: fmt.Sprintf("Update failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(TalentInfoResponse{Success: true, Talent: &updated})
	log.Printf("✅ UPDATED TALENT: id=%d", updated.TalentID)
}
