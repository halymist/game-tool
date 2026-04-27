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

// ============================================================================
// BUILDS — full-build (stats + ordered talents/perks) tester.
//
// Each build encodes a 70-day career: stats are scaled at 2 % / day
// (compounding, rounded each day) and one talent point is consumed per day in
// `talent_order`, perks activate the day a perk-slot talent reaches max.
//
// At a series of milestones (default: days 1, 10, 20, …, 70) we run a full
// Swiss + Elo tournament across every build to produce per-milestone
// rankings — so we can read early-game vs late-game strength independently.
// ============================================================================

// ── Types ───────────────────────────────────────────────────────────────────

// Build is a stored player build (stats + talents).
type Build struct {
	BuildID     int64         `json:"buildId"`
	BuildName   string        `json:"buildName"`
	Description *string       `json:"description,omitempty"`
	Strength    int           `json:"strength"`
	Stamina     int           `json:"stamina"`
	Agility     int           `json:"agility"`
	Luck        int           `json:"luck"`
	Armor       int           `json:"armor"`
	MinDamage   int           `json:"minDamage"`
	MaxDamage   int           `json:"maxDamage"`
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt"`
	Talents     []BuildTalent `json:"talents"`
}

// BuildTalent mirrors EnemyTalent (talent_id + points + order + optional perk).
type BuildTalent struct {
	TalentID    int  `json:"talentId"`
	Points      int  `json:"points"`
	TalentOrder int  `json:"talentOrder"`
	PerkID      *int `json:"perkId,omitempty"`
}

// BuildRunConfig is persisted in tooling.build_runs.config.
type BuildRunConfig struct {
	Milestones    []int            `json:"milestones"`    // days at which to rank, e.g. [1,10,...,70]
	Rounds        int              `json:"rounds"`        // Swiss rounds per milestone
	FightsPerPair int              `json:"fightsPerPair"` // fights per pairing
	BuildIDs      []int64          `json:"buildIds"`      // builds participating
	BuildNames    map[int64]string `json:"buildNames"`
	StartedAt     time.Time        `json:"startedAt"`
}

// StartBuildRunRequest is the body for POST /api/startBuildRun.
type StartBuildRunRequest struct {
	Milestones    []int   `json:"milestones,omitempty"`
	Rounds        int     `json:"rounds,omitempty"`
	FightsPerPair int     `json:"fightsPerPair,omitempty"`
	BuildIDs      []int64 `json:"buildIds,omitempty"` // empty = all
}

// BuildResultRow is one (build, milestone) result.
type BuildResultRow struct {
	BuildID      int64   `json:"buildId"`
	BuildName    string  `json:"buildName"`
	MilestoneDay int     `json:"milestoneDay"`
	Rating       float64 `json:"rating"`
	Wins         int     `json:"wins"`
	Losses       int     `json:"losses"`
	Rank         int     `json:"rank"`
}

// BuildRun is the full run for the rankings UI.
type BuildRun struct {
	RunID            int64            `json:"runId"`
	CreatedAt        time.Time        `json:"createdAt"`
	FinishedAt       *time.Time       `json:"finishedAt,omitempty"`
	Status           string           `json:"status"`
	TotalMatches     int              `json:"totalMatches"`
	CompletedMatches int              `json:"completedMatches"`
	CurrentMilestone int              `json:"currentMilestone"`
	Config           BuildRunConfig   `json:"config"`
	Results          []BuildResultRow `json:"results,omitempty"`
}

// In-memory progress trackers
type buildProgressTracker struct {
	completed        atomic.Int64
	total            int64
	currentMilestone atomic.Int64
	startedAt        time.Time
}

var buildProgressMap sync.Map // map[int64]*buildProgressTracker

// ── Day-N snapshot ──────────────────────────────────────────────────────────

// scaleStat applies +2 %/day compounding, rounded each day (matches the
// in-game tick where the rounded value carries to the next day).
func scaleStat(base, day int) int {
	if day <= 0 {
		return base
	}
	v := float64(base)
	for i := 0; i < day; i++ {
		v = math.Round(v * 1.02)
	}
	return int(v)
}

