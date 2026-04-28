package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

// Expedition is a settlement-scoped exploration map: an uploaded image plus a
// graph of nodes (each referencing a quest) connected by undirected edges.
//
// Schema lives in tooling.expeditions / expedition_nodes / expedition_edges
// (see migrations/20260501_redesign_expeditions.sql).

type expeditionNode struct {
	NodeID   int     `json:"node_id"`   // 0 for client-only (new) nodes
	ClientID int     `json:"client_id"` // designer-side stable id used to wire edges
	QuestID  *int    `json:"quest_id"`
	IsStart  bool    `json:"is_start"`
	PosX     float64 `json:"pos_x"`
	PosY     float64 `json:"pos_y"`
	Label    *string `json:"label"`
}

type expeditionEdge struct {
	EdgeID    int `json:"edge_id"`
	NodeAID   int `json:"node_a"` // server node_id, populated on read
	NodeBID   int `json:"node_b"`
	AClientID int `json:"a_client_id"` // designer-side ids, used on save
	BClientID int `json:"b_client_id"`
}

type expeditionPayload struct {
	ExpeditionID int              `json:"expedition_id"`
	SettlementID int              `json:"settlement_id"`
	MapAssetID   *int             `json:"map_asset_id"`
	Nodes        []expeditionNode `json:"nodes"`
	Edges        []expeditionEdge `json:"edges"`
}

