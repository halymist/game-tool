package main

import (
	"fmt"
	"log"
	"sync"
)

type userActivityCapabilities struct {
	once            sync.Once
	tableExists     bool
	hasLastPlayed   bool
	hasPlayerID     bool
	matchColumnName string
}

var cachedUserActivityCapabilities userActivityCapabilities

func loadUserActivityCapabilities() {
	cachedUserActivityCapabilities.once.Do(func() {
		if db == nil {
			return
		}

		var exists bool
		if err := db.QueryRow(`
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'management' AND table_name = 'users'
            )
        `).Scan(&exists); err != nil {
			log.Printf("User activity capability lookup failed: %v", err)
			return
		}
		if !exists {
			return
		}

		cachedUserActivityCapabilities.tableExists = true

		rows, err := db.Query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'management' AND table_name = 'users'
        `)
		if err != nil {
			log.Printf("User activity column lookup failed: %v", err)
			return
		}
		defer rows.Close()

		columns := make(map[string]bool)
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				log.Printf("User activity column scan failed: %v", err)
				return
			}
			columns[column] = true
		}

		cachedUserActivityCapabilities.hasLastPlayed = columns["last_played"]
		cachedUserActivityCapabilities.hasPlayerID = columns["player_id"]

		for _, candidate := range []string{"cognito_username", "username", "user_name", "login", "email"} {
			if columns[candidate] {
				cachedUserActivityCapabilities.matchColumnName = candidate
				break
			}
		}
	})
}

func canQueryUserLastPlayedByPlayer() bool {
	loadUserActivityCapabilities()
	return cachedUserActivityCapabilities.tableExists &&
		cachedUserActivityCapabilities.hasLastPlayed &&
		cachedUserActivityCapabilities.hasPlayerID
}

func recordUserLastPlayed(username string) {
	if username == "" || db == nil {
		return
	}

	loadUserActivityCapabilities()
	if !cachedUserActivityCapabilities.tableExists ||
		!cachedUserActivityCapabilities.hasLastPlayed ||
		cachedUserActivityCapabilities.matchColumnName == "" {
		return
	}

	query := fmt.Sprintf(
		"UPDATE management.users SET last_played = NOW() WHERE %s = $1",
		validatedUserActivityColumn(cachedUserActivityCapabilities.matchColumnName),
	)
	if _, err := db.Exec(query, username); err != nil {
		log.Printf("Failed to update last_played for %q: %v", username, err)
	}
}

func validatedUserActivityColumn(column string) string {
	switch column {
	case "cognito_username", "username", "user_name", "login", "email":
		return column
	default:
		return "username"
	}
}