// snapshotBuild produces the CombatCharacter the build represents on `day`.
// Talents are consumed in talent_order, one point per day. A perk attached
// to a perk-slot talent activates the day that talent reaches its maxPoints.
func snapshotBuild(
	charID int,
	b *Build,
	day int,
	talents map[int]TalentInfo,
	effects map[int]Effect,
	perks map[int]Perk,
) *CombatCharacter {

	c := &CombatCharacter{
		CharacterID:   charID,
		CharacterName: b.BuildName,
		Strength:      scaleStat(b.Strength, day),
		Stamina:       scaleStat(b.Stamina, day),
		Agility:       scaleStat(b.Agility, day),
		Luck:          scaleStat(b.Luck, day),
		Armor:         scaleStat(b.Armor, day),
		MinDamage:     scaleStat(b.MinDamage, day),
		MaxDamage:     scaleStat(b.MaxDamage, day),
	}
	if c.Stamina < 1 {
		c.Stamina = 1
	}

	// Sort talents by talent_order so the daily sequence is deterministic.
	ordered := make([]BuildTalent, len(b.Talents))
	copy(ordered, b.Talents)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].TalentOrder < ordered[j].TalentOrder
	})

	// Day 1 = first point spent. Cap by total available points.
	pointsAvailable := day
	effectIdSeq := 1

	for _, bt := range ordered {
		if pointsAvailable <= 0 {
			break
		}
		spent := bt.Points
		if spent > pointsAvailable {
			spent = pointsAvailable
		}
		pointsAvailable -= spent

		t, ok := talents[bt.TalentID]
		if !ok {
			continue
		}

		// Talent's own effect (passive scaling): value = factor × spent.
		if t.EffectID != nil && t.Factor != nil {
			if e, ok := effects[*t.EffectID]; ok {
				c.Effects = append(c.Effects, effectFromTemplate(effectIdSeq, e, *t.Factor*spent))
				effectIdSeq++
			}
		}

		// Perk activates only when the slot talent is fully maxed.
		isPerkSlot := t.PerkSlot != nil && *t.PerkSlot
		if isPerkSlot && bt.PerkID != nil && spent >= t.MaxPoints {
			if p, ok := perks[*bt.PerkID]; ok {
				if p.Effect1ID != nil && p.Factor1 != nil {
					if e, ok := effects[*p.Effect1ID]; ok {
						c.Effects = append(c.Effects, effectFromTemplate(effectIdSeq, e, *p.Factor1))
						effectIdSeq++
					}
				}
				if p.Effect2ID != nil && p.Factor2 != nil {
					if e, ok := effects[*p.Effect2ID]; ok {
						c.Effects = append(c.Effects, effectFromTemplate(effectIdSeq, e, *p.Factor2))
						effectIdSeq++
					}
				}
			}
		}
	}

	return c
}

// effectFromTemplate clones a DB Effect into a CombatTestEffect with the
// computed value. Mirrors `tool/combat-tester.js#resolveTalentEffects`.
func effectFromTemplate(id int, e Effect, value int) CombatTestEffect {
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
	return CombatTestEffect{
		EffectID:       id,
		CoreEffectCode: core,
		TriggerType:    trigger,
		FactorType:     factorType,
		TargetSelf:     targetSelf,
		ConditionType:  e.ConditionType,
		ConditionValue: e.ConditionValue,
		Duration:       e.Duration,
		Value:          value,
	}
}

// ── CRUD: builds ────────────────────────────────────────────────────────────

// SaveBuildRequest is the body for POST /api/saveBuild.
type SaveBuildRequest struct {
	BuildID     *int64        `json:"buildId,omitempty"` // nil = create
	BuildName   string        `json:"buildName"`
	Description *string       `json:"description,omitempty"`
	Strength    int           `json:"strength"`
	Stamina     int           `json:"stamina"`
	Agility     int           `json:"agility"`
	Luck        int           `json:"luck"`
	Armor       int           `json:"armor"`
	MinDamage   int           `json:"minDamage"`
	MaxDamage   int           `json:"maxDamage"`
	Talents     []BuildTalent `json:"talents"`
}

