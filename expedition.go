package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

// Expedition is a settlement-scoped exploration map: an uploaded image plus a
// graph of location nodes connected by undirected edges. A node does not store
// one authored quest; available expedition quests are derived from its location.
//
// Schema lives in game.expeditions / expedition_nodes / expedition_edges
// with expedition-level versioning and soft-deletes (see migrations/20260502_expeditions_game_versioned.sql).

type expeditionNode struct {
	NodeID     int     `json:"node_id"`   // 0 for client-only (new) nodes
	ClientID   int     `json:"client_id"` // designer-side stable id used to wire edges
	LocationID *int64  `json:"location_id"`
	QuestID    *int    `json:"quest_id"`
	IsStart    bool    `json:"is_start"`
	PosX       float64 `json:"pos_x"`
	PosY       float64 `json:"pos_y"`
	Label      *string `json:"label"`
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
	Version      int              `json:"version,omitempty"`
}

type expeditionValidationError string

func (e expeditionValidationError) Error() string { return string(e) }

func orderedNodePair(a, b int) (int, int) {
	if a > b {
		return b, a
	}
	return a, b
}

func nextExpeditionVersion(tx *sql.Tx) (int, error) {
	var next int
	err := tx.QueryRow(`
		SELECT COALESCE(MAX(version), 0) + 1
		FROM game.expeditions
	`).Scan(&next)
	if err != nil {
		return 0, err
	}
	if next <= 0 {
		return 1, nil
	}
	return next, nil
}

// ensureExpeditionRow returns the expedition_id for a settlement, creating it
// if it doesn't exist yet.
func ensureExpeditionRow(tx *sql.Tx, settlementID int, createVersion int) (int, *int, int, error) {
	var id int
	var mapAssetID sql.NullInt64
	var version int
	err := tx.QueryRow(`
		SELECT expedition_id, map_asset_id, COALESCE(version, 1)
		FROM game.expeditions
		WHERE settlement_id = $1
	`, settlementID).Scan(&id, &mapAssetID, &version)
	if err == sql.ErrNoRows {
		if createVersion <= 0 {
			createVersion = 1
		}
		err = tx.QueryRow(`
			INSERT INTO game.expeditions (settlement_id, version, is_deleted)
			VALUES ($1, $2, FALSE)
			RETURNING expedition_id
		`, settlementID, createVersion).Scan(&id)
		if err != nil {
			return 0, nil, 0, err
		}
		return id, nil, createVersion, nil
	}
	if err != nil {
		return 0, nil, 0, err
	}
	if mapAssetID.Valid {
		v := int(mapAssetID.Int64)
		return id, &v, version, nil
	}
	return id, nil, version, nil
}

func ensureNodeLocationHasExpeditionQuests(tx *sql.Tx, locationID int64) error {
	var hasQuest bool
	if err := tx.QueryRow(`
		SELECT EXISTS(
			SELECT 1
			FROM game.quests q
			WHERE q.location_id = $1
			  AND COALESCE(q.expedition_quest, FALSE) = TRUE
		)
	`, locationID).Scan(&hasQuest); err != nil {
		return fmt.Errorf("validate node location %d: %w", locationID, err)
	}
	if !hasQuest {
		return expeditionValidationError(fmt.Sprintf("location %d has no expedition quests", locationID))
	}
	return nil
}

