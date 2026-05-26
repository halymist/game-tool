package main

import (
	"fmt"
	"math/rand"
	"testing"
	"time"
)

func TestChooseFactionSettlementsKeepsOnePerFaction(t *testing.T) {
	rand.Seed(1)

	factionOneA := settlementInfo{SettlementID: 6, Faction: serverMgmtIntPtr(1)}
	factionOneB := settlementInfo{SettlementID: 11, Faction: serverMgmtIntPtr(1)}
	factionTwo := settlementInfo{SettlementID: 7, Faction: serverMgmtIntPtr(2)}
	factionThree := settlementInfo{SettlementID: 8, Faction: serverMgmtIntPtr(3)}

	chosen := chooseFactionSettlements(map[int][]settlementInfo{
		1: {factionOneA, factionOneB},
		2: {factionTwo},
		3: {factionThree},
	})

	if len(chosen) != 3 {
		t.Fatalf("expected 3 chosen faction settlements, got %d", len(chosen))
	}
	if chosen[2].SettlementID != 7 {
		t.Fatalf("expected faction 2 settlement 7, got %d", chosen[2].SettlementID)
	}
	if chosen[3].SettlementID != 8 {
		t.Fatalf("expected faction 3 settlement 8, got %d", chosen[3].SettlementID)
	}
	if chosen[1].SettlementID != 6 && chosen[1].SettlementID != 11 {
		t.Fatalf("expected faction 1 settlement 6 or 11, got %d", chosen[1].SettlementID)
	}
}

func TestTakeSettlementQuestsConsumesFiniteBank(t *testing.T) {
	questBanks := map[int][]int{
		6: {101, 102, 103, 104, 105, 106},
	}

	firstDay := takeSettlementQuests(questBanks, 6, 5)
	if len(firstDay) != 5 {
		t.Fatalf("expected 5 quests on first day, got %d", len(firstDay))
	}
	if len(questBanks[6]) != 1 {
		t.Fatalf("expected 1 quest left in bank, got %d", len(questBanks[6]))
	}

	secondDay := takeSettlementQuests(questBanks, 6, 5)
	if len(secondDay) != 1 {
		t.Fatalf("expected 1 quest on second day, got %d", len(secondDay))
	}

	thirdDay := takeSettlementQuests(questBanks, 6, 5)
	if len(thirdDay) != 0 {
		t.Fatalf("expected 0 quests once bank is exhausted, got %d", len(thirdDay))
	}
}

func TestGenerateServerContentKeepsFactionSettlementStableAndCapsDailyQuests(t *testing.T) {
	serverName := fmt.Sprintf("server-generation-test-%d", time.Now().UnixNano())
	startsAt := time.Now().UTC().Truncate(time.Second)
	endsAt := startsAt.Add(70 * 24 * time.Hour)

	var serverID int
	if err := db.QueryRow(
		`INSERT INTO management.servers (name, created_at, ends_at) VALUES ($1, $2, $3) RETURNING id`,
		serverName, startsAt, endsAt,
	).Scan(&serverID); err != nil {
		t.Fatalf("insert test server: %v", err)
	}

	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM public.world_quests WHERE server_id = $1`, serverID)
		_, _ = db.Exec(`DELETE FROM public.enchanter WHERE server_id = $1`, serverID)
		_, _ = db.Exec(`DELETE FROM public.vendor WHERE server_id = $1`, serverID)
		_, _ = db.Exec(`DELETE FROM public.world WHERE server_id = $1`, serverID)
		_, _ = db.Exec(`DELETE FROM management.servers WHERE id = $1`, serverID)
	})

	if err := generateServerContent(serverID); err != nil {
		t.Fatalf("generate server content: %v", err)
	}

	rows, err := db.Query(`
		SELECT faction, COUNT(DISTINCT settlement_id)
		FROM public.world
		WHERE server_id = $1 AND faction IN (1, 2, 3)
		GROUP BY faction
		ORDER BY faction
	`, serverID)
	if err != nil {
		t.Fatalf("query faction settlement counts: %v", err)
	}
	defer rows.Close()

	factionRows := 0
	for rows.Next() {
		var faction int
		var settlementCount int
		if err := rows.Scan(&faction, &settlementCount); err != nil {
			t.Fatalf("scan faction settlement counts: %v", err)
		}
		factionRows++
		if settlementCount != 1 {
			t.Fatalf("expected faction %d to use exactly 1 settlement, got %d", faction, settlementCount)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate faction settlement counts: %v", err)
	}
	if factionRows == 0 {
		t.Fatal("expected faction-specific days to be generated")
	}

	questRows, err := db.Query(`
		SELECT server_day, settlement_id, COUNT(*)
		FROM public.world_quests
		WHERE server_id = $1
		GROUP BY server_day, settlement_id
		ORDER BY server_day, settlement_id
	`, serverID)
	if err != nil {
		t.Fatalf("query world quest counts: %v", err)
	}
	defer questRows.Close()

	hasFiveQuestDay := false
	for questRows.Next() {
		var serverDay int
		var settlementID int
		var questCount int
		if err := questRows.Scan(&serverDay, &settlementID, &questCount); err != nil {
			t.Fatalf("scan world quest counts: %v", err)
		}
		if questCount > serverQuestsPerSettlementDay {
			t.Fatalf("expected at most %d quests on day %d settlement %d, got %d", serverQuestsPerSettlementDay, serverDay, settlementID, questCount)
		}
		if questCount == serverQuestsPerSettlementDay {
			hasFiveQuestDay = true
		}
	}
	if err := questRows.Err(); err != nil {
		t.Fatalf("iterate world quest counts: %v", err)
	}
	if !hasFiveQuestDay {
		t.Fatalf("expected at least one settlement-day with %d quests assigned", serverQuestsPerSettlementDay)
	}

	var nonExpeditionAssignments int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM public.world_quests wq
		JOIN game.quests q ON q.quest_id = wq.quest_id
		WHERE wq.server_id = $1 AND COALESCE(q.expedition_quest, FALSE) = TRUE
	`, serverID).Scan(&nonExpeditionAssignments); err != nil {
		t.Fatalf("count expedition assignments: %v", err)
	}
	if nonExpeditionAssignments != 0 {
		t.Fatalf("expected no expedition quests in world_quests, got %d", nonExpeditionAssignments)
	}
}

func serverMgmtIntPtr(value int) *int {
	return &value
}