func handleSaveBuild(w http.ResponseWriter, r *http.Request) {
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
	var req SaveBuildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.BuildName == "" {
		http.Error(w, "buildName required", http.StatusBadRequest)
		return
	}
	if req.Stamina < 1 {
		req.Stamina = 1
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var buildID int64
	if req.BuildID != nil {
		buildID = *req.BuildID
		_, err = tx.Exec(`
			UPDATE tooling.builds
			SET build_name=$1, description=$2, strength=$3, stamina=$4, agility=$5,
			    luck=$6, armor=$7, min_damage=$8, max_damage=$9, updated_at=NOW()
			WHERE build_id=$10`,
			req.BuildName, req.Description, req.Strength, req.Stamina, req.Agility,
			req.Luck, req.Armor, req.MinDamage, req.MaxDamage, buildID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`DELETE FROM tooling.build_talents WHERE build_id=$1`, buildID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		err = tx.QueryRow(`
			INSERT INTO tooling.builds
			  (build_name, description, strength, stamina, agility, luck, armor, min_damage, max_damage)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING build_id`,
			req.BuildName, req.Description, req.Strength, req.Stamina, req.Agility,
			req.Luck, req.Armor, req.MinDamage, req.MaxDamage,
		).Scan(&buildID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	for _, bt := range req.Talents {
		if bt.Points < 1 {
			continue
		}
		_, err = tx.Exec(`
			INSERT INTO tooling.build_talents (build_id, talent_id, points, talent_order, perk_id)
			VALUES ($1,$2,$3,$4,$5)`,
			buildID, bt.TalentID, bt.Points, bt.TalentOrder, bt.PerkID)
		if err != nil {
			http.Error(w, "talent insert: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "buildId": buildID})
}

func handleGetBuilds(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}
	builds, err := loadAllBuilds()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "builds": builds})
}

func handleGetBuild(w http.ResponseWriter, r *http.Request) {
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if db == nil {
		http.Error(w, "Database not available", http.StatusServiceUnavailable)
		return
	}
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}
	b, err := loadBuild(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "build": b})
}

func handleDeleteBuild(w http.ResponseWriter, r *http.Request) {
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
		BuildID int64 `json:"buildId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}
	if _, err := db.Exec(`DELETE FROM tooling.builds WHERE build_id=$1`, body.BuildID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// ── DB loaders ──────────────────────────────────────────────────────────────

func loadAllBuilds() ([]Build, error) {
	rows, err := db.Query(`
		SELECT build_id, build_name, description, strength, stamina, agility,
		       luck, armor, min_damage, max_damage, created_at, updated_at
		FROM tooling.builds
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var builds []Build
	idMap := map[int64]int{}
	for rows.Next() {
		var b Build
		if err := rows.Scan(&b.BuildID, &b.BuildName, &b.Description, &b.Strength, &b.Stamina,
			&b.Agility, &b.Luck, &b.Armor, &b.MinDamage, &b.MaxDamage,
			&b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		idMap[b.BuildID] = len(builds)
		builds = append(builds, b)
	}
	if len(builds) == 0 {
		return builds, nil
	}

	// Pull all talents in a single query.
	tRows, err := db.Query(`
		SELECT build_id, talent_id, points, talent_order, perk_id
		FROM tooling.build_talents
		ORDER BY build_id, talent_order`)
	if err != nil {
		return nil, err
	}
	defer tRows.Close()
	for tRows.Next() {
		var buildID int64
		var bt BuildTalent
		if err := tRows.Scan(&buildID, &bt.TalentID, &bt.Points, &bt.TalentOrder, &bt.PerkID); err != nil {
			return nil, err
		}
		if i, ok := idMap[buildID]; ok {
			builds[i].Talents = append(builds[i].Talents, bt)
		}
	}
	return builds, nil
}

func loadBuild(id int64) (*Build, error) {
	var b Build
	err := db.QueryRow(`
		SELECT build_id, build_name, description, strength, stamina, agility,
		       luck, armor, min_damage, max_damage, created_at, updated_at
		FROM tooling.builds WHERE build_id=$1`, id,
	).Scan(&b.BuildID, &b.BuildName, &b.Description, &b.Strength, &b.Stamina,
		&b.Agility, &b.Luck, &b.Armor, &b.MinDamage, &b.MaxDamage,
		&b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`
		SELECT talent_id, points, talent_order, perk_id
		FROM tooling.build_talents WHERE build_id=$1
		ORDER BY talent_order`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var bt BuildTalent
		if err := rows.Scan(&bt.TalentID, &bt.Points, &bt.TalentOrder, &bt.PerkID); err != nil {
			return nil, err
		}
		b.Talents = append(b.Talents, bt)
	}
	return &b, nil
}

// loadBuildLookups fetches talents/effects/perks once and indexes them by ID.
func loadBuildLookups() (map[int]TalentInfo, map[int]Effect, map[int]Perk, error) {
	talents, err := getAllTalentsInfo()
	if err != nil {
		return nil, nil, nil, err
	}
	effects, err := getAllEffects()
	if err != nil {
		return nil, nil, nil, err
	}
	perks, err := getAllPerks()
	if err != nil {
		return nil, nil, nil, err
	}
	tMap := make(map[int]TalentInfo, len(talents))
	for _, t := range talents {
		tMap[t.TalentID] = t
	}
	eMap := make(map[int]Effect, len(effects))
	for _, e := range effects {
		eMap[e.ID] = e
	}
	pMap := make(map[int]Perk, len(perks))
	for _, p := range perks {
		pMap[p.ID] = p
	}
	return tMap, eMap, pMap, nil
}

// ── Tournament runner ───────────────────────────────────────────────────────

func handleStartBuildRun(w http.ResponseWriter, r *http.Request) {
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

	var req StartBuildRunRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if len(req.Milestones) == 0 {
		req.Milestones = []int{1, 10, 20, 30, 40, 50, 60, 70}
	}
	if req.Rounds <= 0 {
		req.Rounds = 6
	}
	if req.Rounds > 30 {
		req.Rounds = 30
	}
	if req.FightsPerPair <= 0 {
		req.FightsPerPair = 20
	}
	if req.FightsPerPair > 200 {
		req.FightsPerPair = 200
	}

	allBuilds, err := loadAllBuilds()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	wanted := map[int64]bool{}
	for _, id := range req.BuildIDs {
		wanted[id] = true
	}
	var participants []Build
	names := map[int64]string{}
	for _, b := range allBuilds {
		if len(wanted) > 0 && !wanted[b.BuildID] {
			continue
		}
		participants = append(participants, b)
		names[b.BuildID] = b.BuildName
	}
	if len(participants) < 2 {
		http.Error(w, "Need at least 2 builds", http.StatusBadRequest)
		return
	}

	ids := make([]int64, 0, len(participants))
	for _, b := range participants {
		ids = append(ids, b.BuildID)
	}

	cfg := BuildRunConfig{
		Milestones:    req.Milestones,
		Rounds:        req.Rounds,
		FightsPerPair: req.FightsPerPair,
		BuildIDs:      ids,
		BuildNames:    names,
		StartedAt:     time.Now().UTC(),
	}
	cfgJSON, _ := json.Marshal(cfg)

	matchesPerMilestone := req.Rounds * (len(participants) / 2)
	totalMatches := matchesPerMilestone * len(req.Milestones)

	var runID int64
	err = db.QueryRow(`
		INSERT INTO tooling.build_runs (status, config, total_matches, completed_matches, current_milestone)
		VALUES ('running', $1::jsonb, $2, 0, 0)
		RETURNING run_id`,
		string(cfgJSON), totalMatches,
	).Scan(&runID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Seed result rows for every (build, milestone) at rating 1000.
	for _, b := range participants {
		for _, m := range req.Milestones {
			_, _ = db.Exec(`
				INSERT INTO tooling.build_results (run_id, build_id, milestone_day, rating)
				VALUES ($1,$2,$3,1000) ON CONFLICT DO NOTHING`,
				runID, b.BuildID, m)
		}
	}

	tracker := &buildProgressTracker{total: int64(totalMatches), startedAt: time.Now()}
	buildProgressMap.Store(runID, tracker)

	go runBuildTournament(runID, participants, cfg, tracker)

	log.Printf("🛡 Build tournament %d started: %d builds × %d milestones × %d rounds × %d fights = %d matches",
		runID, len(participants), len(req.Milestones), req.Rounds, req.FightsPerPair, totalMatches)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"runId":        runID,
		"totalMatches": totalMatches,
		"buildCount":   len(participants),
		"milestones":   req.Milestones,
	})
}

type buildStanding struct {
	build     Build
	character *CombatCharacter // snapshot at this milestone
	rating    float64
	wins      int
	losses    int
}

func runBuildTournament(runID int64, builds []Build, cfg BuildRunConfig, tracker *buildProgressTracker) {
	defer buildProgressMap.Delete(runID)
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("build_tournament: run %d panicked: %v", runID, rec)
			if db != nil {
				_, _ = db.Exec(`UPDATE tooling.build_runs SET status='failed', finished_at=NOW() WHERE run_id=$1`, runID)
			}
		}
	}()

	talents, effects, perks, err := loadBuildLookups()
	if err != nil {
		log.Printf("build_tournament: lookup load failed: %v", err)
		_, _ = db.Exec(`UPDATE tooling.build_runs SET status='failed', finished_at=NOW() WHERE run_id=$1`, runID)
		return
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	const k = 32.0
	flushEvery := 4

	for mIdx, day := range cfg.Milestones {
		tracker.currentMilestone.Store(int64(day))

		// Build standings + per-day snapshot.
		standings := make([]*buildStanding, 0, len(builds))
		for _, b := range builds {
			bb := b
			st := &buildStanding{build: bb, rating: 1000}
			st.character = snapshotBuild(int(bb.BuildID), &bb, day, talents, effects, perks)
			standings = append(standings, st)
		}

		flushCounter := 0
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
				winsA, winsB := runBuildMatch(a.character, b.character, cfg.FightsPerPair)
				a.wins += winsA
				a.losses += winsB
				b.wins += winsB
				b.losses += winsA
				a.rating, b.rating = updateElo(a.rating, b.rating, winsA, winsB, k)

				tracker.completed.Add(1)
				flushCounter++
				if flushCounter >= flushEvery {
					flushCounter = 0
					flushBuildProgress(runID, day, standings, tracker)
				}
			}
		}

		// Final ranking for this milestone.
		sort.Slice(standings, func(i, j int) bool {
			return standings[i].rating > standings[j].rating
		})
		for idx, s := range standings {
			_, err := db.Exec(`
				UPDATE tooling.build_results
				SET rating=$1, wins=$2, losses=$3, rank=$4
				WHERE run_id=$5 AND build_id=$6 AND milestone_day=$7`,
				s.rating, s.wins, s.losses, idx+1, runID, s.build.BuildID, day)
			if err != nil {
				log.Printf("build_tournament: result write failed (build=%d day=%d): %v", s.build.BuildID, day, err)
			}
		}

		_, _ = db.Exec(`UPDATE tooling.build_runs SET current_milestone=$1, completed_matches=$2 WHERE run_id=$3`,
			day, int(tracker.completed.Load()), runID)
		log.Printf("🛡 Build tournament %d: milestone %d/%d (day %d) complete",
			runID, mIdx+1, len(cfg.Milestones), day)
	}

	_, err = db.Exec(`
		UPDATE tooling.build_runs
		SET status='finished', finished_at=NOW(), completed_matches=total_matches
		WHERE run_id=$1`, runID)
	if err != nil {
		log.Printf("build_tournament: finalize failed: %v", err)
	}
	log.Printf("🛡 Build tournament %d finished in %s", runID, time.Since(tracker.startedAt))
}

