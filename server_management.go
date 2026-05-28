package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
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
	if err := decodeJSON(r, &req); err != nil {
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
	EnchanterFX  map[string][]int // item slot -> effect_id list
}

const serverQuestsPerSettlementDay = 5

func chooseFactionSettlements(factionPools map[int][]settlementInfo) map[int]settlementInfo {
	chosen := make(map[int]settlementInfo, len(factionPools))
	for faction, pool := range factionPools {
		if len(pool) == 0 {
			continue
		}
		chosen[faction] = pool[rand.Intn(len(pool))]
	}
	return chosen
}

func takeSettlementQuests(questBanks map[int][]int, settlementID int, limit int) []int {
	if limit <= 0 {
		return nil
	}
	bank := questBanks[settlementID]
	if len(bank) == 0 {
		return nil
	}
	if limit > len(bank) {
		limit = len(bank)
	}
	assigned := append([]int(nil), bank[:limit]...)
	questBanks[settlementID] = bank[limit:]
	return assigned
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
	factionSettlements := chooseFactionSettlements(factionPools)

	questBanks, err := loadQuestBanksForGeneration()
	if err != nil {
		return fmt.Errorf("load quest banks: %w", err)
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
				pick, ok := factionSettlements[f]
				if !ok {
					continue
				}

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

	effectFactors, err := loadEffectFactors()
	if err != nil {
		return fmt.Errorf("load effect factors: %w", err)
	}

	if err := withTx(func(tx *sql.Tx) error {
		worldQuestStmt, err := tx.Prepare(`
			INSERT INTO public.world_quests (server_id, server_day, settlement_id, quest_id)
			VALUES ($1,$2,$3,$4)
		`)
		if err != nil {
			return fmt.Errorf("prepare world quests: %w", err)
		}
		defer worldQuestStmt.Close()

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

			for _, questID := range takeSettlementQuests(questBanks, s.SettlementID, serverQuestsPerSettlementDay) {
				if _, err := worldQuestStmt.Exec(serverID, entry.day, s.SettlementID, questID); err != nil {
					return fmt.Errorf("insert world quest day %d quest %d: %w", entry.day, questID, err)
				}
			}

			if len(s.VendorItems) > 0 {
				picked := pickRandom(s.VendorItems, 8)
				for _, itemID := range picked {
					if _, err := vendorStmt.Exec(serverID, entry.day, s.SettlementID, itemID); err != nil {
						return fmt.Errorf("insert vendor day %d item %d: %w", entry.day, itemID, err)
					}
				}
			}

			if s.Enchanter {
				picked, err := pickEnchanterEffects(s.EnchanterFX)
				if err != nil {
					return fmt.Errorf("pick enchanter effects for settlement %d day %d: %w", s.SettlementID, entry.day, err)
				}
				for _, effectID := range picked {
					factor := effectFactors[effectID]
					if _, err := enchanterStmt.Exec(serverID, entry.day, s.SettlementID, effectID, factor); err != nil {
						return fmt.Errorf("insert enchanter day %d effect %d: %w", entry.day, effectID, err)
					}
				}
			}
		}
		return nil
	}); err != nil {
		return err
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
		eRows, err := db.Query(`
			SELECT DISTINCT ei.effect_id, e.slot::text
			FROM game.enchanter_inventory ei
			JOIN game.effects e ON e.effect_id = ei.effect_id
			WHERE ei.settlement_id = $1
			  AND e.slot IS NOT NULL
		`, settlements[i].SettlementID)
		if err != nil {
			continue
		}
		for eRows.Next() {
			var id int
			var slot string
			if eRows.Scan(&id, &slot) == nil {
				slot = strings.TrimSpace(slot)
				if slot == "" {
					continue
				}
				if settlements[i].EnchanterFX == nil {
					settlements[i].EnchanterFX = make(map[string][]int)
				}
				settlements[i].EnchanterFX[slot] = append(settlements[i].EnchanterFX[slot], id)
			}
		}
		eRows.Close()
	}

	return settlements, nil
}

func loadQuestBanksForGeneration() (map[int][]int, error) {
	rows, err := db.Query(`
		SELECT qc.settlement_id, q.quest_id
		FROM game.questchain qc
		JOIN game.quests q ON q.questchain_id = qc.questchain_id
		WHERE COALESCE(q.expedition_quest, FALSE) = FALSE
		ORDER BY qc.settlement_id, qc.name, q.sort_order, q.quest_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questBanks := make(map[int][]int)
	seenBySettlement := make(map[int]map[int]struct{})
	for rows.Next() {
		var settlementID int
		var questID int
		if err := rows.Scan(&settlementID, &questID); err != nil {
			return nil, err
		}
		if seenBySettlement[settlementID] == nil {
			seenBySettlement[settlementID] = make(map[int]struct{})
		}
		if _, exists := seenBySettlement[settlementID][questID]; exists {
			continue
		}
		seenBySettlement[settlementID][questID] = struct{}{}
		questBanks[settlementID] = append(questBanks[settlementID], questID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for settlementID := range questBanks {
		rand.Shuffle(len(questBanks[settlementID]), func(i, j int) {
			questBanks[settlementID][i], questBanks[settlementID][j] = questBanks[settlementID][j], questBanks[settlementID][i]
		})
	}

	return questBanks, nil
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

// pickEnchanterEffects picks 4 unique item slots and 3 unique effects per slot.
func pickEnchanterEffects(slotEffects map[string][]int) ([]int, error) {
	eligibleSlots := make([]string, 0, len(slotEffects))
	for slot, effects := range slotEffects {
		if len(effects) >= 3 {
			eligibleSlots = append(eligibleSlots, slot)
		}
	}
	if len(eligibleSlots) < 4 {
		return nil, fmt.Errorf("need at least 4 item slots with 3 effects each, found %d", len(eligibleSlots))
	}

	pickedSlots := pickRandomStrings(eligibleSlots, 4)
	pickedEffects := make([]int, 0, 12)
	for _, slot := range pickedSlots {
		pickedEffects = append(pickedEffects, pickRandom(slotEffects[slot], 3)...)
	}
	return pickedEffects, nil
}

// pickRandom picks up to n unique random items from a slice.
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

func pickRandomStrings(pool []string, n int) []string {
	if len(pool) == 0 {
		return nil
	}
	if n >= len(pool) {
		result := make([]string, len(pool))
		copy(result, pool)
		rand.Shuffle(len(result), func(i, j int) { result[i], result[j] = result[j], result[i] })
		return result
	}
	tmp := make([]string, len(pool))
	copy(tmp, pool)
	for i := 0; i < n; i++ {
		j := i + rand.Intn(len(tmp)-i)
		tmp[i], tmp[j] = tmp[j], tmp[i]
	}
	return tmp[:n]
}
