package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
)

type authContextKey struct{}

func apiHandler(next http.HandlerFunc) http.HandlerFunc {
	return corsHandler(requireAuth(next))
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if authAlreadyVerified(r) {
			next(w, r)
			return
		}

		if !isAuthenticated(r) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), authContextKey{}, true)
		next(w, r.WithContext(ctx))
	}
}

func authAlreadyVerified(r *http.Request) bool {
	verified, _ := r.Context().Value(authContextKey{}).(bool)
	return verified
}

func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

func withTx(fn func(*sql.Tx) error) error {
	if db == nil {
		return fmt.Errorf("database not available")
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}