// runBuildMatch is identical in spirit to runMatch but takes pre-built
// CombatCharacters (so we don't re-snapshot for every fight).
func runBuildMatch(a, b *CombatCharacter, fights int) (int, int) {
	winsA, winsB := 0, 0
	for i := 0; i < fights; i++ {
		// Fresh copies — executeCombat mutates DepletedHealth and effect state.
		c1 := cloneCombatant(1, a)
		c2 := cloneCombatant(2, b)
		var result map[string]interface{}
		if i%2 == 0 {
			result = executeCombat(c1, c2)
		} else {
			result = executeCombat(c2, c1)
		}
		header, _ := result["header"].(map[string]interface{})
		winnerID, _ := header["winnerId"].(int)
		if winnerID == 1 {
			winsA++
		} else {
			winsB++
		}
	}
	return winsA, winsB
}

func cloneCombatant(id int, src *CombatCharacter) *CombatCharacter {
	effects := make([]CombatTestEffect, len(src.Effects))
	copy(effects, src.Effects)
	return &CombatCharacter{
		CharacterID:   id,
		CharacterName: src.CharacterName,
		Strength:      src.Strength,
		Stamina:       src.Stamina,
		Agility:       src.Agility,
		Luck:          src.Luck,
		Armor:         src.Armor,
		MinDamage:     src.MinDamage,
		MaxDamage:     src.MaxDamage,
		Effects:       effects,
	}
}

