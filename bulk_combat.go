package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// ── Bulk combat: calibrate per-effect factor values for equal strength ──
//
// Phase loop:
//   1. Run a Swiss-style Elo tournament where each effect uses its current value.
//   2. Compute mean rating R̄. Adjust each effect's value:
//          v_i ← clamp(v_i + α_k · (R̄ - R_i) / sensitivity, vMin, vMax)
//      where α_k decays per phase to dampen oscillation.
//   3. Reset Elo, repeat.
//
// Final per-effect values are the calibrated factors that should yield
// approximately equal strength across all effects.

// BulkCombatBaseline is the shared stat profile used by both opponents
type BulkCombatBaseline struct {
	Strength  int `json:"strength"`
	Stamina   int `json:"stamina"`
	Agility   int `json:"agility"`
	Luck      int `json:"luck"`
	Armor     int `json:"armor"`
	MinDamage int `json:"minDamage"`
	MaxDamage int `json:"maxDamage"`
}

// BulkCombatConfig is persisted alongside each run as JSONB
type BulkCombatConfig struct {
	Baseline      BulkCombatBaseline `json:"baseline"`
	EffectValue   float64            `json:"effectValue"`
	FightsPerPair int                `json:"fightsPerPair"`
	Rounds        int                `json:"rounds"`
	Phases        int                `json:"phases"`
	ValueMin      float64            `json:"valueMin"`
	ValueMax      float64            `json:"valueMax"`
	EffectIDs     []int              `json:"effectIds"`
	IncludedNames map[int]string     `json:"includedNames"`
	StartedAt     time.Time          `json:"startedAt"`
}

// StartBulkRequest is the body for POST /api/startBulkCombat
type StartBulkRequest struct {
	Baseline      BulkCombatBaseline `json:"baseline"`
	EffectValue   float64            `json:"effectValue"`
	FightsPerPair int                `json:"fightsPerPair"`
	Rounds        int                `json:"rounds"`
	Phases        int                `json:"phases"`
	ValueMin      float64            `json:"valueMin"`
	ValueMax      float64            `json:"valueMax"`
	EffectIDs     []int              `json:"effectIds"` // empty = all effects
}

// PhaseSnapshot is the per-phase state of one effect
type PhaseSnapshot struct {
	Phase  int     `json:"phase"`
	Value  float64 `json:"value"`
	Rating float64 `json:"rating"`
	Wins   int     `json:"wins"`
	Losses int     `json:"losses"`
}

// BulkCombatResultRow is one effect's standing in a run
type BulkCombatResultRow struct {
	EffectID     int             `json:"effectId"`
	EffectName   string          `json:"effectName"`
	Rating       float64         `json:"rating"`
	CurrentValue float64         `json:"currentValue"`
	Wins         int             `json:"wins"`
	Losses       int             `json:"losses"`
	Rank         int             `json:"rank"`
	PhaseHistory []PhaseSnapshot `json:"phaseHistory,omitempty"`
}

// BulkCombatRun is a run summary
type BulkCombatRun struct {
	RunID            int64                 `json:"runId"`
	CreatedAt        time.Time             `json:"createdAt"`
	FinishedAt       *time.Time            `json:"finishedAt,omitempty"`
	Status           string                `json:"status"`
	TotalMatches     int                   `json:"totalMatches"`
	CompletedMatches int                   `json:"completedMatches"`
	Phases           int                   `json:"phases"`
	CurrentPhase     int                   `json:"currentPhase"`
	Config           BulkCombatConfig      `json:"config"`
	Results          []BulkCombatResultRow `json:"results,omitempty"`
}

// In-memory progress trackers keyed by runId for fast ETA without DB roundtrips
type bulkProgressTracker struct {
	completed    atomic.Int64
	total        int64
	currentPhase atomic.Int64
	startedAt    time.Time
}

var bulkProgressMap sync.Map // map[int64]*bulkProgressTracker

// ── Handlers ────────────────────────────────────────────────────────────────