// ensureExpeditionRow returns the expedition_id for a settlement, creating it
// if it doesn't exist yet.
func ensureExpeditionRow(tx *sql.Tx, settlementID int) (int, *int, error) {
	var id int
	var mapAssetID sql.NullInt64
	err := tx.QueryRow(`SELECT expedition_id, map_asset_id FROM tooling.expeditions WHERE settlement_id = $1`, settlementID).Scan(&id, &mapAssetID)
	if err == sql.ErrNoRows {
		err = tx.QueryRow(`INSERT INTO tooling.expeditions (settlement_id) VALUES ($1) RETURNING expedition_id`, settlementID).Scan(&id)
		if err != nil {
			return 0, nil, err
		}
		return id, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if mapAssetID.Valid {
		v := int(mapAssetID.Int64)
		return id, &v, nil
	}
	return id, nil, nil
}

// handleGetExpedition: GET /api/getExpedition?settlementId=N
// Auto-creates the expedition row if it's missing so the UI always has something to edit.
func handleGetExpedition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settlementIDStr := r.URL.Query().Get("settlementId")
	settlementID, err := strconv.Atoi(settlementIDStr)
	if err != nil || settlementID <= 0 {
		http.Error(w, "settlementId required", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("getExpedition: begin tx: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	expeditionID, mapAssetID, err := ensureExpeditionRow(tx, settlementID)
	if err != nil {
		log.Printf("getExpedition: ensure row: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	nodeRows, err := tx.Query(`SELECT node_id, quest_id, is_start, pos_x, pos_y, label
		FROM tooling.expedition_nodes WHERE expedition_id = $1 ORDER BY node_id`, expeditionID)
	if err != nil {
		log.Printf("getExpedition: query nodes: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer nodeRows.Close()

	nodes := []expeditionNode{}
	for nodeRows.Next() {
		var n expeditionNode
		var questID sql.NullInt64
		var label sql.NullString
		if err := nodeRows.Scan(&n.NodeID, &questID, &n.IsStart, &n.PosX, &n.PosY, &label); err != nil {
			log.Printf("getExpedition: scan node: %v", err)
			continue
		}
		if questID.Valid {
			v := int(questID.Int64)
			n.QuestID = &v
		}
		if label.Valid {
			s := label.String
			n.Label = &s
		}
		// Use server node_id as the client_id when the UI re-loads.
		n.ClientID = n.NodeID
		nodes = append(nodes, n)
	}

	edgeRows, err := tx.Query(`SELECT edge_id, node_a, node_b
		FROM tooling.expedition_edges WHERE expedition_id = $1 ORDER BY edge_id`, expeditionID)
	if err != nil {
		log.Printf("getExpedition: query edges: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer edgeRows.Close()

	edges := []expeditionEdge{}
	for edgeRows.Next() {
		var e expeditionEdge
		if err := edgeRows.Scan(&e.EdgeID, &e.NodeAID, &e.NodeBID); err != nil {
			log.Printf("getExpedition: scan edge: %v", err)
			continue
		}
		e.AClientID = e.NodeAID
		e.BClientID = e.NodeBID
		edges = append(edges, e)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("getExpedition: commit: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	resp := expeditionPayload{
		ExpeditionID: expeditionID,
		SettlementID: settlementID,
		MapAssetID:   mapAssetID,
		Nodes:        nodes,
		Edges:        edges,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleSaveExpedition: POST /api/saveExpedition
// Body: full expeditionPayload. Replaces the entire graph in one tx and
// returns the new server payload (so the client can pick up new node ids).
func handleSaveExpedition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var in expeditionPayload
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.SettlementID <= 0 {
		http.Error(w, "settlement_id required", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("saveExpedition: begin tx: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	expeditionID, _, err := ensureExpeditionRow(tx, in.SettlementID)
	if err != nil {
		log.Printf("saveExpedition: ensure row: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	// Update header (map asset).
	if _, err := tx.Exec(`UPDATE tooling.expeditions SET map_asset_id = $1, updated_at = now() WHERE expedition_id = $2`,
		in.MapAssetID, expeditionID); err != nil {
		log.Printf("saveExpedition: update header: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	// Replace whole graph: delete edges first (FK), then nodes.
	if _, err := tx.Exec(`DELETE FROM tooling.expedition_edges WHERE expedition_id = $1`, expeditionID); err != nil {
		log.Printf("saveExpedition: delete edges: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(`DELETE FROM tooling.expedition_nodes WHERE expedition_id = $1`, expeditionID); err != nil {
		log.Printf("saveExpedition: delete nodes: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	// Insert nodes; build client_id -> new node_id map.
	clientToDB := map[int]int{}
	outNodes := make([]expeditionNode, 0, len(in.Nodes))
	for _, n := range in.Nodes {
		if n.ClientID == 0 {
			http.Error(w, "node missing client_id", http.StatusBadRequest)
			return
		}
		var newID int
		err := tx.QueryRow(`INSERT INTO tooling.expedition_nodes
			(expedition_id, quest_id, is_start, pos_x, pos_y, label)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING node_id`,
			expeditionID, n.QuestID, n.IsStart, n.PosX, n.PosY, n.Label).Scan(&newID)
		if err != nil {
			log.Printf("saveExpedition: insert node: %v", err)
			http.Error(w, "DB error", http.StatusInternalServerError)
			return
		}
		clientToDB[n.ClientID] = newID
		n.NodeID = newID
		outNodes = append(outNodes, n)
	}

	// Insert edges, resolving client ids.
	outEdges := make([]expeditionEdge, 0, len(in.Edges))
	seenPair := map[[2]int]bool{}
	for _, e := range in.Edges {
		a, okA := clientToDB[e.AClientID]
		b, okB := clientToDB[e.BClientID]
		if !okA || !okB || a == b {
			continue
		}
		key := [2]int{a, b}
		if a > b {
			key = [2]int{b, a}
		}
		if seenPair[key] {
			continue
		}
		seenPair[key] = true
		var newID int
		err := tx.QueryRow(`INSERT INTO tooling.expedition_edges
			(expedition_id, node_a, node_b) VALUES ($1, $2, $3) RETURNING edge_id`,
			expeditionID, a, b).Scan(&newID)
		if err != nil {
			log.Printf("saveExpedition: insert edge: %v", err)
			http.Error(w, "DB error", http.StatusInternalServerError)
			return
		}
		outEdges = append(outEdges, expeditionEdge{
			EdgeID: newID, NodeAID: a, NodeBID: b,
			AClientID: a, BClientID: b,
		})
	}

	if err := tx.Commit(); err != nil {
		log.Printf("saveExpedition: commit: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	// Echo back the new server-side ids; client_id maps to the new node_id so
	// the UI can refresh state with no further translation.
	for i := range outNodes {
		outNodes[i].ClientID = outNodes[i].NodeID
	}
	resp := expeditionPayload{
		ExpeditionID: expeditionID,
		SettlementID: in.SettlementID,
		MapAssetID:   in.MapAssetID,
		Nodes:        outNodes,
		Edges:        outEdges,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetQuestsLite: GET /api/getQuestsLite?settlementId=N
// Returns the minimal info needed to populate the node-quest picker.
func handleGetQuestsLite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settlementIDStr := r.URL.Query().Get("settlementId")
	settlementID, err := strconv.Atoi(settlementIDStr)
	if err != nil || settlementID <= 0 {
		http.Error(w, "settlementId required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query(`SELECT quest_id, COALESCE(quest_name, ''), asset_id
		FROM game.quests WHERE settlement_id = $1 ORDER BY quest_name, quest_id`, settlementID)
	if err != nil {
		log.Printf("getQuestsLite: query: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type liteQuest struct {
		QuestID   int    `json:"quest_id"`
		QuestName string `json:"quest_name"`
		AssetID   *int   `json:"asset_id"`
	}
	out := []liteQuest{}
	for rows.Next() {
		var q liteQuest
		var assetID sql.NullInt64
		if err := rows.Scan(&q.QuestID, &q.QuestName, &assetID); err != nil {
			log.Printf("getQuestsLite: scan: %v", err)
			continue
		}
		if assetID.Valid {
			v := int(assetID.Int64)
			q.AssetID = &v
		}
		out = append(out, q)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}