// handleGetExpedition: GET /api/getExpedition?settlementId=N
// Auto-creates the expedition row if it's missing so the UI always has something to edit.
func handleGetExpedition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	settlementIDStr := r.URL.Query().Get("settlementId")
	settlementID, err := strconv.Atoi(settlementIDStr)
	if err != nil || settlementID <= 0 {
		http.Error(w, "settlementId required", http.StatusBadRequest)
		return
	}

	var expeditionID int
	var mapAssetID *int
	var version int
	nodes := []expeditionNode{}
	edges := []expeditionEdge{}

	if err := withTx(func(tx *sql.Tx) error {
		var err error
		expeditionID, mapAssetID, version, err = ensureExpeditionRow(tx, settlementID, 1)
		if err != nil {
			return fmt.Errorf("ensure row: %w", err)
		}

		nodeRows, err := tx.Query(`
			SELECT node_id, location_id, quest_id, is_start, pos_x, pos_y, label
			FROM game.expedition_nodes
			WHERE expedition_id = $1 AND is_deleted = FALSE
			ORDER BY node_id
		`, expeditionID)
		if err != nil {
			return fmt.Errorf("query nodes: %w", err)
		}
		defer nodeRows.Close()

		for nodeRows.Next() {
			var n expeditionNode
			var locationID sql.NullInt64
			var questID sql.NullInt64
			var label sql.NullString
			if err := nodeRows.Scan(&n.NodeID, &locationID, &questID, &n.IsStart, &n.PosX, &n.PosY, &label); err != nil {
				log.Printf("getExpedition: scan node: %v", err)
				continue
			}
			if locationID.Valid {
				v := locationID.Int64
				n.LocationID = &v
			}
			if questID.Valid {
				v := int(questID.Int64)
				n.QuestID = &v
			}
			if label.Valid {
				s := label.String
				n.Label = &s
			}
			n.ClientID = n.NodeID
			nodes = append(nodes, n)
		}

		edgeRows, err := tx.Query(`
			SELECT edge_id, node_a, node_b
			FROM game.expedition_edges
			WHERE expedition_id = $1 AND is_deleted = FALSE
			ORDER BY edge_id
		`, expeditionID)
		if err != nil {
			return fmt.Errorf("query edges: %w", err)
		}
		defer edgeRows.Close()

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
		return nil
	}); err != nil {
		log.Printf("getExpedition: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	resp := expeditionPayload{
		ExpeditionID: expeditionID,
		SettlementID: settlementID,
		MapAssetID:   mapAssetID,
		Nodes:        nodes,
		Edges:        edges,
		Version:      version,
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
	var in expeditionPayload
	if err := decodeJSON(r, &in); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.SettlementID <= 0 {
		http.Error(w, "settlement_id required", http.StatusBadRequest)
		return
	}
	for _, n := range in.Nodes {
		if n.ClientID == 0 {
			http.Error(w, "node missing client_id", http.StatusBadRequest)
			return
		}
		if n.LocationID == nil || *n.LocationID <= 0 {
			http.Error(w, "every expedition node must have a location", http.StatusBadRequest)
			return
		}
	}

	var expeditionID int
	var saveVersion int
	outNodes := make([]expeditionNode, 0, len(in.Nodes))
	outEdges := make([]expeditionEdge, 0, len(in.Edges))

	if err := withTx(func(tx *sql.Tx) error {
		nextVersion, err := nextExpeditionVersion(tx)
		if err != nil {
			return fmt.Errorf("compute version: %w", err)
		}
		saveVersion = nextVersion

		expeditionID, _, _, err = ensureExpeditionRow(tx, in.SettlementID, saveVersion)
		if err != nil {
			return fmt.Errorf("ensure row: %w", err)
		}

		if _, err := tx.Exec(`
			UPDATE game.expeditions
			SET map_asset_id = $1,
				updated_at = now(),
				version = $2,
				is_deleted = FALSE
			WHERE expedition_id = $3
		`, in.MapAssetID, saveVersion, expeditionID); err != nil {
			return fmt.Errorf("update header: %w", err)
		}

		type existingNode struct {
			locationID *int64
			questID    *int
			isStart    bool
			posX       float64
			posY       float64
			label      *string
		}
		existingNodes := make(map[int]existingNode)
		nodeRows, err := tx.Query(`
			SELECT node_id, location_id, quest_id, is_start, pos_x, pos_y, label
			FROM game.expedition_nodes
			WHERE expedition_id = $1 AND is_deleted = FALSE
		`, expeditionID)
		if err != nil {
			return fmt.Errorf("load existing nodes: %w", err)
		}
		for nodeRows.Next() {
			var nodeID int
			var locationID sql.NullInt64
			var questID sql.NullInt64
			var item existingNode
			var label sql.NullString
			if err := nodeRows.Scan(&nodeID, &locationID, &questID, &item.isStart, &item.posX, &item.posY, &label); err != nil {
				nodeRows.Close()
				return fmt.Errorf("scan existing nodes: %w", err)
			}
			if locationID.Valid {
				v := locationID.Int64
				item.locationID = &v
			}
			if questID.Valid {
				qid := int(questID.Int64)
				item.questID = &qid
			}
			if label.Valid {
				v := label.String
				item.label = &v
			}
			existingNodes[nodeID] = item
		}
		nodeRows.Close()

		clientToDB := map[int]int{}
		incomingNodeIDs := map[int]bool{}
		for _, n := range in.Nodes {
			if err := ensureNodeLocationHasExpeditionQuests(tx, *n.LocationID); err != nil {
				return err
			}
			n.QuestID = nil
			resolvedNodeID := 0
			if n.NodeID > 0 {
				res, err := tx.Exec(`
					UPDATE game.expedition_nodes
					SET location_id = $1,
						quest_id = $2,
						is_start = $3,
						pos_x = $4,
						pos_y = $5,
						label = $6,
						is_deleted = FALSE
					WHERE node_id = $7 AND expedition_id = $8
				`, n.LocationID, n.QuestID, n.IsStart, n.PosX, n.PosY, n.Label, n.NodeID, expeditionID)
				if err != nil {
					return fmt.Errorf("update node %d: %w", n.NodeID, err)
				}
				rows, _ := res.RowsAffected()
				if rows > 0 {
					resolvedNodeID = n.NodeID
				}
			}

			if resolvedNodeID == 0 {
				err := tx.QueryRow(`
					INSERT INTO game.expedition_nodes
						(expedition_id, location_id, quest_id, is_start, pos_x, pos_y, label, is_deleted)
					VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
					RETURNING node_id
				`, expeditionID, n.LocationID, n.QuestID, n.IsStart, n.PosX, n.PosY, n.Label).Scan(&resolvedNodeID)
				if err != nil {
					return fmt.Errorf("insert node: %w", err)
				}
			}

			clientToDB[n.ClientID] = resolvedNodeID
			incomingNodeIDs[resolvedNodeID] = true
			n.NodeID = resolvedNodeID
			outNodes = append(outNodes, n)
		}

		for nodeID := range existingNodes {
			if incomingNodeIDs[nodeID] {
				continue
			}
			if _, err := tx.Exec(`
				UPDATE game.expedition_nodes
				SET is_deleted = TRUE
				WHERE node_id = $1
			`, nodeID); err != nil {
				return fmt.Errorf("mark node deleted %d: %w", nodeID, err)
			}
		}

		type existingEdge struct {
			edgeID int
			nodeA  int
			nodeB  int
		}
		existingEdges := map[string]existingEdge{}
		edgeRows, err := tx.Query(`
			SELECT edge_id, node_a, node_b
			FROM game.expedition_edges
			WHERE expedition_id = $1 AND is_deleted = FALSE
		`, expeditionID)
		if err != nil {
			return fmt.Errorf("load existing edges: %w", err)
		}
		for edgeRows.Next() {
			var e existingEdge
			if err := edgeRows.Scan(&e.edgeID, &e.nodeA, &e.nodeB); err != nil {
				edgeRows.Close()
				return fmt.Errorf("scan existing edges: %w", err)
			}
			a, b := orderedNodePair(e.nodeA, e.nodeB)
			existingEdges[fmt.Sprintf("%d-%d", a, b)] = existingEdge{edgeID: e.edgeID, nodeA: a, nodeB: b}
		}
		edgeRows.Close()

		incomingEdgeKeys := map[string]bool{}
		for _, e := range in.Edges {
			a, okA := clientToDB[e.AClientID]
			b, okB := clientToDB[e.BClientID]
			if !okA || !okB || a == b {
				continue
			}
			a, b = orderedNodePair(a, b)
			key := fmt.Sprintf("%d-%d", a, b)
			if incomingEdgeKeys[key] {
				continue
			}
			incomingEdgeKeys[key] = true

			existing, exists := existingEdges[key]
			edgeID := 0
			if exists {
				if _, err := tx.Exec(`
					UPDATE game.expedition_edges
					SET is_deleted = FALSE
					WHERE edge_id = $1
				`, existing.edgeID); err != nil {
					return fmt.Errorf("update edge %d: %w", existing.edgeID, err)
				}
				edgeID = existing.edgeID
			} else {
				err := tx.QueryRow(`
					INSERT INTO game.expedition_edges
						(expedition_id, node_a, node_b, is_deleted)
					VALUES ($1, $2, $3, FALSE)
					RETURNING edge_id
				`, expeditionID, a, b).Scan(&edgeID)
				if err != nil {
					return fmt.Errorf("insert edge: %w", err)
				}
			}

			outEdges = append(outEdges, expeditionEdge{
				EdgeID: edgeID, NodeAID: a, NodeBID: b,
				AClientID: a, BClientID: b,
			})
		}

		for key, existing := range existingEdges {
			if incomingEdgeKeys[key] {
				continue
			}
			if _, err := tx.Exec(`
				UPDATE game.expedition_edges
				SET is_deleted = TRUE
				WHERE edge_id = $1
			`, existing.edgeID); err != nil {
				return fmt.Errorf("mark edge deleted %d: %w", existing.edgeID, err)
			}
		}
		return nil
	}); err != nil {
		log.Printf("saveExpedition: %v", err)
		if _, ok := err.(expeditionValidationError); ok {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
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
		Version:      saveVersion,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetExpeditionVersioned returns the versioned expedition graph delta used
// by game clients to reconstruct trees using quest ids and node positions.
// Query param: ?version=N (returns changes where version > N)
func handleGetExpeditionVersioned(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientVersion := 0
	if v := r.URL.Query().Get("version"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed >= 0 {
			clientVersion = parsed
		}
	}

	var payload []byte
	err := db.QueryRow(`SELECT public.download_expedition($1)`, clientVersion).Scan(&payload)
	if err != nil {
		log.Printf("getExpeditionVersioned: query failed: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(payload)
}

// handleGetQuestsLite: GET /api/getQuestsLite?settlementId=N
// Returns the minimal info needed to populate the node-quest picker.
func handleGetQuestsLite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	settlementIDStr := r.URL.Query().Get("settlementId")
	settlementID, err := strconv.Atoi(settlementIDStr)
	if err != nil || settlementID <= 0 {
		http.Error(w, "settlementId required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query(`SELECT quest_id, COALESCE(quest_name, ''), location_id, asset_id, COALESCE(expedition_quest, false)
		FROM game.quests WHERE settlement_id = $1 ORDER BY quest_name, quest_id`, settlementID)
	if err != nil {
		log.Printf("getQuestsLite: query: %v", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type liteQuest struct {
		QuestID         int    `json:"quest_id"`
		QuestName       string `json:"quest_name"`
		LocationID      *int64 `json:"location_id"`
		AssetID         *int   `json:"asset_id"`
		ExpeditionQuest bool   `json:"expedition_quest"`
	}
	out := []liteQuest{}
	for rows.Next() {
		var q liteQuest
		var locationID sql.NullInt64
		var assetID sql.NullInt64
		if err := rows.Scan(&q.QuestID, &q.QuestName, &locationID, &assetID, &q.ExpeditionQuest); err != nil {
			log.Printf("getQuestsLite: scan: %v", err)
			continue
		}
		if locationID.Valid {
			v := locationID.Int64
			q.LocationID = &v
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