func handleStartBulkCombat(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}

	var req StartBulkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.FightsPerPair <= 0 {
		req.FightsPerPair = 20
	}
	if req.FightsPerPair > 200 {
		req.FightsPerPair = 200
	}
	if req.Rounds <= 0 {
		req.Rounds = 6
	}
	if req.Rounds > 30 {
		req.Rounds = 30
	}
	if req.Phases <= 0 {
		req.Phases = 4
	}
	if req.Phases > 12 {
		req.Phases = 12
	}
	if req.EffectValue == 0 {
		req.EffectValue = 5
	}
	if req.ValueMin <= 0 {
		req.ValueMin = 1
	}
	if req.ValueMax <= req.ValueMin {
		req.ValueMax = 100
	}
	if req.Baseline.Stamina < 1 {
		req.Baseline.Stamina = 10
	}

	allEffects, err := getAllEffects()
	if err != nil {
		http.Error(w, "Failed to load effects: "+err.Error(), http.StatusInternalServerError)
		return
	}
	wanted := map[int]bool{}
	for _, id := range req.EffectIDs {
		wanted[id] = true
	}
	var participants []Effect
	names := map[int]string{}
	for _, e := range allEffects {
		if e.CoreEffectCode == nil || *e.CoreEffectCode == "" {
			continue
		}
		if len(wanted) > 0 && !wanted[e.ID] {
			continue
		}
		participants = append(participants, e)
		names[e.ID] = e.Name
	}
	if len(participants) < 2 {
		http.Error(w, "Need at least 2 effects with a coreEffectCode", http.StatusBadRequest)
		return
	}

	ids := make([]int, 0, len(participants))
	for _, e := range participants {
		ids = append(ids, e.ID)
	}

	cfg := BulkCombatConfig{
		Baseline:      req.Baseline,
		EffectValue:   req.EffectValue,
		FightsPerPair: req.FightsPerPair,
		Rounds:        req.Rounds,
		Phases:        req.Phases,
		ValueMin:      req.ValueMin,
		ValueMax:      req.ValueMax,
		EffectIDs:     ids,
		IncludedNames: names,
		StartedAt:     time.Now().UTC(),
	}
	cfgJSON, _ := json.Marshal(cfg)

	matchesPerPhase := req.Rounds * (len(participants) / 2)
	totalMatches := matchesPerPhase * req.Phases

	var runID int64
	err = db.QueryRow(`
		INSERT INTO tooling.bulk_combat_runs (status, config, total_matches, completed_matches, phases, current_phase)
		VALUES ('running', $1::jsonb, $2, 0, $3, 0)
		RETURNING run_id`,
		string(cfgJSON), totalMatches, req.Phases,
	).Scan(&runID)
	if err != nil {
		http.Error(w, "Failed to create run: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Seed result rows at rating 1000 and starting value
	for _, e := range participants {
		_, _ = db.Exec(`
			INSERT INTO tooling.bulk_combat_results (run_id, effect_id, rating, current_value)
			VALUES ($1, $2, 1000, $3) ON CONFLICT DO NOTHING`,
			runID, e.ID, req.EffectValue)
	}

	tracker := &bulkProgressTracker{total: int64(totalMatches), startedAt: time.Now()}
	bulkProgressMap.Store(runID, tracker)

	go runBulkCombatSimulation(runID, participants, cfg, tracker)

	log.Printf("🥊 Bulk calibration run %d started: %d effects × %d phases × %d rounds × %d fights/pair = %d matches",
		runID, len(participants), req.Phases, req.Rounds, req.FightsPerPair, totalMatches)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"runId":        runID,
		"totalMatches": totalMatches,
		"effectCount":  len(participants),
		"phases":       req.Phases,
	})
}

