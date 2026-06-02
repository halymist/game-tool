package main

import (
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"strings"
)

// Server generation is a full 70-day materialization step that runs once when
// an admin creates a server. It currently:
//  1. Builds the public.world day plan from game.world_info.
//  2. Adds settlement daily quests into public.world_quests, avoiding duplicate
//     non-null quest locations within the same settlement/day.
//  3. Adds vendor and enchanter stock into public.vendor/public.enchanter.
//  4. For every active expedition node on the settlement's expedition, finds all
//     game.quests where expedition_quest=true and location_id matches the node,
//     then stores one random per-node pick in public.expedition_node_quests.
//
// Later expansion should keep authored expedition structure in game.* tables
// and server-specific outcomes in public.* tables, so changing generation rules
// does not mutate the designed expedition graph.

// settlementInfo holds the data needed for world generation from game.world_info.
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

type generatedQuest struct {
	QuestID    int
	LocationID *int64
}

type expeditionNodeQuestPool struct {
	ExpeditionID int
	NodeID       int
	LocationID   int64
	QuestIDs     []int
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

func takeSettlementQuests(questBanks map[int][]generatedQuest, settlementID int, limit int) []int {
	if limit <= 0 {
		return nil
	}
	bank := questBanks[settlementID]
	if len(bank) == 0 {
		return nil
	}

	assigned := make([]int, 0, limit)
	remaining := make([]generatedQuest, 0, len(bank))
	usedLocations := make(map[int64]struct{})

	for _, quest := range bank {
		if len(assigned) >= limit {
			remaining = append(remaining, quest)
			continue
		}
		if quest.LocationID != nil {
			if _, exists := usedLocations[*quest.LocationID]; exists {
				remaining = append(remaining, quest)
				continue
			}
			usedLocations[*quest.LocationID] = struct{}{}
		}
		assigned = append(assigned, quest.QuestID)
	}

	questBanks[settlementID] = remaining
	return assigned
}

// generateServerContent creates the 70-day world plan plus quest/vendor/enchanter/expedition-node content.
func generateServerContent(serverID int) error {
	settlements, err := loadSettlementsForGeneration()
	if err != nil {
		return fmt.Errorf("load settlements: %w", err)
	}
	if len(settlements) == 0 {
		return fmt.Errorf("no settlements found in game.world_info")
	}

	var neutral []settlementInfo
	factionPools := map[int][]settlementInfo{}
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
	expeditionQuestPools, err := loadExpeditionQuestPoolsForGeneration()
	if err != nil {
		return fmt.Errorf("load expedition quest pools: %w", err)
	}

	const totalDays = 70
	const neutralBeforeFaction = 5
	factions := []int{1, 2, 3}
	neutralCount := 0

	type dayEntry struct {
		day        int
		settlement settlementInfo
	}
	var plan []dayEntry

	day := 1
	for day <= totalDays {
		if neutralCount >= neutralBeforeFaction && len(factions) > 0 {
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
					duration = 1 + rand.Intn(3)
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
			duration = 1 + rand.Intn(3)
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

		expeditionNodeQuestStmt, err := tx.Prepare(`
			INSERT INTO public.expedition_node_quests
				(server_id, server_day, settlement_id, expedition_id, node_id, location_id, quest_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
		`)
		if err != nil {
			return fmt.Errorf("prepare expedition node quests: %w", err)
		}
		defer expeditionNodeQuestStmt.Close()

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

			for _, pool := range expeditionQuestPools[s.SettlementID] {
				if len(pool.QuestIDs) == 0 {
					continue
				}
				questID := pool.QuestIDs[rand.Intn(len(pool.QuestIDs))]
				if _, err := expeditionNodeQuestStmt.Exec(serverID, entry.day, s.SettlementID, pool.ExpeditionID, pool.NodeID, pool.LocationID, questID); err != nil {
					return fmt.Errorf("insert expedition node quest day %d node %d quest %d: %w", entry.day, pool.NodeID, questID, err)
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

func loadQuestBanksForGeneration() (map[int][]generatedQuest, error) {
	rows, err := db.Query(`
		SELECT qc.settlement_id, q.quest_id, q.location_id
		FROM game.questchain qc
		JOIN game.quests q ON q.questchain_id = qc.questchain_id
		WHERE COALESCE(q.expedition_quest, FALSE) = FALSE
		ORDER BY qc.settlement_id, qc.name, q.sort_order, q.quest_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questBanks := make(map[int][]generatedQuest)
	seenBySettlement := make(map[int]map[int]struct{})
	for rows.Next() {
		var settlementID int
		var questID int
		var locationID sql.NullInt64
		if err := rows.Scan(&settlementID, &questID, &locationID); err != nil {
			return nil, err
		}
		if seenBySettlement[settlementID] == nil {
			seenBySettlement[settlementID] = make(map[int]struct{})
		}
		if _, exists := seenBySettlement[settlementID][questID]; exists {
			continue
		}
		var locationPtr *int64
		if locationID.Valid {
			v := locationID.Int64
			locationPtr = &v
		}
		seenBySettlement[settlementID][questID] = struct{}{}
		questBanks[settlementID] = append(questBanks[settlementID], generatedQuest{QuestID: questID, LocationID: locationPtr})
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

func loadExpeditionQuestPoolsForGeneration() (map[int][]expeditionNodeQuestPool, error) {
	rows, err := db.Query(`
		SELECT e.settlement_id, e.expedition_id, n.node_id, n.location_id, q.quest_id
		FROM game.expeditions e
		JOIN game.expedition_nodes n ON n.expedition_id = e.expedition_id
		JOIN game.quests q
		  ON q.location_id = n.location_id
		 AND COALESCE(q.expedition_quest, FALSE) = TRUE
		WHERE COALESCE(e.is_deleted, FALSE) = FALSE
		  AND COALESCE(n.is_deleted, FALSE) = FALSE
		  AND n.location_id IS NOT NULL
		ORDER BY e.settlement_id, n.node_id, q.quest_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bySettlement := make(map[int][]expeditionNodeQuestPool)
	poolIndex := make(map[int]map[int]int)
	for rows.Next() {
		var settlementID int
		var expeditionID int
		var nodeID int
		var locationID int64
		var questID int
		if err := rows.Scan(&settlementID, &expeditionID, &nodeID, &locationID, &questID); err != nil {
			return nil, err
		}
		if poolIndex[settlementID] == nil {
			poolIndex[settlementID] = make(map[int]int)
		}
		idx, exists := poolIndex[settlementID][nodeID]
		if !exists {
			idx = len(bySettlement[settlementID])
			poolIndex[settlementID][nodeID] = idx
			bySettlement[settlementID] = append(bySettlement[settlementID], expeditionNodeQuestPool{
				ExpeditionID: expeditionID,
				NodeID:       nodeID,
				LocationID:   locationID,
			})
		}
		bySettlement[settlementID][idx].QuestIDs = append(bySettlement[settlementID][idx].QuestIDs, questID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return bySettlement, nil
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
		result := make([]int, len(pool))
		copy(result, pool)
		rand.Shuffle(len(result), func(i, j int) { result[i], result[j] = result[j], result[i] })
		return result
	}
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
