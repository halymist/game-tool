package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
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
	CurrentDay     int         `json:"current_day"`
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
		s.CurrentDay = calculateServerDay(s.CreatedAt, time.Now())
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

	// Prevent duplicate server names
	if req.Name != nil && *req.Name != "" {
		var exists bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM management.servers WHERE name = $1)`, *req.Name).Scan(&exists); err == nil && exists {
			json.NewEncoder(w).Encode(ServerResponse{Success: false, Message: "A server with this name already exists"})
			return
		}
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

	// Generate world content (plan, vendor, enchanter)
	if err := generateServerContent(s.ID); err != nil {
		log.Printf("Warning: content generation failed for server %d: %v", s.ID, err)
		// Server was created, but content generation failed — report partial success
		json.NewEncoder(w).Encode(ServerResponse{
			Success: true,
			Server:  &s,
			Message: fmt.Sprintf("Server created but content generation failed: %v", err),
		})
		return
	}

	// Reload plan into the response
	plan, err := getWorldPlanForServer(s.ID)
	if err == nil {
		s.Plan = plan
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

func calculateServerDay(start time.Time, now time.Time) int {
	startDate := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	current := now.In(start.Location())
	currentDate := time.Date(current.Year(), current.Month(), current.Day(), 0, 0, 0, 0, start.Location())
	if currentDate.Before(startDate) {
		return 1
	}
	days := int(currentDate.Sub(startDate).Hours() / 24)
	return days + 1
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

// settlementInfo holds the data needed for world generation from game.world_info
type settlementInfo struct {
	SettlementID int
	Faction      *int
	Blacksmith   bool
	Alchemist    bool
	Enchanter    bool
	Trainer      bool
	Church       bool
	Blessing1    *int
	Blessing2    *int
	Blessing3    *int
	VendorItems  []int
	EnchanterFX  []int // effect_id list
}

// generateServerContent creates the 70-day world plan plus vendor/enchanter stock.
func generateServerContent(serverID int) error {
	// 1. Load all settlements
	settlements, err := loadSettlementsForGeneration()
	if err != nil {
		return fmt.Errorf("load settlements: %w", err)
	}
	if len(settlements) == 0 {
		return fmt.Errorf("no settlements found in game.world_info")
	}

	// Split into neutral and per-faction pools
	var neutral []settlementInfo
	factionPools := map[int][]settlementInfo{} // faction -> settlements
	for _, s := range settlements {
		if s.Faction == nil || *s.Faction == 0 {
			neutral = append(neutral, s)
		} else {
			factionPools[*s.Faction] = append(factionPools[*s.Faction], s)
		}
	}

	// 2. Build the day-by-day plan
	const totalDays = 70
	const neutralBeforeFaction = 5 // after 5 neutral settlements, insert a faction one
	factions := []int{1, 2, 3}
	neutralCount := 0

	type dayEntry struct {
		day        int
		settlement settlementInfo
	}
	var plan []dayEntry

	day := 1
	for day <= totalDays {
		// After every neutralBeforeFaction neutral settlements, insert a faction block
		if neutralCount >= neutralBeforeFaction && len(factions) > 0 {
			// Faction block: one settlement per faction, each with independent duration
			maxDuration := 0
			for _, f := range factions {
				pool := factionPools[f]
				if len(pool) == 0 {
					continue
				}
				pick := pool[rand.Intn(len(pool))]

				var duration int
				if day <= 2 {
					duration = 1
				} else {
					duration = 1 + rand.Intn(3) // 1-3
				}
				if day+duration-1 > totalDays {
					duration = totalDays - day + 1
				}
				if duration <= 0 {
					continue
				}

				for d := 0; d < duration; d++ {
					plan = append(plan, dayEntry{day: day + d, settlement: pick})
				}
				if duration > maxDuration {
					maxDuration = duration
				}
			}
			if maxDuration > 0 {
				day += maxDuration
			} else {
				day++
			}
			neutralCount = 0
			continue
		}

		// Neutral settlement
		var pick settlementInfo
		if len(neutral) > 0 {
			pick = neutral[rand.Intn(len(neutral))]
		} else {
			pick = settlements[rand.Intn(len(settlements))]
		}
		neutralCount++

		var duration int
		if day <= 2 {
			duration = 1
		} else {
			duration = 1 + rand.Intn(3) // 1-3
		}
		if day+duration-1 > totalDays {
			duration = totalDays - day + 1
		}

		for d := 0; d < duration; d++ {
			plan = append(plan, dayEntry{day: day + d, settlement: pick})
		}
		day += duration
	}

	// 3. Write everything in a transaction
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Insert world plan rows
	worldStmt, err := tx.Prepare(`
		INSERT INTO public.world
			(server_id, server_day, faction, settlement_id,
			 blacksmith, alchemist, enchanter, trainer, church,
			 blessing1, blessing2, blessing3)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`)
	if err != nil {
		return fmt.Errorf("prepare world: %w", err)
	}
	defer worldStmt.Close()

	vendorStmt, err := tx.Prepare(`
		INSERT INTO public.vendor (server_id, server_day, settlement_id, item_id)
		VALUES ($1,$2,$3,$4)
	`)
	if err != nil {
		return fmt.Errorf("prepare vendor: %w", err)
	}
	defer vendorStmt.Close()

	enchanterStmt, err := tx.Prepare(`
		INSERT INTO public.enchanter (server_id, server_day, settlement_id, effect_id, factor)
		VALUES ($1,$2,$3,$4,$5)
	`)
	if err != nil {
		return fmt.Errorf("prepare enchanter: %w", err)
	}
	defer enchanterStmt.Close()

	// Load effect factors for enchanter lookups
	effectFactors, err := loadEffectFactors()
	if err != nil {
		return fmt.Errorf("load effect factors: %w", err)
	}

	for _, entry := range plan {
		s := entry.settlement
		faction := 0
		if s.Faction != nil {
			faction = *s.Faction
		}

		if _, err := worldStmt.Exec(
			serverID, entry.day, faction, s.SettlementID,
			s.Blacksmith, s.Alchemist, s.Enchanter, s.Trainer, s.Church,
			s.Blessing1, s.Blessing2, s.Blessing3,
		); err != nil {
			return fmt.Errorf("insert world day %d: %w", entry.day, err)
		}

		// Vendor: 8 random items from the settlement's vendor inventory
		if len(s.VendorItems) > 0 {
			picked := pickRandom(s.VendorItems, 8)
			for _, itemID := range picked {
				if _, err := vendorStmt.Exec(serverID, entry.day, s.SettlementID, itemID); err != nil {
					return fmt.Errorf("insert vendor day %d item %d: %w", entry.day, itemID, err)
				}
			}
		}

		// Enchanter: 4 random effects (only if settlement has enchanter)
		if s.Enchanter && len(s.EnchanterFX) > 0 {
			picked := pickRandom(s.EnchanterFX, 4)
			for _, effectID := range picked {
				factor := effectFactors[effectID]
				if _, err := enchanterStmt.Exec(serverID, entry.day, s.SettlementID, effectID, factor); err != nil {
					return fmt.Errorf("insert enchanter day %d effect %d: %w", entry.day, effectID, err)
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	log.Printf("Generated content for server %d: %d day entries", serverID, len(plan))
	return nil
}

// loadSettlementsForGeneration loads all settlements with their vendor/enchanter inventories.
func loadSettlementsForGeneration() ([]settlementInfo, error) {
	rows, err := db.Query(`
		SELECT settlement_id, faction,
		       COALESCE(blacksmith, false), COALESCE(alchemist, false),
		       COALESCE(enchanter, false), COALESCE(trainer, false), COALESCE(church, false),
		       blessing1, blessing2, blessing3
		FROM game.world_info
		ORDER BY settlement_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settlements []settlementInfo
	for rows.Next() {
		var s settlementInfo
		if err := rows.Scan(
			&s.SettlementID, &s.Faction,
			&s.Blacksmith, &s.Alchemist, &s.Enchanter, &s.Trainer, &s.Church,
			&s.Blessing1, &s.Blessing2, &s.Blessing3,
		); err != nil {
			return nil, err
		}
		settlements = append(settlements, s)
	}

	// Load vendor items per settlement
	for i := range settlements {
		vRows, err := db.Query(`SELECT item_id FROM game.vendor_inventory WHERE settlement_id = $1`, settlements[i].SettlementID)
		if err != nil {
			continue
		}
		for vRows.Next() {
			var id int
			if vRows.Scan(&id) == nil {
				settlements[i].VendorItems = append(settlements[i].VendorItems, id)
			}
		}
		vRows.Close()
	}

	// Load enchanter effects per settlement
	for i := range settlements {
		eRows, err := db.Query(`SELECT effect_id FROM game.enchanter_inventory WHERE settlement_id = $1`, settlements[i].SettlementID)
		if err != nil {
			continue
		}
		for eRows.Next() {
			var id int
			if eRows.Scan(&id) == nil {
				settlements[i].EnchanterFX = append(settlements[i].EnchanterFX, id)
			}
		}
		eRows.Close()
	}

	return settlements, nil
}

// loadEffectFactors returns a map of effect_id -> factor from game.effects.
func loadEffectFactors() (map[int]int, error) {
	rows, err := db.Query(`SELECT effect_id, factor FROM game.effects`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[int]int)
	for rows.Next() {
		var id, factor int
		if err := rows.Scan(&id, &factor); err != nil {
			return nil, err
		}
		m[id] = factor
	}
	return m, nil
}

// pickRandom picks up to n random items from a slice (with replacement).
func pickRandom(pool []int, n int) []int {
	if len(pool) == 0 {
		return nil
	}
	if n >= len(pool) {
		// Return a shuffled copy of the entire pool
		result := make([]int, len(pool))
		copy(result, pool)
		rand.Shuffle(len(result), func(i, j int) { result[i], result[j] = result[j], result[i] })
		return result
	}
	// Fisher-Yates partial shuffle for n unique picks
	tmp := make([]int, len(pool))
	copy(tmp, pool)
	for i := 0; i < n; i++ {
		j := i + rand.Intn(len(tmp)-i)
		tmp[i], tmp[j] = tmp[j], tmp[i]
	}
	return tmp[:n]
}