func handleGetBulkCombatRuns(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}
	rows, err := db.Query(`
		SELECT run_id, created_at, finished_at, status, config, total_matches, completed_matches,
		       phases, current_phase
		FROM tooling.bulk_combat_runs
		ORDER BY created_at DESC
		LIMIT 100`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []BulkCombatRun{}
	for rows.Next() {
		var run BulkCombatRun
		var finished sql.NullTime
		var cfgRaw []byte
		if err := rows.Scan(&run.RunID, &run.CreatedAt, &finished, &run.Status, &cfgRaw,
			&run.TotalMatches, &run.CompletedMatches, &run.Phases, &run.CurrentPhase); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if finished.Valid {
			t := finished.Time
			run.FinishedAt = &t
		}
		_ = json.Unmarshal(cfgRaw, &run.Config)
		if v, ok := bulkProgressMap.Load(run.RunID); ok {
			tr := v.(*bulkProgressTracker)
			run.CompletedMatches = int(tr.completed.Load())
			run.CurrentPhase = int(tr.currentPhase.Load())
		}
		out = append(out, run)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "runs": out})
}

func handleGetBulkCombatRun(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}
	idStr := r.URL.Query().Get("id")
	runID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}

	var run BulkCombatRun
	var finished sql.NullTime
	var cfgRaw []byte
	err = db.QueryRow(`
		SELECT run_id, created_at, finished_at, status, config, total_matches, completed_matches,
		       phases, current_phase
		FROM tooling.bulk_combat_runs WHERE run_id = $1`, runID,
	).Scan(&run.RunID, &run.CreatedAt, &finished, &run.Status, &cfgRaw,
		&run.TotalMatches, &run.CompletedMatches, &run.Phases, &run.CurrentPhase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if finished.Valid {
		t := finished.Time
		run.FinishedAt = &t
	}
	_ = json.Unmarshal(cfgRaw, &run.Config)

	if v, ok := bulkProgressMap.Load(runID); ok {
		tr := v.(*bulkProgressTracker)
		run.CompletedMatches = int(tr.completed.Load())
		run.CurrentPhase = int(tr.currentPhase.Load())
	}

	rows, err := db.Query(`
		SELECT effect_id, rating, current_value, wins, losses, COALESCE(rank, 0), phase_history
		FROM tooling.bulk_combat_results WHERE run_id = $1
		ORDER BY current_value ASC, rating DESC`, runID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rr BulkCombatResultRow
		var phaseRaw []byte
		if err := rows.Scan(&rr.EffectID, &rr.Rating, &rr.CurrentValue, &rr.Wins, &rr.Losses, &rr.Rank, &phaseRaw); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if name, ok := run.Config.IncludedNames[rr.EffectID]; ok {
			rr.EffectName = name
		}
		if len(phaseRaw) > 0 {
			_ = json.Unmarshal(phaseRaw, &rr.PhaseHistory)
		}
		run.Results = append(run.Results, rr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "run": run})
}

