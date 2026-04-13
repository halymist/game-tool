//go:build ignore

package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func main() {
	godotenv.Load(".env")
	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "localhost"
	}
	dbPass := os.Getenv("DB_PASSWORD")

	psqlInfo := fmt.Sprintf("host=%s port=5432 user=postgres password=%s dbname=Game sslmode=disable", dbHost, dbPass)
	db, err := sql.Open("postgres", psqlInfo)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Run migration
	migration, err := os.ReadFile("migrations/20260215_settlement_serial_id.sql")
	if err != nil {
		log.Fatalf("Failed to read migration: %v", err)
	}

	_, err = db.Exec(string(migration))
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	fmt.Println("Migration successful!")

	// Verify
	rows, err := db.Query(`
		SELECT column_name, data_type, column_default, is_nullable
		FROM information_schema.columns 
		WHERE table_schema='game' AND table_name='world_info' 
		ORDER BY ordinal_position
	`)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Println("\n=== game.world_info columns (after migration) ===")
	for rows.Next() {
		var colName, dataType, isNullable string
		var colDefault sql.NullString
		rows.Scan(&colName, &dataType, &colDefault, &isNullable)
		fmt.Printf("  %-30s %-20s default=%-30s nullable=%s\n", colName, dataType, colDefault.String, isNullable)
	}
}
