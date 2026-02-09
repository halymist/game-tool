package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

// ==================== TYPES ====================

// TalentInfo represents a talent from game.talents_info
type TalentInfo struct {
	TalentID    int     `json:"talentId" db:"talent_id"`
	TalentName  string  `json:"talentName" db:"talent_name"`
	AssetID     int     `json:"assetId" db:"asset_id"`
	MaxPoints   int     `json:"maxPoints" db:"max_points"`
	PerkSlot    *bool   `json:"perkSlot" db:"perk_slot"`
	EffectID    *int    `json:"effectId" db:"effect_id"`
	Factor      *int    `json:"factor" db:"factor"`
	Description *string `json:"description" db:"description"`
	Row         int     `json:"row" db:"row"`
	Col         int     `json:"col" db:"col"`
	Version     int     `json:"version" db:"version"`
}

// EnemyTalent represents a talent assigned to an enemy
type EnemyTalent struct {
	TalentID    int  `json:"talentId" db:"talent_id"`
	MaxPoints   int  `json:"maxPoints" db:"max_points"`
	TalentOrder int  `json:"talentOrder" db:"talent_order"`
	PerkID      *int `json:"perkId" db:"perk_id"`
}

// Enemy represents an enemy from game.enemies
type GameEnemy struct {
	EnemyID     int           `json:"enemyId" db:"enemy_id"`
	EnemyName   string        `json:"enemyName" db:"enemy_name"`
	Strength    int           `json:"strength" db:"strength"`
	Stamina     int           `json:"stamina" db:"stamina"`
	Agility     int           `json:"agility" db:"agility"`
	Luck        int           `json:"luck" db:"luck"`
	Armor       int           `json:"armor" db:"armor"`
	MinDamage   int           `json:"minDamage" db:"min_damage"`
	MaxDamage   int           `json:"maxDamage" db:"max_damage"`
	AssetID     int           `json:"assetId" db:"asset_id"`
	Description *string       `json:"description" db:"description"`
	Version     int           `json:"version" db:"version"`
	Icon        string        `json:"icon,omitempty"`
	Talents     []EnemyTalent `json:"talents,omitempty"`
}

// PendingEnemy represents a pending enemy from tooling.enemies
type PendingEnemy struct {
	ToolingID   int           `json:"toolingId" db:"tooling_id"`
	GameID      *int          `json:"gameId" db:"game_id"`
	Action      string        `json:"action" db:"action"`
	Approved    bool          `json:"approved" db:"approved"`
	EnemyName   string        `json:"enemyName" db:"enemy_name"`
	Strength    int           `json:"strength" db:"strength"`
	Stamina     int           `json:"stamina" db:"stamina"`
	Agility     int           `json:"agility" db:"agility"`
	Luck        int           `json:"luck" db:"luck"`
	Armor       int           `json:"armor" db:"armor"`
	MinDamage   int           `json:"minDamage" db:"min_damage"`
	MaxDamage   int           `json:"maxDamage" db:"max_damage"`
	AssetID     int           `json:"assetId" db:"asset_id"`
	Description *string       `json:"description" db:"description"`
	Talents     []EnemyTalent `json:"talents,omitempty"`
}

// PendingEnemyTalent represents a pending talent from tooling.enemy_talents
type PendingEnemyTalent struct {
	ToolingID   int    `json:"toolingId" db:"tooling_id"`
	GameID      *int   `json:"gameId" db:"game_id"`
	Action      string `json:"action" db:"action"`
	Approved    bool   `json:"approved" db:"approved"`
	EnemyID     int    `json:"enemyId" db:"enemy_id"`
	TalentID    int    `json:"talentId" db:"talent_id"`
	MaxPoints   int    `json:"maxPoints" db:"max_points"`
	TalentOrder int    `json:"talentOrder" db:"talent_order"`
	PerkID      *int   `json:"perkId" db:"perk_id"`
}

// EnemyResponse is the response for the getEnemies endpoint
type EnemyResponse struct {
	Success        bool           `json:"success"`
	Message        string         `json:"message,omitempty"`
	Effects        []Effect       `json:"effects,omitempty"`
	Talents        []TalentInfo   `json:"talents,omitempty"`
	Perks          []Perk         `json:"perks,omitempty"`
	Enemies        []GameEnemy    `json:"enemies,omitempty"`
	PendingEnemies []PendingEnemy `json:"pendingEnemies,omitempty"`
}

