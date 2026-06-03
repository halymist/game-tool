package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"time"
)

const analyticsActiveWindowDays = 14

type AnalyticsOverviewResponse struct {
	Success          bool                    `json:"success"`
	Message          string                  `json:"message,omitempty"`
	GeneratedAt      time.Time               `json:"generatedAt,omitempty"`
	ActiveWindowDays int                     `json:"activeWindowDays,omitempty"`
	Servers          []AnalyticsServerRecord `json:"servers,omitempty"`
}

type AnalyticsServerRecord struct {
	ServerID            int                     `json:"serverId"`
	ServerName          string                  `json:"serverName"`
	CreatedAt           time.Time               `json:"createdAt"`
	EndsAt              time.Time               `json:"endsAt"`
	CurrentDay          int                     `json:"currentDay"`
	PlayerCount         int                     `json:"playerCount"`
	CharacterCount      int                     `json:"characterCount"`
	ActivePlayerCount   *int                    `json:"activePlayerCount,omitempty"`
	InactivePlayerCount *int                    `json:"inactivePlayerCount,omitempty"`
	Factions            []AnalyticsFactionCount `json:"factions"`
}

type AnalyticsFactionCount struct {
	Faction int    `json:"faction"`
	Label   string `json:"label"`
	Count   int    `json:"count"`
}

func handleGetAnalyticsOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	servers, err := loadAnalyticsOverview()
	if err != nil {
		log.Printf("Error loading analytics overview: %v", err)
		json.NewEncoder(w).Encode(AnalyticsOverviewResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(AnalyticsOverviewResponse{
		Success:          true,
		GeneratedAt:      time.Now().UTC(),
		ActiveWindowDays: analyticsActiveWindowDays,
		Servers:          servers,
	})
}

func loadAnalyticsOverview() ([]AnalyticsServerRecord, error) {
	rows, err := db.Query(`
        SELECT s.id,
               COALESCE(s.name, ''),
               s.created_at,
               s.ends_at,
               COUNT(c.character_id) AS character_count,
               COUNT(DISTINCT c.player_id) AS player_count
        FROM management.servers s
        LEFT JOIN public.characters c ON c.server_id = s.id
        GROUP BY s.id, s.name, s.created_at, s.ends_at
        ORDER BY s.id DESC
    `)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	servers := make([]AnalyticsServerRecord, 0)
	byServerID := make(map[int]*AnalyticsServerRecord)
	for rows.Next() {
		var record AnalyticsServerRecord
		if err := rows.Scan(
			&record.ServerID,
			&record.ServerName,
			&record.CreatedAt,
			&record.EndsAt,
			&record.CharacterCount,
			&record.PlayerCount,
		); err != nil {
			return nil, err
		}
		record.CurrentDay = calculateServerDay(record.CreatedAt, time.Now())
		record.Factions = []AnalyticsFactionCount{}
		servers = append(servers, record)
		byServerID[record.ServerID] = &servers[len(servers)-1]
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := loadAnalyticsFactions(byServerID); err != nil {
		return nil, err
	}
	if err := loadAnalyticsActivity(byServerID); err != nil {
		return nil, err
	}

	return servers, nil
}

func loadAnalyticsFactions(byServerID map[int]*AnalyticsServerRecord) error {
	rows, err := db.Query(`
        SELECT server_id, COALESCE(faction, 0) AS faction, COUNT(*) AS character_count
        FROM public.characters
        GROUP BY server_id, COALESCE(faction, 0)
        ORDER BY server_id, COALESCE(faction, 0)
    `)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var serverID int
		var faction int
		var count int
		if err := rows.Scan(&serverID, &faction, &count); err != nil {
			return err
		}
		record := byServerID[serverID]
		if record == nil {
			continue
		}
		record.Factions = append(record.Factions, AnalyticsFactionCount{
			Faction: faction,
			Label:   analyticsFactionLabel(faction),
			Count:   count,
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, record := range byServerID {
		sort.Slice(record.Factions, func(i, j int) bool {
			return record.Factions[i].Faction < record.Factions[j].Faction
		})
	}
	return nil
}

func loadAnalyticsActivity(byServerID map[int]*AnalyticsServerRecord) error {
	if !canQueryUserLastPlayedByPlayer() {
		return nil
	}

	rows, err := db.Query(`
        SELECT c.server_id,
               COUNT(DISTINCT CASE WHEN u.last_played >= NOW() - ($1 * INTERVAL '1 day') THEN c.player_id END) AS active_player_count,
               COUNT(DISTINCT CASE WHEN u.last_played < NOW() - ($1 * INTERVAL '1 day') OR u.last_played IS NULL THEN c.player_id END) AS inactive_player_count
        FROM public.characters c
        LEFT JOIN management.users u ON u.player_id = c.player_id
        GROUP BY c.server_id
        ORDER BY c.server_id
    `, analyticsActiveWindowDays)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var serverID int
		var activeCount int
		var inactiveCount int
		if err := rows.Scan(&serverID, &activeCount, &inactiveCount); err != nil {
			return err
		}
		record := byServerID[serverID]
		if record == nil {
			continue
		}
		record.ActivePlayerCount = intPtr(activeCount)
		record.InactivePlayerCount = intPtr(inactiveCount)
	}

	return rows.Err()
}

func analyticsFactionLabel(faction int) string {
	switch faction {
	case 1:
		return "Order"
	case 2:
		return "Guild"
	case 3:
		return "Companions"
	default:
		return "Neutral"
	}
}

func intPtr(value int) *int {
	return &value
}
