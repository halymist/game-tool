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
	Points      int  `json:"points" db:"points"`
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
	Points      int  `json:"points"`
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

	toolingID, err := createPendingEnemy(req, action)
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

// createPendingEnemy writes to tooling.enemies and tooling.enemy_talents directly, matching the lean schema.
func createPendingEnemy(req CreateEnemyRequest, action string) (int, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	var toolingID int
	if err := tx.QueryRow(`
		INSERT INTO tooling.enemies (game_id, action, approved, enemy_name, strength, stamina, agility, luck,
		                             armor, min_damage, max_damage, asset_id, description)
		VALUES ($1,$2,FALSE,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING tooling_id
	`, req.GameID, action, req.EnemyName, req.Strength, req.Stamina, req.Agility, req.Luck, req.Armor,
		req.MinDamage, req.MaxDamage, req.AssetID, req.Description).Scan(&toolingID); err != nil {
		return 0, fmt.Errorf("insert pending enemy: %w", err)
	}

	if len(req.Talents) > 0 {
		for _, t := range req.Talents {
			if _, err := tx.Exec(`
				INSERT INTO tooling.enemy_talents (enemy_id, talent_id, points, talent_order, perk_id, action, approved)
				VALUES ($1, $2, $3, $4, $5, $6, FALSE)
			`, toolingID, t.TalentID, t.Points, t.TalentOrder, t.PerkID, action); err != nil {
				return 0, fmt.Errorf("insert pending talent %d: %w", t.TalentID, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit pending enemy: %w", err)
	}

	return toolingID, nil
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

	if err := mergeEnemies(); err != nil {
		log.Printf("Error merging enemies: %v", err)
		json.NewEncoder(w).Encode(ToolingResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(ToolingResponse{Success: true, Message: "Enemies merged successfully"})
	log.Println("✅ Enemies merged")
}

// mergeEnemies moves approved pending enemies into the game schema without relying on
// the old tooling.merge_enemies() function (which expected denormalized enemy_talents).
// This keeps enemy_talents lean: enemy_id, talent_id, talent_order, perk_id.
func mergeEnemies() error {
	type pendingEnemy struct {
		toolingID   int
		gameID      *int
		action      string
		name        string
		strength    int
		stamina     int
		agility     int
		luck        int
		armor       int
		minDamage   int
		maxDamage   int
		assetID     int
		description *string
	}
	type pendingTalent struct {
		enemyToolingID int
		talentID       int
		points         int
		talentOrder    int
		perkID         *int
	}

	// Load all approved pending enemies into memory BEFORE starting the transaction work
	rows, err := db.Query(`
		SELECT tooling_id, game_id, action, enemy_name, strength, stamina, agility, luck,
		       armor, min_damage, max_damage, asset_id, description
		FROM tooling.enemies
		WHERE approved = TRUE
		ORDER BY tooling_id
	`)
	if err != nil {
		return fmt.Errorf("query pending enemies: %w", err)
	}

	var enemies []pendingEnemy
	for rows.Next() {
		var p pendingEnemy
		if err := rows.Scan(&p.toolingID, &p.gameID, &p.action, &p.name, &p.strength, &p.stamina,
			&p.agility, &p.luck, &p.armor, &p.minDamage, &p.maxDamage, &p.assetID, &p.description); err != nil {
			rows.Close()
			return fmt.Errorf("scan pending enemy: %w", err)
		}
		enemies = append(enemies, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate pending enemies: %w", err)
	}

	// Load all talents for these enemies into memory
	var talents []pendingTalent
	for _, e := range enemies {
		trows, err := db.Query(`
			SELECT talent_id, COALESCE(points, 1), talent_order, perk_id
			FROM tooling.enemy_talents
			WHERE enemy_id = $1
			ORDER BY talent_order
		`, e.toolingID)
		if err != nil {
			return fmt.Errorf("query talents for enemy %d: %w", e.toolingID, err)
		}
		for trows.Next() {
			var t pendingTalent
			t.enemyToolingID = e.toolingID
			if err := trows.Scan(&t.talentID, &t.points, &t.talentOrder, &t.perkID); err != nil {
				trows.Close()
				return fmt.Errorf("scan talent for enemy %d: %w", e.toolingID, err)
			}
			talents = append(talents, t)
		}
		trows.Close()
	}

	// Now do all writes in a single transaction with no open result sets
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Map toolingID -> gameEnemyID for talent inserts
	toolingToGameID := make(map[int]int)

	for _, p := range enemies {
		var targetID int
		switch strings.ToLower(p.action) {
		case "insert":
			err := tx.QueryRow(`
				INSERT INTO game.enemies (enemy_name, strength, stamina, agility, luck, armor,
					min_damage, max_damage, asset_id, description, version)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)
				RETURNING enemy_id
			`, p.name, p.strength, p.stamina, p.agility, p.luck, p.armor,
				p.minDamage, p.maxDamage, p.assetID, p.description).Scan(&targetID)
			if err != nil {
				return fmt.Errorf("insert enemy %s: %w", p.name, err)
			}

		case "update":
			if p.gameID == nil {
				return fmt.Errorf("pending enemy %d marked update without game_id", p.toolingID)
			}
			targetID = *p.gameID
			_, err := tx.Exec(`
				UPDATE game.enemies
				SET enemy_name=$1, strength=$2, stamina=$3, agility=$4, luck=$5, armor=$6,
				    min_damage=$7, max_damage=$8, asset_id=$9, description=$10,
				    version = COALESCE(version,1) + 1
				WHERE enemy_id=$11
			`, p.name, p.strength, p.stamina, p.agility, p.luck, p.armor,
				p.minDamage, p.maxDamage, p.assetID, p.description, targetID)
			if err != nil {
				return fmt.Errorf("update enemy %d: %w", targetID, err)
			}
			_, err = tx.Exec(`DELETE FROM game.enemy_talents WHERE enemy_id = $1`, targetID)
			if err != nil {
				return fmt.Errorf("clear talents for enemy %d: %w", targetID, err)
			}

		default:
			return fmt.Errorf("unsupported action '%s' for pending enemy %d", p.action, p.toolingID)
		}
		toolingToGameID[p.toolingID] = targetID
	}

	// Insert talents
	for _, t := range talents {
		targetID := toolingToGameID[t.enemyToolingID]
		_, err := tx.Exec(`
			INSERT INTO game.enemy_talents (enemy_id, talent_id, points, talent_order, perk_id)
			VALUES ($1, $2, $3, $4, $5)
		`, targetID, t.talentID, t.points, t.talentOrder, t.perkID)
		if err != nil {
			return fmt.Errorf("insert talent %d for enemy %d: %w", t.talentID, targetID, err)
		}
	}

	// Cleanup tooling tables
	for _, p := range enemies {
		_, err := tx.Exec(`DELETE FROM tooling.enemy_talents WHERE enemy_id = $1`, p.toolingID)
		if err != nil {
			return fmt.Errorf("cleanup pending talents for %d: %w", p.toolingID, err)
		}
		_, err = tx.Exec(`DELETE FROM tooling.enemies WHERE tooling_id = $1`, p.toolingID)
		if err != nil {
			return fmt.Errorf("cleanup pending enemy %d: %w", p.toolingID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit merge: %w", err)
	}

	return nil
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
		SELECT et.talent_id, et.points, et.talent_order, et.perk_id
		FROM game.enemy_talents et
		WHERE et.enemy_id = $1
		ORDER BY et.talent_order
	`

	rows, err := db.Query(query, enemyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var talents []EnemyTalent
	for rows.Next() {
		var t EnemyTalent
		err := rows.Scan(&t.TalentID, &t.Points, &t.TalentOrder, &t.PerkID)
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
		SELECT et.talent_id, COALESCE(et.points, 1), et.talent_order, et.perk_id
		FROM tooling.enemy_talents et
		WHERE et.enemy_id = $1
		ORDER BY et.talent_order
	`

	rows, err := db.Query(query, enemyToolingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var talents []EnemyTalent
	for rows.Next() {
		var t EnemyTalent
		err := rows.Scan(&t.TalentID, &t.Points, &t.TalentOrder, &t.PerkID)
		if err != nil {
			return nil, err
		}
		talents = append(talents, t)
	}

	return talents, nil
}