func flushBuildProgress(runID int64, day int, standings []*buildStanding, tracker *buildProgressTracker) {
	if db == nil {
		return
	}
	_, _ = db.Exec(`UPDATE tooling.build_runs SET completed_matches=$1 WHERE run_id=$2`,
		int(tracker.completed.Load()), runID)
	for _, s := range standings {
		_, _ = db.Exec(`
			UPDATE tooling.build_results
			SET rating=$1, wins=$2, losses=$3
			WHERE run_id=$4 AND build_id=$5 AND milestone_day=$6`,
			s.rating, s.wins, s.losses, runID, s.build.BuildID, day)
	}
}

// ── Run query handlers ──────────────────────────────────────────────────────

func handleGetBuildRuns(w http.ResponseWriter, r *http.Request) {
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
		       current_milestone
		FROM tooling.build_runs
		ORDER BY created_at DESC
		LIMIT 100`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []BuildRun{}
	for rows.Next() {
		var run BuildRun
		var finished sql.NullTime
		var cfgRaw []byte
		if err := rows.Scan(&run.RunID, &run.CreatedAt, &finished, &run.Status, &cfgRaw,
			&run.TotalMatches, &run.CompletedMatches, &run.CurrentMilestone); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if finished.Valid {
			t := finished.Time
			run.FinishedAt = &t
		}
		_ = json.Unmarshal(cfgRaw, &run.Config)
		if v, ok := buildProgressMap.Load(run.RunID); ok {
			tr := v.(*buildProgressTracker)
			run.CompletedMatches = int(tr.completed.Load())
			run.CurrentMilestone = int(tr.currentMilestone.Load())
		}
		out = append(out, run)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "runs": out})
}

func handleGetBuildRun(w http.ResponseWriter, r *http.Request) {
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

	var run BuildRun
	var finished sql.NullTime
	var cfgRaw []byte
	err = db.QueryRow(`
		SELECT run_id, created_at, finished_at, status, config, total_matches, completed_matches,
		       current_milestone
		FROM tooling.build_runs WHERE run_id=$1`, runID,
	).Scan(&run.RunID, &run.CreatedAt, &finished, &run.Status, &cfgRaw,
		&run.TotalMatches, &run.CompletedMatches, &run.CurrentMilestone)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if finished.Valid {
		t := finished.Time
		run.FinishedAt = &t
	}
	_ = json.Unmarshal(cfgRaw, &run.Config)

	if v, ok := buildProgressMap.Load(runID); ok {
		tr := v.(*buildProgressTracker)
		run.CompletedMatches = int(tr.completed.Load())
		run.CurrentMilestone = int(tr.currentMilestone.Load())
	}

	rows, err := db.Query(`
		SELECT build_id, milestone_day, rating, wins, losses, COALESCE(rank, 0)
		FROM tooling.build_results
		WHERE run_id=$1
		ORDER BY milestone_day ASC, rank ASC`, runID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rr BuildResultRow
		if err := rows.Scan(&rr.BuildID, &rr.MilestoneDay, &rr.Rating, &rr.Wins, &rr.Losses, &rr.Rank); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if name, ok := run.Config.BuildNames[rr.BuildID]; ok {
			rr.BuildName = name
		}
		run.Results = append(run.Results, rr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "run": run})
}

func handleDeleteBuildRun(w http.ResponseWriter, r *http.Request) {
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
	if _, err := db.Exec(`DELETE FROM tooling.build_runs WHERE run_id=$1`, body.RunID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	buildProgressMap.Delete(body.RunID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// ── Incremental: add one build to an existing finished run ─────────────────

// AddBuildToRunRequest is the body for POST /api/addBuildToRun.
type AddBuildToRunRequest struct {
	RunID   int64 `json:"runId"`
	BuildID int64 `json:"buildId"`
}

func handleAddBuildToRun(w http.ResponseWriter, r *http.Request) {
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
	var body AddBuildToRunRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}

	var status string
	var cfgRaw []byte
	err := db.QueryRow(`SELECT status, config FROM tooling.build_runs WHERE run_id=$1`, body.RunID).
		Scan(&status, &cfgRaw)
	if err != nil {
		http.Error(w, "run not found", http.StatusNotFound)
		return
	}
	if status != "finished" {
		http.Error(w, "run must be finished before adding builds", http.StatusBadRequest)
		return
	}
	var cfg BuildRunConfig
	_ = json.Unmarshal(cfgRaw, &cfg)

	// Skip if already part of the run.
	for _, id := range cfg.BuildIDs {
		if id == body.BuildID {
			http.Error(w, "build already in run", http.StatusBadRequest)
			return
		}
	}

	newBuild, err := loadBuild(body.BuildID)
	if err != nil {
		http.Error(w, "build not found", http.StatusNotFound)
		return
	}
	existing, err := loadAllBuilds()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	existingByID := map[int64]Build{}
	for _, b := range existing {
		existingByID[b.BuildID] = b
	}

	talents, effects, perks, err := loadBuildLookups()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Mark run running while we add.
	_, _ = db.Exec(`UPDATE tooling.build_runs SET status='running', finished_at=NULL WHERE run_id=$1`, body.RunID)

	go func() {
		const k = 32.0
		for _, day := range cfg.Milestones {
			newChar := snapshotBuild(int(newBuild.BuildID), newBuild, day, talents, effects, perks)
			// Seed new build's row at 1000.
			_, _ = db.Exec(`
				INSERT INTO tooling.build_results (run_id, build_id, milestone_day, rating)
				VALUES ($1,$2,$3,1000) ON CONFLICT DO NOTHING`,
				body.RunID, newBuild.BuildID, day)

			var newRating float64
			_ = db.QueryRow(`
				SELECT rating FROM tooling.build_results
				WHERE run_id=$1 AND build_id=$2 AND milestone_day=$3`,
				body.RunID, newBuild.BuildID, day).Scan(&newRating)
			if newRating == 0 {
				newRating = 1000
			}
			newWins, newLosses := 0, 0

			for _, opp := range existing {
				if opp.BuildID == newBuild.BuildID {
					continue
				}
				oppChar := snapshotBuild(int(opp.BuildID), &opp, day, talents, effects, perks)

				var oppRating float64
				var oppWins, oppLosses int
				_ = db.QueryRow(`
					SELECT rating, wins, losses FROM tooling.build_results
					WHERE run_id=$1 AND build_id=$2 AND milestone_day=$3`,
					body.RunID, opp.BuildID, day).Scan(&oppRating, &oppWins, &oppLosses)
				if oppRating == 0 {
					oppRating = 1000
				}

				wA, wB := runBuildMatch(newChar, oppChar, cfg.FightsPerPair)
				newRating, oppRating = updateElo(newRating, oppRating, wA, wB, k)
				newWins += wA
				newLosses += wB
				oppWins += wB
				oppLosses += wA

				_, _ = db.Exec(`
					UPDATE tooling.build_results
					SET rating=$1, wins=$2, losses=$3
					WHERE run_id=$4 AND build_id=$5 AND milestone_day=$6`,
					oppRating, oppWins, oppLosses, body.RunID, opp.BuildID, day)
			}

			_, _ = db.Exec(`
				UPDATE tooling.build_results
				SET rating=$1, wins=$2, losses=$3
				WHERE run_id=$4 AND build_id=$5 AND milestone_day=$6`,
				newRating, newWins, newLosses, body.RunID, newBuild.BuildID, day)

			// Re-rank this milestone.
			rerankMilestone(body.RunID, day)
		}

		// Append new build to config.BuildIDs / BuildNames
		cfg.BuildIDs = append(cfg.BuildIDs, newBuild.BuildID)
		if cfg.BuildNames == nil {
			cfg.BuildNames = map[int64]string{}
		}
		cfg.BuildNames[newBuild.BuildID] = newBuild.BuildName
		newCfg, _ := json.Marshal(cfg)
		_, _ = db.Exec(`
			UPDATE tooling.build_runs SET status='finished', finished_at=NOW(), config=$1::jsonb
			WHERE run_id=$2`, string(newCfg), body.RunID)
		log.Printf("🛡 Build %d added to run %d", body.BuildID, body.RunID)
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func rerankMilestone(runID int64, day int) {
	rows, err := db.Query(`
		SELECT id FROM tooling.build_results
		WHERE run_id=$1 AND milestone_day=$2
		ORDER BY rating DESC`, runID, day)
	if err != nil {
		return
	}
	defer rows.Close()
	type rk struct {
		id   int64
		rank int
	}
	var rks []rk
	i := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return
		}
		i++
		rks = append(rks, rk{id: id, rank: i})
	}
	for _, r := range rks {
		_, _ = db.Exec(`UPDATE tooling.build_results SET rank=$1 WHERE id=$2`, r.rank, r.id)
	}
}

// silence unused-import warnings if any path is removed in future refactors
var _ = fmt.Sprintf
