package main

import (
	crand "crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

type CouponRecord struct {
	ID            int       `json:"id"`
	Code          string    `json:"code"`
	ExpiresAt     time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
	PurchaseCount int       `json:"purchase_count"`
	IsActive      bool      `json:"is_active"`
}

type CouponResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Coupons []CouponRecord `json:"coupons,omitempty"`
	Coupon  *CouponRecord  `json:"coupon,omitempty"`
}

type CreateCouponRequest struct {
	Code      *string `json:"code"`
	ExpiresAt *string `json:"expiresAt"`
}

type DeleteCouponRequest struct {
	ID int `json:"id"`
}

func handleGetCoupons(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Database not available"})
		return
	}

	query := `
		SELECT c.id,
		       c.code,
		       c.expires_at,
		       c.created_at,
		       COUNT(cp.id) AS purchase_count,
		       (c.expires_at > NOW()) AS is_active
		FROM management.coupons c
		LEFT JOIN management.coupon_purchases cp ON cp.coupon_id = c.id
		GROUP BY c.id
		ORDER BY
			(c.expires_at > NOW()) DESC,
			CASE WHEN c.expires_at > NOW() THEN c.expires_at END ASC,
			CASE WHEN c.expires_at <= NOW() THEN c.expires_at END DESC,
			c.id DESC
	`

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: fmt.Sprintf("Query failed: %v", err)})
		return
	}
	defer rows.Close()

	coupons := make([]CouponRecord, 0)
	for rows.Next() {
		var coupon CouponRecord
		if err := rows.Scan(&coupon.ID, &coupon.Code, &coupon.ExpiresAt, &coupon.CreatedAt, &coupon.PurchaseCount, &coupon.IsActive); err != nil {
			json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: fmt.Sprintf("Scan failed: %v", err)})
			return
		}
		coupons = append(coupons, coupon)
	}

	if err := rows.Err(); err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: fmt.Sprintf("Rows failed: %v", err)})
		return
	}

	json.NewEncoder(w).Encode(CouponResponse{Success: true, Coupons: coupons})
}

func handleCreateCoupon(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Database not available"})
		return
	}

	var req CreateCouponRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Invalid request body"})
		return
	}

	expiresAt, err := parseCouponExpiry(req.ExpiresAt)
	if err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: err.Error()})
		return
	}
	if !expiresAt.After(time.Now()) {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Expiration must be in the future"})
		return
	}

	code := ""
	if req.Code != nil {
		code = strings.ToUpper(strings.TrimSpace(*req.Code))
	}
	if code == "" {
		generated, genErr := generateCouponCode(12)
		if genErr != nil {
			json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Failed to generate coupon code"})
			return
		}
		code = generated
	}

	if !isCouponCodeValid(code) {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Code can contain only A-Z, 0-9, dash, and underscore"})
		return
	}

	query := `
		INSERT INTO management.coupons (code, expires_at)
		VALUES ($1, $2)
		RETURNING id, code, expires_at, created_at
	`

	coupon := CouponRecord{PurchaseCount: 0}
	if err := db.QueryRow(query, code, expiresAt).Scan(&coupon.ID, &coupon.Code, &coupon.ExpiresAt, &coupon.CreatedAt); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Coupon code already exists"})
			return
		}
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: fmt.Sprintf("Create failed: %v", err)})
		return
	}

	coupon.IsActive = coupon.ExpiresAt.After(time.Now())
	log.Printf("COUPON CREATED id=%d code=%s expires_at=%s", coupon.ID, coupon.Code, coupon.ExpiresAt.Format(time.RFC3339))
	_, _ = db.Exec("NOTIFY management_coupons, 'created'")

	json.NewEncoder(w).Encode(CouponResponse{Success: true, Coupon: &coupon})
}

func handleDeleteCoupon(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if db == nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Database not available"})
		return
	}

	var req DeleteCouponRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Invalid request body"})
		return
	}
	if req.ID == 0 {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: "Missing id"})
		return
	}

	query := `
		DELETE FROM management.coupons
		WHERE id = $1
		RETURNING id, code, expires_at, created_at
	`

	deleted := CouponRecord{}
	if err := db.QueryRow(query, req.ID).Scan(&deleted.ID, &deleted.Code, &deleted.ExpiresAt, &deleted.CreatedAt); err != nil {
		json.NewEncoder(w).Encode(CouponResponse{Success: false, Message: fmt.Sprintf("Delete failed: %v", err)})
		return
	}

	log.Printf("COUPON DELETED id=%d code=%s", deleted.ID, deleted.Code)
	_, _ = db.Exec("NOTIFY management_coupons, 'deleted'")

	json.NewEncoder(w).Encode(CouponResponse{Success: true, Coupon: &deleted})
}

func parseCouponExpiry(value *string) (time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return time.Time{}, fmt.Errorf("Expiration is required")
	}

	raw := strings.TrimSpace(*value)
	if parsedDate, err := time.ParseInLocation("2.1.2006", raw, time.Local); err == nil {
		return parsedDate, nil
	}
	if parsedDate, err := time.ParseInLocation("02.01.2006", raw, time.Local); err == nil {
		return parsedDate, nil
	}
	if parsedDate, err := time.ParseInLocation("2.1.06", raw, time.Local); err == nil {
		return parsedDate, nil
	}
	if parsedDate, err := time.ParseInLocation("2006-01-02", raw, time.Local); err == nil {
		return parsedDate, nil
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		normalized := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, parsed.Location())
		return normalized, nil
	}
	if parsed, err := time.Parse("2006-01-02T15:04", raw); err == nil {
		normalized := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, parsed.Location())
		return normalized, nil
	}
	return time.Time{}, fmt.Errorf("Invalid expiration format")
}

func isCouponCodeValid(code string) bool {
	if len(code) < 4 || len(code) > 64 {
		return false
	}
	for _, r := range code {
		switch {
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

func generateCouponCode(length int) (string, error) {
	if length < 4 {
		length = 4
	}

	alphabet := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bytes := make([]byte, length)
	random := make([]byte, length)
	if _, err := crand.Read(random); err != nil {
		log.Printf("Failed to generate random coupon code: %v", err)
		return "", err
	}

	for i := range bytes {
		bytes[i] = alphabet[int(random[i])%len(alphabet)]
	}

	return string(bytes), nil
}