// TalentInput is the input structure for creating enemy talents
type TalentInput struct {
	TalentID    int  `json:"talentId"`
	TalentOrder int  `json:"talentOrder"`
	PerkID      *int `json:"perkId"`
}

// CreateEnemyRequest is the request body for creating an enemy
type CreateEnemyRequest struct {
	GameID      *int          `json:"gameId"`
	EnemyName   string        `json:"enemyName"`
	Strength    int           `json:"strength"`
	Stamina     int           `json:"stamina"`
	Agility     int           `json:"agility"`
	Luck        int           `json:"luck"`
	Armor       int           `json:"armor"`
	MinDamage   int           `json:"minDamage"`
	MaxDamage   int           `json:"maxDamage"`
	AssetID     int           `json:"assetId"`
	Description *string       `json:"description"`
	Talents     []TalentInput `json:"talents"`
}

// ==================== HANDLERS ====================

// handleGetEnemies retrieves all enemies, talents info, effects, and perks
func handleGetEnemies(w http.ResponseWriter, r *http.Request) {
	log.Println("=== GET ENEMIES REQUEST ===")

	if !isAuthenticated(r) {
		log.Println("Unauthorized request to get enemies")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get all effects
	effects, err := getAllEffects()
	if err != nil {
		log.Printf("Error getting effects: %v", err)
		json.NewEncoder(w).Encode(EnemyResponse{Success: false, Message: err.Error()})
		return
	}

	// Get all talents info
	talents, err := getAllTalentsInfo()
	if err != nil {
		log.Printf("Error getting talents: %v", err)
		json.NewEncoder(w).Encode(EnemyResponse{Success: false, Message: err.Error()})
		return
	}

	// Get all perks (for perk slots)
	perks, err := getAllPerks()
	if err != nil {
		log.Printf("Error getting perks: %v", err)
		json.NewEncoder(w).Encode(EnemyResponse{Success: false, Message: err.Error()})
		return
	}

	// Get all enemies with their talents
	enemies, err := getAllEnemies()
	if err != nil {
		log.Printf("Error getting enemies: %v", err)
		json.NewEncoder(w).Encode(EnemyResponse{Success: false, Message: err.Error()})
		return
	}

	// Generate icons for enemies
	for i := range enemies {
		if enemies[i].AssetID > 0 {
			enemies[i].Icon = fmt.Sprintf("https://%s.s3.%s.amazonaws.com/images/enemies/%d.webp",
				S3_BUCKET_NAME, S3_REGION, enemies[i].AssetID)
		}
	}

	// Get pending enemies
	pendingEnemies, err := getPendingEnemies()
	if err != nil {
		log.Printf("Warning: Error getting pending enemies: %v", err)
		pendingEnemies = []PendingEnemy{}
	}

	response := EnemyResponse{
		Success:        true,
		Effects:        effects,
		Talents:        talents,
		Perks:          perks,
		Enemies:        enemies,
		PendingEnemies: pendingEnemies,
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("✅ GET ENEMIES: %d enemies, %d pending, %d talents, %d effects, %d perks",
		len(enemies), len(pendingEnemies), len(talents), len(effects), len(perks))
}

// handleGetEffects retrieves all effects from game.effects
func handleGetEffects(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if !isAuthenticated(r) {
		log.Printf("GET EFFECTS DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	effects, err := getAllEffects()
	if err != nil {
		log.Printf("ERROR: Failed to get effects: %v", err)
		http.Error(w, "Failed to load effects", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"effects": effects,
		"count":   len(effects),
	}

	json.NewEncoder(w).Encode(response)
	log.Printf("GET EFFECTS SUCCESS - returned %d effects", len(effects))
}

// handleCreateEnemy creates a new enemy via tooling.create_enemy
func handleCreateEnemy(w http.ResponseWriter, r *http.Request) {
	log.Println("=== CREATE ENEMY REQUEST ===")

	if !isAuthenticated(r) {
		log.Println("Unauthorized request to create enemy")
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

	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	var req CreateEnemyRequest
	if err := json.Unmarshal(body, &req); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Creating enemy: %s (gameId: %v)", req.EnemyName, req.GameID)

	// Determine action
	action := "insert"
	if req.GameID != nil {
		action = "update"
	}

	// Build talents array for PostgreSQL as a properly formatted string
	var talentsArrayStr *string
	if len(req.Talents) > 0 {
		// Convert talents to PostgreSQL array of composite type format
		// Format: ARRAY[ROW(talent_id, talent_order, perk_id), ...]::game.talent_input[]
		talentParts := make([]string, len(req.Talents))
		for i, t := range req.Talents {
			if t.PerkID != nil {
				talentParts[i] = fmt.Sprintf("ROW(%d,%d,%d)", t.TalentID, t.TalentOrder, *t.PerkID)
			} else {
				talentParts[i] = fmt.Sprintf("ROW(%d,%d,NULL)", t.TalentID, t.TalentOrder)
			}
		}
		arrayStr := "ARRAY[" + strings.Join(talentParts, ",") + "]::game.talent_input[]"
		talentsArrayStr = &arrayStr
	}

	// Call tooling.create_enemy stored procedure
	var toolingID int
	var query string

	if talentsArrayStr != nil {
		// Use a query that embeds the talents array directly (since it's a complex type)
		query = fmt.Sprintf(`SELECT tooling.create_enemy($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, %s)`, *talentsArrayStr)
		err = db.QueryRow(query,
			req.GameID,
			action,
			req.EnemyName,
			req.Strength,
			req.Stamina,
			req.Agility,
			req.Luck,
			req.Armor,
			req.MinDamage,
			req.MaxDamage,
			req.AssetID,
			req.Description,
		).Scan(&toolingID)
	} else {
		query = `SELECT tooling.create_enemy($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)`
		err = db.QueryRow(query,
			req.GameID,
			action,
			req.EnemyName,
			req.Strength,
			req.Stamina,
			req.Agility,
			req.Luck,
			req.Armor,
			req.MinDamage,
			req.MaxDamage,
			req.AssetID,
			req.Description,
		).Scan(&toolingID)
	}

	if err != nil {
		log.Printf("Error creating enemy: %v", err)
		json.NewEncoder(w).Encode(ToolingResponse{Success: false, Message: err.Error()})
		return
	}

	log.Printf("✅ Enemy created with tooling_id: %d", toolingID)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"toolingId": toolingID,
		"message":   "Enemy created successfully",
	})
}

// handleToggleApproveEnemy toggles approval for a pending enemy
func handleToggleApproveEnemy(w http.ResponseWriter, r *http.Request) {
	log.Println("=== TOGGLE APPROVE ENEMY REQUEST ===")

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

	var req ToggleApproveRequest
	body, _ := io.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	log.Printf("Toggle approve enemy: toolingId=%d", req.ToolingID)

	_, err := db.Exec("SELECT tooling.approve_enemy($1)", req.ToolingID)
	if err != nil {
		log.Printf("Error toggling enemy approval: %v", err)
		json.NewEncoder(w).Encode(ToolingResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(ToolingResponse{Success: true, Message: "Approval toggled"})
	log.Println("✅ Enemy approval toggled")
}

// handleMergeEnemies merges approved enemies into game schema
func handleMergeEnemies(w http.ResponseWriter, r *http.Request) {
	log.Println("=== MERGE ENEMIES REQUEST ===")

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

	_, err := db.Exec("SELECT tooling.merge_enemies()")
	if err != nil {
		log.Printf("Error merging enemies: %v", err)
		json.NewEncoder(w).Encode(ToolingResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(ToolingResponse{Success: true, Message: "Enemies merged successfully"})
	log.Println("✅ Enemies merged")
}

// handleRemovePendingEnemy removes a pending enemy
func handleRemovePendingEnemy(w http.ResponseWriter, r *http.Request) {
	log.Println("=== REMOVE PENDING ENEMY REQUEST ===")

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

	var req RemovePendingRequest
	body, _ := io.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	log.Printf("Remove pending enemy: toolingId=%d", req.ToolingID)

	_, err := db.Exec("SELECT tooling.remove_enemy_pending($1)", req.ToolingID)
	if err != nil {
		log.Printf("Error removing pending enemy: %v", err)
		json.NewEncoder(w).Encode(ToolingResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(ToolingResponse{Success: true, Message: "Pending enemy removed"})
	log.Println("✅ Pending enemy removed")
}

// ==================== DATA ACCESS ====================

// getAllTalentsInfo retrieves all talents from game.talents_info
func getAllTalentsInfo() ([]TalentInfo, error) {
	query := `
		SELECT talent_id, talent_name, asset_id, max_points, perk_slot, effect_id, factor, 
		       description, row, col, COALESCE(version, 1)
		FROM game.talents_info
		ORDER BY row, col
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying talents_info: %v", err)
	}
	defer rows.Close()

	var talents []TalentInfo
	for rows.Next() {
		var t TalentInfo
		err := rows.Scan(&t.TalentID, &t.TalentName, &t.AssetID, &t.MaxPoints, &t.PerkSlot,
			&t.EffectID, &t.Factor, &t.Description, &t.Row, &t.Col, &t.Version)
		if err != nil {
			return nil, fmt.Errorf("error scanning talent: %v", err)
		}
		talents = append(talents, t)
	}

	return talents, nil
}

// getAllEnemies retrieves all enemies with their talents
func getAllEnemies() ([]GameEnemy, error) {
	query := `
		SELECT enemy_id, enemy_name, strength, stamina, agility, luck, armor,
		       min_damage, max_damage, asset_id, description, COALESCE(version, 1)
		FROM game.enemies
		ORDER BY enemy_id
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying enemies: %v", err)
	}
	defer rows.Close()

	var enemies []GameEnemy
	for rows.Next() {
		var e GameEnemy
		err := rows.Scan(&e.EnemyID, &e.EnemyName, &e.Strength, &e.Stamina, &e.Agility,
			&e.Luck, &e.Armor, &e.MinDamage, &e.MaxDamage, &e.AssetID, &e.Description, &e.Version)
		if err != nil {
			return nil, fmt.Errorf("error scanning enemy: %v", err)
		}
		enemies = append(enemies, e)
	}

	// Get talents for each enemy
	for i := range enemies {
		talents, err := getEnemyTalents(enemies[i].EnemyID)
		if err != nil {
			log.Printf("Warning: error getting talents for enemy %d: %v", enemies[i].EnemyID, err)
			enemies[i].Talents = []EnemyTalent{}
		} else {
			enemies[i].Talents = talents
		}
	}

	return enemies, nil
}

// getEnemyTalents retrieves talents for a specific enemy
func getEnemyTalents(enemyID int) ([]EnemyTalent, error) {
	query := `
		SELECT talent_id, max_points, talent_order, perk_id
		FROM game.enemy_talents
		WHERE enemy_id = $1
		ORDER BY talent_order
	`

	rows, err := db.Query(query, enemyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var talents []EnemyTalent
	for rows.Next() {
		var t EnemyTalent
		err := rows.Scan(&t.TalentID, &t.MaxPoints, &t.TalentOrder, &t.PerkID)
		if err != nil {
			return nil, err
		}
		talents = append(talents, t)
	}

	return talents, nil
}

// getPendingEnemies retrieves pending enemies with their talents
func getPendingEnemies() ([]PendingEnemy, error) {
	query := `
		SELECT tooling_id, game_id, action, approved, enemy_name, strength, stamina,
		       agility, luck, armor, min_damage, max_damage, asset_id, description
		FROM tooling.enemies
		ORDER BY tooling_id DESC
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error querying pending enemies: %v", err)
	}
	defer rows.Close()

	var enemies []PendingEnemy
	for rows.Next() {
		var e PendingEnemy
		err := rows.Scan(&e.ToolingID, &e.GameID, &e.Action, &e.Approved, &e.EnemyName,
			&e.Strength, &e.Stamina, &e.Agility, &e.Luck, &e.Armor, &e.MinDamage,
			&e.MaxDamage, &e.AssetID, &e.Description)
		if err != nil {
			return nil, fmt.Errorf("error scanning pending enemy: %v", err)
		}
		enemies = append(enemies, e)
	}

	// Get pending talents for each enemy
	for i := range enemies {
		talents, err := getPendingEnemyTalents(enemies[i].ToolingID)
		if err != nil {
			log.Printf("Warning: error getting pending talents for enemy %d: %v", enemies[i].ToolingID, err)
			enemies[i].Talents = []EnemyTalent{}
		} else {
			enemies[i].Talents = talents
		}
	}

	return enemies, nil
}

// getPendingEnemyTalents retrieves pending talents for a specific pending enemy
func getPendingEnemyTalents(enemyToolingID int) ([]EnemyTalent, error) {
	query := `
		SELECT talent_id, max_points, talent_order, perk_id
		FROM tooling.enemy_talents
		WHERE enemy_id = $1
		ORDER BY talent_order
	`

	rows, err := db.Query(query, enemyToolingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var talents []EnemyTalent
	for rows.Next() {
		var t EnemyTalent
		err := rows.Scan(&t.TalentID, &t.MaxPoints, &t.TalentOrder, &t.PerkID)
		if err != nil {
			return nil, err
		}
		talents = append(talents, t)
	}

	return talents, nil
}