func handleDeleteBulkCombatRun(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		RunID int64 `json:"runId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}
	if _, err := db.Exec(`DELETE FROM tooling.bulk_combat_runs WHERE run_id = $1`, body.RunID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	bulkProgressMap.Delete(body.RunID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// ── Simulation ──────────────────────────────────────────────────────────────

type effectStanding struct {
	effect       Effect
	value        float64 // current calibrated value used in this phase
	rating       float64
	wins         int
	losses       int
	totalWins    int             // accumulated across phases
	totalLosses  int             // accumulated across phases
	phaseHistory []PhaseSnapshot // snapshots after each phase
}

func buildBulkCombatant(id int, baseline BulkCombatBaseline, e Effect, value float64) *CombatCharacter {
	core := ""
	if e.CoreEffectCode != nil {
		core = *e.CoreEffectCode
	}
	trigger := "passive"
	if e.TriggerType != nil && *e.TriggerType != "" {
		trigger = *e.TriggerType
	}
	factorType := "percent"
	if e.FactorType != nil && *e.FactorType != "" {
		factorType = *e.FactorType
	}
	targetSelf := false
	if e.TargetSelf != nil {
		targetSelf = *e.TargetSelf
	}
	return &CombatCharacter{
		CharacterID:   id,
		CharacterName: fmt.Sprintf("E%d", e.ID),
		Strength:      baseline.Strength,
		Stamina:       baseline.Stamina,
		Agility:       baseline.Agility,
		Luck:          baseline.Luck,
		Armor:         baseline.Armor,
		MinDamage:     baseline.MinDamage,
		MaxDamage:     baseline.MaxDamage,
		Effects: []CombatTestEffect{{
			EffectID:       1,
			CoreEffectCode: core,
			TriggerType:    trigger,
			FactorType:     factorType,
			TargetSelf:     targetSelf,
			ConditionType:  e.ConditionType,
			ConditionValue: e.ConditionValue,
			Duration:       e.Duration,
			Value:          int(math.Round(value)),
		}},
	}
}

// runMatch runs `fights` fights between two effects at their current values.
// Alternates first-strike side across fights to remove turn-order bias.
// Returns winsA, winsB (draws are impossible — any tie counts toward the
// player who acted first, mirroring engine behaviour).
func runMatch(a, b Effect, valA, valB float64, baseline BulkCombatBaseline, fights int) (int, int) {
	winsA, winsB := 0, 0
	for i := 0; i < fights; i++ {
		c1 := buildBulkCombatant(1, baseline, a, valA)
		c2 := buildBulkCombatant(2, baseline, b, valB)
		var result map[string]interface{}
		if i%2 == 0 {
			result = executeCombat(c1, c2)
		} else {
			result = executeCombat(c2, c1)
		}
		header, _ := result["header"].(map[string]interface{})
		winnerID, _ := header["winnerId"].(int)
		// CharacterID 1 = effect A, 2 = effect B regardless of strike order.
		if winnerID == 1 {
			winsA++
		} else {
			winsB++
		}
	}
	return winsA, winsB
}

// updateElo applies a single Elo update for a match between A and B.
// No draws — score is derived from wins.
func updateElo(rA, rB float64, winsA, winsB int, k float64) (float64, float64) {
	total := float64(winsA + winsB)
	if total <= 0 {
		return rA, rB
	}
	scoreA := float64(winsA) / total
	expected := 1.0 / (1.0 + math.Pow(10, (rB-rA)/400.0))
	delta := k * (scoreA - expected)
	return rA + delta, rB - delta
}

func runBulkCombatSimulation(runID int64, effects []Effect, cfg BulkCombatConfig, tracker *bulkProgressTracker) {
	defer bulkProgressMap.Delete(runID)
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("bulk_combat: run %d panicked: %v", runID, rec)
			if db != nil {
				_, _ = db.Exec(`UPDATE tooling.bulk_combat_runs SET status = 'failed', finished_at = NOW() WHERE run_id = $1`, runID)
			}
		}
	}()

	standings := make([]*effectStanding, 0, len(effects))
	for _, e := range effects {
		standings = append(standings, &effectStanding{effect: e, rating: 1000, value: cfg.EffectValue})
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	const k = 32.0

	// α (learning rate) decay schedule. Damps oscillation.
	alpha := []float64{1.0, 0.6, 0.35, 0.2, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01, 0.01}

	// Sensitivity: how many rating points correspond to one unit of value.
	// Empirical heuristic; conservative so we don't overshoot.
	const sensitivity = 50.0

	flushEvery := 4
	flushCounter := 0

	for phase := 0; phase < cfg.Phases; phase++ {
		tracker.currentPhase.Store(int64(phase + 1))

		// Reset per-phase ratings & wins so each phase produces a clean signal.
		for _, s := range standings {
			s.rating = 1000
			s.wins = 0
			s.losses = 0
		}

		for round := 0; round < cfg.Rounds; round++ {
			sort.Slice(standings, func(i, j int) bool {
				if standings[i].rating == standings[j].rating {
					return rng.Float64() < 0.5
				}
				return standings[i].rating > standings[j].rating
			})

			for i := 0; i+1 < len(standings); i += 2 {
				a := standings[i]
				b := standings[i+1]
				winsA, winsB := runMatch(a.effect, b.effect, a.value, b.value, cfg.Baseline, cfg.FightsPerPair)
				a.wins += winsA
				a.losses += winsB
				b.wins += winsB
				b.losses += winsA
				a.totalWins += winsA
				a.totalLosses += winsB
				b.totalWins += winsB
				b.totalLosses += winsA
				a.rating, b.rating = updateElo(a.rating, b.rating, winsA, winsB, k)

				tracker.completed.Add(1)
				flushCounter++
				if flushCounter >= flushEvery {
					flushCounter = 0
					flushBulkProgress(runID, standings, tracker)
				}
			}
		}

		// End of phase: snapshot, then adjust values.
		var meanRating float64
		for _, s := range standings {
			meanRating += s.rating
		}
		meanRating /= float64(len(standings))

		a := alpha[phase]
		if phase >= len(alpha) {
			a = alpha[len(alpha)-1]
		}

		for _, s := range standings {
			s.phaseHistory = append(s.phaseHistory, PhaseSnapshot{
				Phase:  phase + 1,
				Value:  s.value,
				Rating: s.rating,
				Wins:   s.wins,
				Losses: s.losses,
			})
			// Skip adjustment on the last phase — we want the final readings unchanged.
			if phase == cfg.Phases-1 {
				continue
			}
			delta := a * (meanRating - s.rating) / sensitivity
			newVal := s.value + delta
			if newVal < cfg.ValueMin {
				newVal = cfg.ValueMin
			}
			if newVal > cfg.ValueMax {
				newVal = cfg.ValueMax
			}
			s.value = newVal
		}

		// Persist phase progress.
		_, _ = db.Exec(`UPDATE tooling.bulk_combat_runs SET current_phase = $1 WHERE run_id = $2`,
			phase+1, runID)
		flushBulkProgress(runID, standings, tracker)

		log.Printf("bulk_combat: run %d finished phase %d/%d (mean rating=%.1f)",
			runID, phase+1, cfg.Phases, meanRating)
	}

	// Rank by calibrated value (lowest = strongest baseline; effects that need less factor to compete).
	sort.Slice(standings, func(i, j int) bool {
		if standings[i].value == standings[j].value {
			return standings[i].rating > standings[j].rating
		}
		return standings[i].value < standings[j].value
	})
	for idx, s := range standings {
		hist, _ := json.Marshal(s.phaseHistory)
		_, err := db.Exec(`
			UPDATE tooling.bulk_combat_results
			SET rating = $1, current_value = $2, wins = $3, losses = $4, rank = $5, phase_history = $6::jsonb
			WHERE run_id = $7 AND effect_id = $8`,
			s.rating, s.value, s.totalWins, s.totalLosses, idx+1, string(hist), runID, s.effect.ID)
		if err != nil {
			log.Printf("bulk_combat: failed to write final result for effect %d: %v", s.effect.ID, err)
		}
	}

	_, err := db.Exec(`
		UPDATE tooling.bulk_combat_runs
		SET status = 'finished', finished_at = NOW(), completed_matches = total_matches
		WHERE run_id = $1`, runID)
	if err != nil {
		log.Printf("bulk_combat: failed to finalize run %d: %v", runID, err)
	}

	dur := time.Since(tracker.startedAt)
	log.Printf("🥊 Bulk calibration run %d finished in %s", runID, dur)
}

func flushBulkProgress(runID int64, standings []*effectStanding, tracker *bulkProgressTracker) {
	if db == nil {
		return
	}
	completed := int(tracker.completed.Load())
	_, _ = db.Exec(`UPDATE tooling.bulk_combat_runs SET completed_matches = $1 WHERE run_id = $2`, completed, runID)
	for _, s := range standings {
		_, _ = db.Exec(`
			UPDATE tooling.bulk_combat_results
			SET rating = $1, current_value = $2, wins = $3, losses = $4
			WHERE run_id = $5 AND effect_id = $6`,
			s.rating, s.value, s.totalWins, s.totalLosses, runID, s.effect.ID)
	}
}
