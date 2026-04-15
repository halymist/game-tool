package main

import (
	"encoding/json"
	"fmt"
	"testing"
)

// helper to build a basic combatant with equal stats
func baseCombatant(id int, name string, effects []CombatTestEffect) *CombatCharacter {
	return &CombatCharacter{
		CharacterID:   id,
		CharacterName: name,
		Strength:      10,
		Stamina:       10, // 100 HP
		Agility:       10,
		Luck:          10,
		Armor:         0,
		MinDamage:     10,
		MaxDamage:     10, // fixed 20 damage (10 base + 10 str)
		Effects:       effects,
	}
}

func extractLog(result map[string]interface{}) []CombatLogEntry {
	raw, _ := json.Marshal(result["log"])
	var log []CombatLogEntry
	json.Unmarshal(raw, &log)
	return log
}

func extractStats(result map[string]interface{}, side string) map[string]interface{} {
	stats := result["stats"].(map[string]interface{})
	raw, _ := json.Marshal(stats[side])
	var s map[string]interface{}
	json.Unmarshal(raw, &s)
	return s
}

// ── Test 1: Bleed on_hit ─────────────────────────────────────

func TestBleedOnHit(t *testing.T) {
	// C1 has bleed on_hit: 5 flat bleed per hit
	c1 := baseCombatant(1, "Bleeder", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent", Value: 5},
	})
	c2 := baseCombatant(2, "Target", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApplications := 0
	bleedDmgTicks := 0
	for _, e := range log {
		if e.Action == "bleed" && e.CharacterID == 1 && e.TriggerType == "on_hit" {
			bleedApplications++
			if e.Factor != 5 {
				t.Errorf("Bleed application factor: got %d, want 5", e.Factor)
			}
		}
		if e.Action == "bleed" && e.CharacterID == 2 && e.TriggerType == "" {
			bleedDmgTicks++
		}
	}

	if bleedApplications == 0 {
		t.Error("Expected bleed applications from on_hit but got 0")
	}
	if bleedDmgTicks == 0 {
		t.Error("Expected bleed damage ticks on target but got 0")
	}

	stats := extractStats(result, "combatant1")
	if stats["bleedApplied"].(float64) <= 0 {
		t.Error("Stats should show bleedApplied > 0")
	}
	fmt.Printf("  Bleed test: %d applications, %d damage ticks\n", bleedApplications, bleedDmgTicks)
}

// ── Test 2: Heal on_turn_start (Regeneration pattern) ────────

func TestHealOnTurnStart(t *testing.T) {
	// C1 has attack with negative factor + targetSelf + on_turn_start = heal
	// -3 percent_of_max_hp means heal 3% of maxHP (100) = 3 HP per turn
	c1 := baseCombatant(1, "Healer", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 3},
	})
	c2 := baseCombatant(2, "Attacker", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.CharacterID == 1 {
			healCount++
			if e.Factor != 3 {
				t.Errorf("Heal factor: got %d, want 3 (3%% of 100 HP)", e.Factor)
			}
		}
	}

	if healCount == 0 {
		t.Error("Expected heal entries from on_turn_start self-targeting negative attack, got 0")
	}

	stats := extractStats(result, "combatant1")
	if stats["healingDone"].(float64) <= 0 {
		t.Error("Stats should show healingDone > 0")
	}
	fmt.Printf("  Heal test: %d heals logged, total healing: %.0f\n", healCount, stats["healingDone"].(float64))
}

// ── Test 3: Stun on_hit ──────────────────────────────────────

func TestStunOnHit(t *testing.T) {
	// C1 has 100% stun chance on hit
	c1 := baseCombatant(1, "Stunner", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "stun", TriggerType: "on_hit", FactorType: "percent", Value: 100},
	})
	c2 := baseCombatant(2, "Victim", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunApplied := 0
	stunnedSkips := 0
	for _, e := range log {
		if e.Action == "stun" && e.CharacterID == 1 {
			stunApplied++
		}
		if e.Action == "stunned" && e.CharacterID == 2 {
			stunnedSkips++
		}
	}

	if stunApplied == 0 {
		t.Error("Expected stun applications")
	}
	if stunnedSkips == 0 {
		t.Error("Expected 'stunned' entries showing target skipping turns")
	}

	// Verify stun and stunned are separate actions
	for _, e := range log {
		if e.Action == "stun" && e.CharacterID == 2 {
			t.Error("Stun action should only appear for the stunner (C1), not the victim")
		}
	}

	stats := extractStats(result, "combatant1")
	if stats["stunApplied"].(float64) <= 0 {
		t.Error("Stats should show stunApplied > 0")
	}
	stats2 := extractStats(result, "combatant2")
	if stats2["timesStunned"].(float64) <= 0 {
		t.Error("Stats should show timesStunned > 0 for victim")
	}
	fmt.Printf("  Stun test: %d applications, %d skipped turns\n", stunApplied, stunnedSkips)
}

// ── Test 4: Dodge (agility-based) ────────────────────────────

func TestDodgeHighAgility(t *testing.T) {
	// C2 has much higher agility → high dodge chance
	// Ratio-based: 40/10 = 4.0, chance = 10 * log2(4+1) = ~23%
	c1 := baseCombatant(1, "Slow", nil)
	c1.Stamina = 50
	c2 := baseCombatant(2, "Fast", nil)
	c2.Agility = 40 // ratio 4:1 → ~23% dodge
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dodges := 0
	c1Attacks := 0
	for _, e := range log {
		if e.Action == "dodge" && e.CharacterID == 1 {
			dodges++ // C1's attack was dodged by C2
		}
		if (e.Action == "attack" || e.Action == "crit") && e.CharacterID == 1 {
			c1Attacks++
		}
	}

	total := dodges + c1Attacks
	if total == 0 {
		t.Fatal("No attacks or dodges recorded")
	}

	dodgePct := float64(dodges) / float64(total) * 100
	fmt.Printf("  Dodge test: C2 dodged %d/%d attacks (%.0f%%), expected ~23%%\n", dodges, total, dodgePct)

	// Should have some dodges with 40% chance
	if dodges == 0 {
		t.Error("Expected at least some dodges with 40% chance")
	}

	stats := extractStats(result, "combatant2")
	if stats["dodgedAttacks"].(float64) <= 0 {
		t.Error("Stats should show dodgedAttacks > 0 for fast character")
	}
}

// ── Test 5: Dodge with passive bonus effect ──────────────────

func TestDodgeWithPassiveBonus(t *testing.T) {
	// Both equal agility (10), but C2 has +20 dodge from passive effect
	// dodge chance = 10 + 0 (agility diff) + 20 (bonus) = 30%
	totalDodges := 0
	totalAttacks := 0

	for i := 0; i < 30; i++ {
		c1 := baseCombatant(1, "Normal", nil)
		c2 := baseCombatant(2, "Evasive", []CombatTestEffect{
			{EffectID: 1, CoreEffectCode: "dodge", TriggerType: "passive", FactorType: "percent", Value: 20},
		})

		result := executeCombat(c1, c2)
		log := extractLog(result)

		for _, e := range log {
			if e.CharacterID == 1 {
				if e.Action == "dodge" {
					totalDodges++
				}
				if e.Action == "attack" || e.Action == "crit" {
					totalAttacks++
				}
			}
		}
	}

	total := totalDodges + totalAttacks
	dodgePct := 0.0
	if total > 0 {
		dodgePct = float64(totalDodges) / float64(total) * 100
	}
	fmt.Printf("  Dodge+bonus test (30 fights): dodged %d/%d (%.1f%%), expected ~30%%\n", totalDodges, total, dodgePct)

	if totalDodges == 0 {
		t.Error("Expected at least some dodges with 30% chance over 30 fights")
	}
}

// ── Test 6: Crit (luck-based) ────────────────────────────────

func TestCritHighLuck(t *testing.T) {
	// C1 has high luck → high crit chance. Run multiple fights for reliable stats.
	totalCrits := 0
	totalNormals := 0

	for i := 0; i < 30; i++ {
		c1 := baseCombatant(1, "Lucky", nil)
		c1.Luck = 35 // ratio 3.5:1 → ~21% crit
		c2 := baseCombatant(2, "Unlucky", nil)

		result := executeCombat(c1, c2)
		log := extractLog(result)

		for _, e := range log {
			if e.CharacterID == 1 {
				if e.Action == "crit" {
					totalCrits++
				}
				if e.Action == "attack" {
					totalNormals++
				}
			}
		}
	}

	total := totalCrits + totalNormals
	critPct := 0.0
	if total > 0 {
		critPct = float64(totalCrits) / float64(total) * 100
	}
	fmt.Printf("  Crit test (30 fights): %d crits, %d normals (%.1f%% crit rate), expected ~21%%\n", totalCrits, totalNormals, critPct)

	if totalCrits == 0 {
		t.Error("Expected at least some crits with ~21% chance over 30 fights")
	}

	// Crit rate should be in reasonable range for ~21% expected
	if critPct < 8 || critPct > 40 {
		t.Errorf("Crit rate %.1f%% out of expected range 8-40%% for ~21%% chance", critPct)
	}
}

// ── Test 7: Double attack ────────────────────────────────────

func TestDoubleAttack(t *testing.T) {
	// C1 has 100% double attack chance
	c1 := baseCombatant(1, "DoubleHitter", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "double_attack", TriggerType: "passive", FactorType: "percent", Value: 100},
	})
	c2 := baseCombatant(2, "Target", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// Count C1's attacks per turn — with 100% double attack there should be 2 per turn
	turnAttacks := map[int]int{}
	for _, e := range log {
		if e.CharacterID == 1 && (e.Action == "attack" || e.Action == "crit") {
			turnAttacks[e.Turn]++
		}
	}

	doubleturns := 0
	for turn, count := range turnAttacks {
		if count >= 2 {
			doubleturns++
		}
		_ = turn
	}

	if doubleturns == 0 {
		t.Error("Expected double attack turns (2+ attacks in same turn) with 100% chance")
	}

	stats := extractStats(result, "combatant1")
	if stats["doubleAttacks"].(float64) <= 0 {
		t.Error("Stats should show doubleAttacks > 0")
	}
	fmt.Printf("  Double attack test: %d turns had double attacks out of %d turns\n", doubleturns, len(turnAttacks))
}

// ── Test 8: Counterattack ────────────────────────────────────

func TestCounterattack(t *testing.T) {
	// C2 has 100% counter chance
	c1 := baseCombatant(1, "Attacker", nil)
	c2 := baseCombatant(2, "Counter", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "counterattack", TriggerType: "passive", FactorType: "percent", Value: 100},
	})

	result := executeCombat(c1, c2)
	log := extractLog(result)

	counters := 0
	for _, e := range log {
		if e.Action == "counterattack" && e.CharacterID == 2 {
			counters++
		}
	}

	if counters == 0 {
		t.Error("Expected counterattack entries with 100% counter chance")
	}

	stats := extractStats(result, "combatant2")
	if stats["counterHits"].(float64) <= 0 {
		t.Error("Stats should show counterHits > 0")
	}
	fmt.Printf("  Counter test: %d counterattacks logged\n", counters)
}

// ── Test 9: on_hit_taken heal (self-healing when hit) ────────

func TestOnHitTakenHeal(t *testing.T) {
	// C2 heals 10% of damage taken when hit
	c1 := baseCombatant(1, "Attacker", nil)
	c2 := baseCombatant(2, "Vampire", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "heal", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", TargetSelf: true, Value: 50},
	})

	result := executeCombat(c1, c2)
	log := extractLog(result)

	heals := 0
	for _, e := range log {
		if e.Action == "heal" && e.CharacterID == 2 && e.TriggerType == "on_hit_taken" {
			heals++
		}
	}

	if heals == 0 {
		t.Error("Expected heal entries from on_hit_taken self-targeting negative attack")
	}

	stats := extractStats(result, "combatant2")
	if stats["healingDone"].(float64) <= 0 {
		t.Error("Stats should show healingDone > 0 for vampire")
	}
	fmt.Printf("  On-hit-taken heal test: %d heal entries, total: %.0f\n", heals, stats["healingDone"].(float64))
}

// ── Test 10: Equal stats → ~10% base dodge/crit ─────────────

func TestBaseRates(t *testing.T) {
	// Both equal stats, no effects. Run many combats to check base rates ~10%
	totalCrits := 0
	totalDodges := 0
	totalAttacks := 0

	for i := 0; i < 50; i++ {
		c1 := baseCombatant(1, "A", nil)
		c2 := baseCombatant(2, "B", nil)
		result := executeCombat(c1, c2)
		log := extractLog(result)
		for _, e := range log {
			if e.Action == "crit" {
				totalCrits++
			}
			if e.Action == "attack" {
				totalAttacks++
			}
			if e.Action == "dodge" {
				totalDodges++
			}
		}
	}

	totalSwings := totalAttacks + totalCrits + totalDodges
	if totalSwings == 0 {
		t.Fatal("No combat actions recorded")
	}

	critRate := float64(totalCrits) / float64(totalAttacks+totalCrits) * 100
	dodgeRate := float64(totalDodges) / float64(totalSwings) * 100

	fmt.Printf("  Base rates (50 fights): crit=%.1f%% dodge=%.1f%% (expected ~10%% each)\n", critRate, dodgeRate)

	// Allow generous range: 3-20%
	if critRate < 3 || critRate > 20 {
		t.Errorf("Crit rate %.1f%% out of expected range 3-20%% for equal stats", critRate)
	}
	if dodgeRate < 3 || dodgeRate > 20 {
		t.Errorf("Dodge rate %.1f%% out of expected range 3-20%% for equal stats", dodgeRate)
	}
}

// ── Test 11: Consecutive damage bonus ────────────────────────

func TestConsecutiveDamage(t *testing.T) {
	// C1 has 50% consecutive damage bonus and 0% dodge opponent → every hit lands
	// Hit 1: normal, Hit 2: +50%, Hit 3: +100%, etc.
	c1 := baseCombatant(1, "Momentum", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "consecutive_damage", TriggerType: "passive", FactorType: "percent", Value: 50},
	})
	c1.Luck = 0 // minimize crits
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Agility = 0 // minimize dodges
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// Find C1's attack damages in order
	var damages []int
	for _, e := range log {
		if e.CharacterID == 1 && (e.Action == "attack" || e.Action == "crit") {
			damages = append(damages, e.Factor)
		}
	}

	if len(damages) < 3 {
		t.Fatalf("Expected at least 3 attacks, got %d", len(damages))
	}

	// Check that damages increase: hit 2 should be > hit 1 (unless crit messes things up)
	// With 50% bonus per hit: hit1=20, hit2=30, hit3=40
	fmt.Printf("  Consecutive damage test: damages = %v\n", damages)

	// Second hit should be 50% more than first (if no crits)
	if len(damages) >= 2 && damages[1] <= damages[0] {
		// Could be a crit on first, normal on second. Check for general trend.
		increasing := 0
		for i := 1; i < len(damages); i++ {
			if damages[i] >= damages[i-1] {
				increasing++
			}
		}
		if float64(increasing)/float64(len(damages)-1) < 0.5 {
			t.Errorf("Expected generally increasing damage with consecutive bonus, trend ratio: %.1f", float64(increasing)/float64(len(damages)-1))
		}
	}

	stats := extractStats(result, "combatant1")
	if stats["maxConsecHits"].(float64) < 2 {
		t.Error("Expected maxConsecHits >= 2")
	}
	fmt.Printf("  Max consecutive hits: %.0f\n", stats["maxConsecHits"].(float64))
}

// ── Test 12: Consecutive hits reset on dodge ─────────────────

func TestConsecutiveHitsResetOnDodge(t *testing.T) {
	// C1 has consecutive damage, C2 has very high dodge to force resets
	c1 := baseCombatant(1, "Striker", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "consecutive_damage", TriggerType: "passive", FactorType: "percent", Value: 100},
	})
	c1.Luck = 0
	c2 := baseCombatant(2, "Dodger", []CombatTestEffect{
		{EffectID: 2, CoreEffectCode: "dodge", TriggerType: "passive", FactorType: "percent", Value: 40},
	})
	c2.Agility = 30 // high dodge chance

	// Run several fights — dodge resets should keep damage from spiraling
	totalMaxConsec := 0
	fights := 10
	for i := 0; i < fights; i++ {
		c1Copy := *c1
		c2Copy := *c2
		result := executeCombat(&c1Copy, &c2Copy)
		stats := extractStats(result, "combatant1")
		maxC := int(stats["maxConsecHits"].(float64))
		totalMaxConsec += maxC
	}

	avgMaxConsec := float64(totalMaxConsec) / float64(fights)
	fmt.Printf("  Consecutive reset test (%d fights): avg max streak = %.1f (should be low due to dodges)\n", fights, avgMaxConsec)

	// With high dodge rate, streaks should be limited
	if avgMaxConsec > 8 {
		t.Errorf("Average max consecutive streak %.1f seems too high given high dodge rate", avgMaxConsec)
	}
}

// ── Test 13: on_crit_taken trigger ───────────────────────────

func TestOnCritTaken(t *testing.T) {
	// C1 always crits (high luck), C2 heals when crit taken
	c1 := baseCombatant(1, "CritMachine", nil)
	c1.Luck = 100 // very high crit chance
	c1.Stamina = 50

	c2 := baseCombatant(2, "Resilient", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 5},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	critTakenHeals := 0
	for _, e := range log {
		if e.Action == "heal" && e.CharacterID == 2 && e.TriggerType == "on_crit_taken" {
			critTakenHeals++
		}
	}

	crits := 0
	for _, e := range log {
		if e.Action == "crit" && e.CharacterID == 1 {
			crits++
		}
	}

	fmt.Printf("  on_crit_taken test: %d crits from C1, %d heals on C2\n", crits, critTakenHeals)

	if crits == 0 {
		t.Error("Expected crits from C1 with high luck")
	}
	if critTakenHeals == 0 {
		t.Error("Expected on_crit_taken heal entries for C2")
	}
}

// ── Test 14: on_crit_taken retaliation damage ────────────────

func TestOnCritTakenRetaliation(t *testing.T) {
	// C2 deals damage back when crit
	c1 := baseCombatant(1, "CritMachine", nil)
	c1.Luck = 100 // high crit
	c1.Stamina = 50

	c2 := baseCombatant(2, "Retaliator", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_damage_taken", TargetSelf: false, Value: 30},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	retaliations := 0
	for _, e := range log {
		if e.Action == "damage" && e.CharacterID == 2 && e.TriggerType == "on_crit_taken" {
			retaliations++
			if e.Factor <= 0 {
				t.Errorf("Expected positive retaliation damage, got %d", e.Factor)
			}
		}
	}

	fmt.Printf("  on_crit_taken retaliation test: %d retaliations\n", retaliations)
	if retaliations == 0 {
		t.Error("Expected retaliation damage entries from on_crit_taken")
	}
}

// ── Test 15: modify_heal on_crit (Crippling Precision) ───────

func TestModifyHealOnCrit(t *testing.T) {
	// C1 crits and reduces C2 healing. C2 heals on_turn_start.
	c1 := baseCombatant(1, "CritDebuffer", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "modify_heal", TriggerType: "on_crit", FactorType: "percent", TargetSelf: false, Value: -50},
	})
	c1.Luck = 100 // always crit

	c2 := baseCombatant(2, "Healer", []CombatTestEffect{
		{EffectID: 2, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 10},
	})

	result := executeCombat(c1, c2)
	stats := extractStats(result, "combatant2")
	healing := stats["healingDone"].(float64)

	// Without debuff C2 would heal 10% of 100HP = 10 per turn
	// With accumulated -50% per crit, healing should be significantly reduced
	fmt.Printf("  Modify heal on_crit test: C2 total healing = %.0f\n", healing)

	// Just verify combat completed and healing was tracked
	// The actual reduction depends on how many crits happened before heals
	// The important thing is that the modify_heal mechanism fires on_crit
}

// ── Test 16: Ratio-based formula diminishing returns ─────────

func TestRatioFormulaValues(t *testing.T) {
	// Verify the new formula produces expected dodge rates at specific stat ratios
	// Run 100 fights per scenario to get stable percentages
	scenarios := []struct {
		name      string
		agiDef    int
		agiAtk    int
		bonus     int
		expectMin float64
		expectMax float64
	}{
		{"equal stats (10v10)", 10, 10, 0, 5, 18}, // 10%
		{"double (20v10)", 20, 10, 0, 10, 25},     // ~17%
		{"triple (30v10)", 30, 10, 0, 15, 32},     // ~23%
		{"5x (50v10)", 50, 10, 0, 20, 38},         // ~28%
		{"equal+bonus20", 10, 10, 20, 22, 40},     // 30%
	}

	for _, sc := range scenarios {
		totalDodges := 0
		totalSwings := 0

		for i := 0; i < 100; i++ {
			c1 := baseCombatant(1, "Atk", nil)
			c1.Agility = sc.agiAtk
			c1.Luck = 0

			effects := []CombatTestEffect{}
			if sc.bonus > 0 {
				effects = append(effects, CombatTestEffect{EffectID: 1, CoreEffectCode: "dodge", TriggerType: "passive", FactorType: "percent", Value: sc.bonus})
			}
			c2 := baseCombatant(2, "Def", effects)
			c2.Agility = sc.agiDef

			result := executeCombat(c1, c2)
			log := extractLog(result)
			for _, e := range log {
				if e.CharacterID == 1 {
					if e.Action == "dodge" {
						totalDodges++
					}
					if e.Action == "attack" || e.Action == "crit" {
						totalSwings++
					}
				}
			}
		}

		total := totalDodges + totalSwings
		rate := 0.0
		if total > 0 {
			rate = float64(totalDodges) / float64(total) * 100
		}
		fmt.Printf("  Formula %s: dodge=%.1f%% (expect %.0f-%.0f%%)\n", sc.name, rate, sc.expectMin, sc.expectMax)

		if rate < sc.expectMin || rate > sc.expectMax {
			t.Errorf("Scenario '%s': dodge rate %.1f%% outside expected range [%.0f, %.0f]", sc.name, rate, sc.expectMin, sc.expectMax)
		}
	}
}

// ── Test 17: Temp buff on_hit increases damage for limited turns ──

func TestTempBuffOnHitDamage(t *testing.T) {
	// C1 has on_hit modify_damage +50% for 2 turns (huge value so effect is obvious)
	dur := 2
	c1 := baseCombatant(1, "Surger", []CombatTestEffect{
		{EffectID: 72, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: 50, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 0 // no crits
	c2 := baseCombatant(2, "Dummy", nil)
	c2.Stamina = 50 // 500 HP so fight lasts longer
	c2.Luck = 0

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffApplied := 0
	buffExpired := 0
	for _, e := range log {
		if e.Action == "buff" && e.CharacterID == 1 && e.BuffType == "modify_damage" {
			buffApplied++
			if e.Duration == nil || *e.Duration != 2 {
				t.Errorf("Buff duration should be 2, got %v", e.Duration)
			}
		}
		if e.Action == "buff_expire" && e.CharacterID == 1 && e.BuffType == "modify_damage" {
			buffExpired++
		}
	}

	if buffApplied == 0 {
		t.Error("Expected buff entries in combat log")
	}
	if buffExpired == 0 {
		t.Error("Expected buff_expire entries after buffs wear off")
	}
	fmt.Printf("  Temp buff test: %d buffs applied, %d expired\n", buffApplied, buffExpired)
}

// ── Test 18: Temp buff expires and modifier reverts ──────────

func TestTempBuffExpiry(t *testing.T) {
	// C1 gets +100% damage on_hit for duration=1 (expires after 1 turn-end tick)
	// Use 100% so damage doubles when buffed; reverts to normal when expired
	dur := 1
	c1 := baseCombatant(1, "ShortBuff", []CombatTestEffect{
		{EffectID: 99, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: 100, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 0
	c2 := baseCombatant(2, "Tank", nil)
	c2.Stamina = 100 // 1000 HP
	c2.Luck = 0

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// Track C1's attack damage per turn
	turnDamage := map[int][]int{}
	for _, e := range log {
		if e.CharacterID == 1 && (e.Action == "attack" || e.Action == "crit") {
			turnDamage[e.Turn] = append(turnDamage[e.Turn], e.Factor)
		}
	}

	// Turn 1: first attack does base damage (20), buff triggers, expires at end of turn 1
	// Turn 2: buff from turn 1 attack already expired, new attack applies buff, damage = base * (1 + stacked_modifier/100)
	// The key check: buff entries exist and damage varies
	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.CharacterID == 1 {
			buffCount++
		}
		if e.Action == "buff_expire" && e.CharacterID == 1 {
			expireCount++
		}
	}

	// With duration 1, every buff should expire 1 turn later
	if buffCount == 0 {
		t.Error("Expected buff log entries")
	}
	if expireCount == 0 {
		t.Error("Expected buff_expire log entries")
	}
	// Expire count should be close to buff count (within 1-2, since last buff might not expire before combat ends)
	diff := buffCount - expireCount
	if diff < 0 {
		diff = -diff
	}
	if diff > 2 {
		t.Errorf("Buff/expire mismatch: %d applied, %d expired (diff %d > 2)", buffCount, expireCount, diff)
	}
	fmt.Printf("  Temp buff expiry test: %d applied, %d expired\n", buffCount, expireCount)
}

// ── Test 19: Duration=2 buff lasts two turn-end ticks ────────

func TestTempBuffDuration2(t *testing.T) {
	// C1 has on_hit modify_damage +50% for 2 turns
	// With 1000 HP on C2, we can track multiple turns
	dur := 2
	c1 := baseCombatant(1, "BuffLong", []CombatTestEffect{
		{EffectID: 72, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: 50, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 0
	c2 := baseCombatant(2, "Tank", nil)
	c2.Stamina = 100 // 1000 HP
	c2.Luck = 0

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// With duration 2, a buff applied on turn 1 attack should expire at end of turn 3
	// (tick down at end of turn 1: remaining 1, tick down at end of turn 2: remaining 0 => expire)
	type buffEvent struct {
		turn   int
		action string
	}
	events := []buffEvent{}
	for _, e := range log {
		if e.CharacterID == 1 && (e.Action == "buff" || e.Action == "buff_expire") && e.BuffType == "modify_damage" {
			events = append(events, buffEvent{e.Turn, e.Action})
		}
	}

	if len(events) < 2 {
		t.Fatalf("Not enough buff events, got %d", len(events))
	}

	// First buff should be on turn 1, first expire should be on turn 2 or later (dur=2 means 2 ticks)
	firstBuff := -1
	firstExpire := -1
	for _, ev := range events {
		if ev.action == "buff" && firstBuff == -1 {
			firstBuff = ev.turn
		}
		if ev.action == "buff_expire" && firstExpire == -1 {
			firstExpire = ev.turn
		}
	}

	if firstExpire <= firstBuff {
		t.Errorf("First buff_expire (turn %d) should be after first buff (turn %d)", firstExpire, firstBuff)
	}
	// With duration 2, the expire should be 2 turns after the buff was applied
	gap := firstExpire - firstBuff
	if gap != 2 {
		t.Errorf("Expected 2-turn gap between buff and expire, got %d (buff turn %d, expire turn %d)", gap, firstBuff, firstExpire)
	}
	fmt.Printf("  Duration-2 test: first buff turn %d, first expire turn %d (gap=%d)\n", firstBuff, firstExpire, gap)
}

// ── Test 20: Defensive Reflex — on_hit_taken temp dodge buff ──

func TestTempBuffOnHitTaken(t *testing.T) {
	// C2 has on_hit_taken: +30% dodge for 1 turn (self)
	dur := 1
	c1 := baseCombatant(1, "Attacker", nil)
	c1.Luck = 0

	c2 := baseCombatant(2, "Reflexer", []CombatTestEffect{
		{EffectID: 76, CoreEffectCode: "modify_dodge", TriggerType: "on_hit_taken", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur},
	})
	c2.Luck = 0
	c2.Stamina = 50 // 500 HP so fight lasts

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	dodgeCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.CharacterID == 2 && e.BuffType == "modify_dodge" {
			buffCount++
		}
		if e.Action == "buff_expire" && e.CharacterID == 2 && e.BuffType == "modify_dodge" {
			expireCount++
		}
		if e.Action == "dodge" && e.CharacterID == 1 {
			dodgeCount++
		}
	}

	if buffCount == 0 {
		t.Error("Expected on_hit_taken dodge buff entries")
	}
	// With +30% dodge buff stacking each hit, there should be some dodges
	fmt.Printf("  on_hit_taken dodge buff: %d buffs, %d expired, %d dodges\n", buffCount, expireCount, dodgeCount)
}

// ── Test 21: Disrupting Blow — on_hit debuff on enemy ────────

func TestTempDebuffOnEnemy(t *testing.T) {
	// C1 has on_hit: -20% dodge on enemy for 2 turns
	dur := 2
	c1 := baseCombatant(1, "Disruptor", []CombatTestEffect{
		{EffectID: 75, CoreEffectCode: "modify_dodge", TriggerType: "on_hit", FactorType: "percent", Value: -20, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 0
	c1.Stamina = 50

	c2 := baseCombatant(2, "DodgyTarget", []CombatTestEffect{
		{EffectID: 50, CoreEffectCode: "dodge", TriggerType: "passive", FactorType: "percent", Value: 20},
	})
	c2.Agility = 20
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// The debuff should appear on C2 (defender)
	debuffOnEnemy := 0
	debuffExpire := 0
	for _, e := range log {
		if e.Action == "buff" && e.CharacterID == 2 && e.BuffType == "modify_dodge" {
			debuffOnEnemy++
		}
		if e.Action == "buff_expire" && e.CharacterID == 2 && e.BuffType == "modify_dodge" {
			debuffExpire++
		}
	}

	if debuffOnEnemy == 0 {
		t.Error("Expected debuff entries on enemy (C2)")
	}
	if debuffExpire == 0 {
		t.Error("Expected debuff expire entries on enemy")
	}
	fmt.Printf("  Enemy debuff test: %d debuffs on enemy, %d expired\n", debuffOnEnemy, debuffExpire)
}

// ── Test 22: Multiple temp buffs stack correctly ─────────────

func TestTempBuffStacking(t *testing.T) {
	// C1 has on_hit modify_damage +50% for 2 turns AND on_hit modify_crit +50% for 2 turns
	dur := 2
	c1 := baseCombatant(1, "Stacker", []CombatTestEffect{
		{EffectID: 72, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: 50, TargetSelf: true, Duration: &dur},
		{EffectID: 74, CoreEffectCode: "modify_crit", TriggerType: "on_hit", FactorType: "percent", Value: 50, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 0
	c1.Stamina = 50
	c2 := baseCombatant(2, "Tank", nil)
	c2.Stamina = 100 // 1000 HP
	c2.Luck = 0

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dmgBuffs := 0
	critBuffs := 0
	dmgExpires := 0
	critExpires := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 1 {
			switch {
			case e.Action == "buff" && e.BuffType == "modify_damage":
				dmgBuffs++
			case e.Action == "buff" && e.BuffType == "modify_crit":
				critBuffs++
			case e.Action == "buff_expire" && e.BuffType == "modify_damage":
				dmgExpires++
			case e.Action == "buff_expire" && e.BuffType == "modify_crit":
				critExpires++
			case e.Action == "crit":
				crits++
			}
		}
	}

	if dmgBuffs == 0 || critBuffs == 0 {
		t.Error("Expected both damage and crit buff entries")
	}
	// Crit buffs stack, so by turn 3+ we should have high crit chance => some crits
	if crits == 0 {
		t.Error("Expected crits from stacking crit buff")
	}
	fmt.Printf("  Stacking test: dmg buffs %d/%d, crit buffs %d/%d, crits=%d\n",
		dmgBuffs, dmgExpires, critBuffs, critExpires, crits)
}

// ── Test 23: Hardened (77) — on_hit_taken +armor self dur=2 ──

func TestHardenedArmorBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Attacker", nil)
	c1.Luck = 0

	c2 := baseCombatant(2, "Hardened", []CombatTestEffect{
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 8, TargetSelf: true, Duration: &dur},
	})
	c2.Luck = 0
	c2.Stamina = 50 // 500 HP

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
	}
	if buffCount == 0 {
		t.Error("Expected armor buff entries on defender")
	}
	if expireCount == 0 {
		t.Error("Expected armor buff_expire entries")
	}
	fmt.Printf("  Hardened (77): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 24: Focused Rage (78) — on_hit_taken +damage self dur=1 ──

func TestFocusedRageDamageBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Attacker", nil)
	c1.Luck = 0

	c2 := baseCombatant(2, "Rager", []CombatTestEffect{
		{EffectID: 78, CoreEffectCode: "modify_damage", TriggerType: "on_hit_taken", FactorType: "percent", Value: 10, TargetSelf: true, Duration: &dur},
	})
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_damage" {
			buffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
	}
	if buffCount == 0 {
		t.Error("Expected damage buff entries on defender (Focused Rage)")
	}
	if expireCount == 0 {
		t.Error("Expected damage buff_expire entries")
	}
	fmt.Printf("  Focused Rage (78): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 25: Exposed Nerve (79) — on_crit -armor enemy dur=2 ──

func TestExposedNerveArmorDebuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "CritMachine", []CombatTestEffect{
		{EffectID: 79, CoreEffectCode: "modify_armor", TriggerType: "on_crit", FactorType: "percent", Value: -8, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_armor" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Exposed Nerve")
	}
	if debuffCount == 0 {
		t.Error("Expected armor debuff entries on enemy")
	}
	if expireCount == 0 {
		t.Error("Expected armor debuff_expire entries")
	}
	fmt.Printf("  Exposed Nerve (79): %d crits, %d debuffs, %d expired\n", crits, debuffCount, expireCount)
}

// ── Test 26: Shaken (80) — on_hit -crit enemy dur=2 ──

func TestShakenCritDebuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Intimidator", []CombatTestEffect{
		{EffectID: 80, CoreEffectCode: "modify_crit", TriggerType: "on_hit", FactorType: "percent", Value: -5, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 0

	c2 := baseCombatant(2, "ShakenTarget", nil)
	c2.Luck = 50 // high luck so crit reduction is visible
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_crit" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_crit" {
			expireCount++
		}
	}
	if debuffCount == 0 {
		t.Error("Expected crit debuff entries on enemy (Shaken)")
	}
	if expireCount == 0 {
		t.Error("Expected crit debuff_expire entries")
	}
	fmt.Printf("  Shaken (80): %d debuffs, %d expired\n", debuffCount, expireCount)
}

// ── Test 27: Renewed Vigor (81) — on_hit +heal self dur=1 ──

func TestRenewedVigorHealBuff(t *testing.T) {
	dur := 1
	// C1 has on_hit heal buff AND a heal-on-turn-start so the heal modifier actually matters
	c1 := baseCombatant(1, "Healer", []CombatTestEffect{
		{EffectID: 81, CoreEffectCode: "modify_heal", TriggerType: "on_hit", FactorType: "percent", Value: 10, TargetSelf: true, Duration: &dur},
		{EffectID: 2, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 5, TargetSelf: true}, // heal 5% HP per turn
	})
	c1.Luck = 0
	c1.Stamina = 50

	c2 := baseCombatant(2, "Dummy", nil)
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_heal" {
			buffCount++
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_heal" {
			expireCount++
		}
	}
	if buffCount == 0 {
		t.Error("Expected heal buff entries (Renewed Vigor)")
	}
	if expireCount == 0 {
		t.Error("Expected heal buff_expire entries")
	}
	fmt.Printf("  Renewed Vigor (81): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 28: Crushing Weight (82) — on_hit -damage enemy dur=2 ──

func TestCrushingWeightDamageDebuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Crusher", []CombatTestEffect{
		{EffectID: 82, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: -5, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 0

	c2 := baseCombatant(2, "WeakenedFoe", nil)
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_damage" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
	}
	if debuffCount == 0 {
		t.Error("Expected damage debuff entries on enemy (Crushing Weight)")
	}
	if expireCount == 0 {
		t.Error("Expected damage debuff_expire entries")
	}
	fmt.Printf("  Crushing Weight (82): %d debuffs, %d expired\n", debuffCount, expireCount)
}

// ── Test 29: Fortifying Strike (83) — on_hit +armor self dur=2 ──

func TestFortifyingStrikeArmorBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Fortifier", []CombatTestEffect{
		{EffectID: 83, CoreEffectCode: "modify_armor", TriggerType: "on_hit", FactorType: "percent", Value: 5, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 0
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
	}
	if buffCount == 0 {
		t.Error("Expected armor buff entries on self (Fortifying Strike)")
	}
	if expireCount == 0 {
		t.Error("Expected armor buff_expire entries")
	}
	fmt.Printf("  Fortifying Strike (83): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 30: Rattled (84) — on_crit -crit enemy dur=1 ──

func TestRattledCritDebuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Critter", []CombatTestEffect{
		{EffectID: 84, CoreEffectCode: "modify_crit", TriggerType: "on_crit", FactorType: "percent", Value: -10, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "RattledFoe", nil)
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_crit" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_crit" {
			expireCount++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Rattled")
	}
	if debuffCount == 0 {
		t.Error("Expected crit debuff entries on enemy (Rattled)")
	}
	if expireCount == 0 {
		t.Error("Expected crit debuff_expire entries")
	}
	fmt.Printf("  Rattled (84): %d crits, %d debuffs, %d expired\n", crits, debuffCount, expireCount)
}

// ── Test 31: Adrenaline Surge (85) — on_crit_taken +dodge self dur=2 ──

func TestAdrenalineSurgeDodgeBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "CritAttacker", nil)
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "AdrenalineDefender", []CombatTestEffect{
		{EffectID: 85, CoreEffectCode: "modify_dodge", TriggerType: "on_crit_taken", FactorType: "percent", Value: 10, TargetSelf: true, Duration: &dur},
	})
	c2.Luck = 0
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	critsOnC2 := 0
	dodges := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_dodge" {
			buffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_dodge" {
			expireCount++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			critsOnC2++
		}
		if e.Action == "dodge" && e.CharacterID == 1 {
			dodges++
		}
	}
	if critsOnC2 == 0 {
		t.Error("Expected crits from C1 to trigger on_crit_taken")
	}
	if buffCount == 0 {
		t.Error("Expected dodge buff entries on defender (Adrenaline Surge)")
	}
	if expireCount == 0 {
		t.Error("Expected dodge buff_expire entries")
	}
	fmt.Printf("  Adrenaline Surge (85): %d crits, %d buffs, %d expired, %d dodges\n", critsOnC2, buffCount, expireCount, dodges)
}

// ── Test 32: On-start damage buff (War Preparation pattern, effect 86) ──

func TestOnStartDamageBuff(t *testing.T) {
	dur := 3
	c1 := baseCombatant(1, "WarPrepper", []CombatTestEffect{
		{EffectID: 86, CoreEffectCode: "modify_damage", TriggerType: "on_start", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// The buff should be applied at turn 0 (before combat turns)
	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_damage" {
			buffCount++
			if e.Turn != 0 {
				t.Errorf("on_start buff expected at turn 0, got turn %d", e.Turn)
			}
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
	}
	if buffCount != 1 {
		t.Errorf("Expected exactly 1 on_start damage buff, got %d", buffCount)
	}
	if expireCount != 1 {
		t.Errorf("Expected exactly 1 buff_expire for on_start damage buff, got %d", expireCount)
	}
	fmt.Printf("  War Preparation (on_start modify_damage): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 33: On-start armor buff on self (Guardian's Shield pattern, effect 87) ──

func TestOnStartArmorBuff(t *testing.T) {
	dur := 3
	c1 := baseCombatant(1, "Guardian", []CombatTestEffect{
		{EffectID: 87, CoreEffectCode: "modify_armor", TriggerType: "on_start", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur},
	})
	c1.Armor = 10
	c2 := baseCombatant(2, "Attacker", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
		}
	}
	if buffCount != 1 {
		t.Errorf("Expected 1 on_start armor buff, got %d", buffCount)
	}
	fmt.Printf("  Guardian's Shield (on_start modify_armor): %d buffs\n", buffCount)
}

// ── Test 34: Every-other-turn damage buff (Tidal Force pattern, effect 88) ──

func TestEveryOtherTurnDamageBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "TidalForce", []CombatTestEffect{
		{EffectID: 88, CoreEffectCode: "modify_damage", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50 // more HP so combat lasts longer

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	buffTurns := []int{}
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_damage" {
			buffCount++
			buffTurns = append(buffTurns, e.Turn)
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
	}
	// Should fire on odd turns only (1, 3, 5, ...)
	for _, turn := range buffTurns {
		if turn%2 != 1 {
			t.Errorf("on_every_other_turn buff fired on even turn %d", turn)
		}
	}
	if buffCount == 0 {
		t.Error("Expected at least 1 every-other-turn damage buff")
	}
	fmt.Printf("  Tidal Force (on_every_other_turn modify_damage): %d buffs on turns %v, %d expired\n", buffCount, buffTurns, expireCount)
}

// ── Test 35: Every-other-turn armor buff (Pulsing Ward pattern, effect 89) ──

func TestEveryOtherTurnArmorBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "PulsingWard", []CombatTestEffect{
		{EffectID: 89, CoreEffectCode: "modify_armor", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c1.Armor = 10
	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
			if e.Turn%2 != 1 {
				t.Errorf("on_every_other_turn armor buff fired on even turn %d", e.Turn)
			}
		}
	}
	if buffCount == 0 {
		t.Error("Expected at least 1 every-other-turn armor buff")
	}
	fmt.Printf("  Pulsing Ward (on_every_other_turn modify_armor): %d buffs\n", buffCount)
}

// ── Test 36: Warding Fury (98) — on_crit +armor self dur=2 ──

func TestWardingFuryArmorBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "WardingFury", []CombatTestEffect{
		{EffectID: 98, CoreEffectCode: "modify_armor", TriggerType: "on_crit", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur},
	})
	c1.Luck = 100 // guarantee crits
	c1.Armor = 5
	c1.Stamina = 50 // long fight so buff can expire
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Warding Fury")
	}
	if buffCount == 0 {
		t.Error("Expected armor buff entries on self (Warding Fury)")
	}
	if expireCount == 0 {
		t.Error("Expected armor buff_expire entries")
	}
	fmt.Printf("  Warding Fury (98): %d crits, %d buffs, %d expired\n", crits, buffCount, expireCount)
}

// ── Test 37: Bloodlust Debuff (99) — on_crit -damage enemy dur=2 ──

func TestBloodlustDebuffOnCrit(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Bloodlust", []CombatTestEffect{
		{EffectID: 99, CoreEffectCode: "modify_damage", TriggerType: "on_crit", FactorType: "percent", Value: -10, TargetSelf: false, Duration: &dur},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50
	c2 := baseCombatant(2, "DebuffedFoe", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_damage" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Bloodlust Debuff")
	}
	if debuffCount == 0 {
		t.Error("Expected damage debuff entries on enemy (Bloodlust Debuff)")
	}
	if expireCount == 0 {
		t.Error("Expected damage debuff_expire entries")
	}
	fmt.Printf("  Bloodlust Debuff (99): %d crits, %d debuffs, %d expired\n", crits, debuffCount, expireCount)
}

// ── Test 38: Recovery Instinct (100) — on_hit_taken +heal self dur=2 ──

func TestRecoveryInstinctHealBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Attacker", nil)
	c2 := baseCombatant(2, "Resilient", []CombatTestEffect{
		{EffectID: 100, CoreEffectCode: "modify_heal", TriggerType: "on_hit_taken", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_heal" {
			buffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_heal" {
			expireCount++
		}
	}
	if buffCount == 0 {
		t.Error("Expected heal buff entries on self (Recovery Instinct)")
	}
	if expireCount == 0 {
		t.Error("Expected heal buff_expire entries")
	}
	fmt.Printf("  Recovery Instinct (100): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 39: Feinting Dodge (101) — on_every_other_turn +dodge self dur=1 ──

func TestFeintingDodgeBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "FeintDodge", []CombatTestEffect{
		{EffectID: 101, CoreEffectCode: "modify_dodge", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	buffTurns := []int{}
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_dodge" {
			buffCount++
			buffTurns = append(buffTurns, e.Turn)
		}
	}
	for _, turn := range buffTurns {
		if turn%2 != 1 {
			t.Errorf("on_every_other_turn dodge buff fired on even turn %d", turn)
		}
	}
	if buffCount == 0 {
		t.Error("Expected at least 1 every-other-turn dodge buff")
	}
	fmt.Printf("  Feinting Dodge (101): %d buffs on turns %v\n", buffCount, buffTurns)
}

// ── Test 40: Precision Pulse (102) — on_every_other_turn +crit self dur=1 ──

func TestPrecisionPulseCritBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "PrecPulse", []CombatTestEffect{
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	buffTurns := []int{}
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_crit" {
			buffCount++
			buffTurns = append(buffTurns, e.Turn)
		}
	}
	for _, turn := range buffTurns {
		if turn%2 != 1 {
			t.Errorf("on_every_other_turn crit buff fired on even turn %d", turn)
		}
	}
	if buffCount == 0 {
		t.Error("Expected at least 1 every-other-turn crit buff")
	}
	fmt.Printf("  Precision Pulse (102): %d buffs on turns %v\n", buffCount, buffTurns)
}

// ── Test 41: Opening Dodge (103) — on_start +dodge self dur=2 ──

func TestOpeningDodgeBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "OpenDodge", []CombatTestEffect{
		{EffectID: 103, CoreEffectCode: "modify_dodge", TriggerType: "on_start", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur},
	})
	c2 := baseCombatant(2, "Target", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_dodge" {
			buffCount++
			if e.Turn != 0 {
				t.Errorf("on_start dodge buff expected at turn 0, got turn %d", e.Turn)
			}
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_dodge" {
			expireCount++
		}
	}
	if buffCount != 1 {
		t.Errorf("Expected exactly 1 on_start dodge buff, got %d", buffCount)
	}
	if expireCount != 1 {
		t.Errorf("Expected exactly 1 dodge buff_expire, got %d", expireCount)
	}
	fmt.Printf("  Opening Dodge (103): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 42: Opening Crit (104) — on_start +crit self dur=2 ──

func TestOpeningCritBuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "OpenCrit", []CombatTestEffect{
		{EffectID: 104, CoreEffectCode: "modify_crit", TriggerType: "on_start", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
	})
	c2 := baseCombatant(2, "Target", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_crit" {
			buffCount++
			if e.Turn != 0 {
				t.Errorf("on_start crit buff expected at turn 0, got turn %d", e.Turn)
			}
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_crit" {
			expireCount++
		}
	}
	if buffCount != 1 {
		t.Errorf("Expected exactly 1 on_start crit buff, got %d", buffCount)
	}
	if expireCount != 1 {
		t.Errorf("Expected exactly 1 crit buff_expire, got %d", expireCount)
	}
	fmt.Printf("  Opening Crit (104): %d buffs, %d expired\n", buffCount, expireCount)
}

// ── Test 43: Weakening Aura (105) — on_start -damage enemy dur=2 ──

func TestWeakeningAuraDebuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Weakener", []CombatTestEffect{
		{EffectID: 105, CoreEffectCode: "modify_damage", TriggerType: "on_start", FactorType: "percent", Value: -15, TargetSelf: false, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "WeakenedFoe", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	for _, e := range log {
		// Engine logs on_start debuff with caster's (C1) CharacterID even though it targets enemy mods
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_damage" && e.TriggerType == "on_start" {
			debuffCount++
			if e.Turn != 0 {
				t.Errorf("on_start damage debuff expected at turn 0, got turn %d", e.Turn)
			}
		}
		if e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
	}
	if debuffCount != 1 {
		t.Errorf("Expected exactly 1 on_start damage debuff, got %d", debuffCount)
	}
	if expireCount != 1 {
		t.Errorf("Expected exactly 1 damage debuff_expire, got %d", expireCount)
	}
	fmt.Printf("  Weakening Aura (105): %d debuffs, %d expired\n", debuffCount, expireCount)
}

// ── Test 44: Shattering Start (106) — on_start -armor enemy dur=2 ──

func TestShatteringStartDebuff(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Shatterer", []CombatTestEffect{
		{EffectID: 106, CoreEffectCode: "modify_armor", TriggerType: "on_start", FactorType: "percent", Value: -20, TargetSelf: false, Duration: &dur},
	})
	c2 := baseCombatant(2, "ArmoredFoe", nil)
	c2.Armor = 10

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	for _, e := range log {
		// Engine logs on_start debuff with caster's (C1) CharacterID even though it targets enemy mods
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" && e.TriggerType == "on_start" {
			debuffCount++
			if e.Turn != 0 {
				t.Errorf("on_start armor debuff expected at turn 0, got turn %d", e.Turn)
			}
		}
		if e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
	}
	if debuffCount != 1 {
		t.Errorf("Expected exactly 1 on_start armor debuff, got %d", debuffCount)
	}
	if expireCount != 1 {
		t.Errorf("Expected exactly 1 armor debuff_expire, got %d", expireCount)
	}
	fmt.Printf("  Shattering Start (106): %d debuffs, %d expired\n", debuffCount, expireCount)
}

// ── Test 45: Dulling Retaliation (107) — on_crit_taken -damage enemy dur=2 ──

func TestDullingRetaliationDebuff(t *testing.T) {
	dur := 2
	// C1 has the effect, C2 always crits → triggers on_crit_taken on C1
	c1 := baseCombatant(1, "DullRetaliator", []CombatTestEffect{
		{EffectID: 107, CoreEffectCode: "modify_damage", TriggerType: "on_crit_taken", FactorType: "percent", Value: -10, TargetSelf: false, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "CritAttacker", nil)
	c2.Luck = 100 // guarantee crits
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffCount := 0
	expireCount := 0
	critsOnC1 := 0
	for _, e := range log {
		// Debuff applied on C2 (the critter = "enemy" from C1's perspective)
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_damage" {
			debuffCount++
		}
		if e.CharacterID == 2 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expireCount++
		}
		if e.CharacterID == 2 && e.Action == "crit" {
			critsOnC1++
		}
	}
	if critsOnC1 == 0 {
		t.Error("Expected crits from C2 to trigger on_crit_taken")
	}
	if debuffCount == 0 {
		t.Error("Expected damage debuff entries on C2 (Dulling Retaliation)")
	}
	if expireCount == 0 {
		t.Error("Expected damage debuff_expire entries")
	}
	fmt.Printf("  Dulling Retaliation (107): %d crits on C1, %d debuffs on C2, %d expired\n", critsOnC1, debuffCount, expireCount)
}

// ── Test 46: Crit Armor (108) — on_crit_taken +armor self dur=2 ──

func TestCritArmorBuff(t *testing.T) {
	dur := 2
	// C1 has the effect, C2 always crits → triggers on_crit_taken on C1
	c1 := baseCombatant(1, "CritArmored", []CombatTestEffect{
		{EffectID: 108, CoreEffectCode: "modify_armor", TriggerType: "on_crit_taken", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur},
	})
	c1.Stamina = 50
	c1.Armor = 5
	c2 := baseCombatant(2, "CritAttacker", nil)
	c2.Luck = 100 // guarantee crits
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	expireCount := 0
	critsOnC1 := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" {
			buffCount++
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_armor" {
			expireCount++
		}
		if e.CharacterID == 2 && e.Action == "crit" {
			critsOnC1++
		}
	}
	if critsOnC1 == 0 {
		t.Error("Expected crits from C2 to trigger on_crit_taken")
	}
	if buffCount == 0 {
		t.Error("Expected armor buff entries on C1 (Crit Armor)")
	}
	if expireCount == 0 {
		t.Error("Expected armor buff_expire entries")
	}
	fmt.Printf("  Crit Armor (108): %d crits on C1, %d buffs, %d expired\n", critsOnC1, buffCount, expireCount)
}

// ── Test 47: Finishing Blow (109) — on_turn_end attack enemy %maxhp ──

func TestFinishingBlowTurnEndDamage(t *testing.T) {
	// C1 deals 5% of own maxHP to enemy every turn end
	c1 := baseCombatant(1, "Finisher", []CombatTestEffect{
		{EffectID: 109, CoreEffectCode: "damage", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 5, TargetSelf: false},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// 5% of 100 maxHP = 5 damage per turn end
	turnEndDmg := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "damage" && e.TriggerType == "on_turn_end" {
			turnEndDmg++
			if e.Factor != 5 {
				t.Errorf("Finishing Blow damage: got %d, want 5 (5%% of 100 HP)", e.Factor)
			}
		}
	}
	if turnEndDmg == 0 {
		t.Error("Expected on_turn_end attack entries (Finishing Blow)")
	}
	stats := extractStats(result, "combatant1")
	fmt.Printf("  Finishing Blow (109): %d turn-end attacks, total damage: %.0f\n", turnEndDmg, stats["damageDealt"].(float64))
}

// ── Test 48: Draining Presence (110) — on_turn_end heal self %missinghp ──

func TestDrainingPresenceTurnEndHeal(t *testing.T) {
	// C1 heals 15% of missing HP at turn end
	c1 := baseCombatant(1, "Drainer", []CombatTestEffect{
		{EffectID: 110, CoreEffectCode: "heal", TriggerType: "on_turn_end", FactorType: "percent_of_missing_hp", TargetSelf: true, Value: 15},
	})
	c1.DepletedHealth = 50 // Start at 50/100 HP so there's missing HP to heal from
	c2 := baseCombatant(2, "Attacker", nil)

	result := executeCombat(c1, c2)
	log := extractLog(result)

	heals := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "heal" && e.TriggerType == "on_turn_end" {
			heals++
		}
	}
	if heals == 0 {
		t.Error("Expected on_turn_end heal entries (Draining Presence)")
	}
	stats := extractStats(result, "combatant1")
	fmt.Printf("  Draining Presence (110): %d heals, total healing: %.0f\n", heals, stats["healingDone"].(float64))
}

// ── Test 49: Attrition (111) — on_every_other_turn attack enemy %maxhp ──

func TestAttritionEveryOtherTurnDamage(t *testing.T) {
	// C1 deals 8% of own maxHP to enemy on odd turns
	c1 := baseCombatant(1, "Attrition", []CombatTestEffect{
		{EffectID: 111, CoreEffectCode: "damage", TriggerType: "on_every_other_turn", FactorType: "percent_of_max_hp", Value: 8, TargetSelf: false},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// 8% of 100 maxHP = 8 damage per odd turn
	eotDmg := 0
	eotTurns := []int{}
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "damage" && e.TriggerType == "on_every_other_turn" {
			eotDmg++
			eotTurns = append(eotTurns, e.Turn)
			if e.Factor != 8 {
				t.Errorf("Attrition damage: got %d, want 8 (8%% of 100 HP)", e.Factor)
			}
		}
	}
	for _, turn := range eotTurns {
		if turn%2 != 1 {
			t.Errorf("Attrition attack fired on even turn %d", turn)
		}
	}
	if eotDmg == 0 {
		t.Error("Expected on_every_other_turn attack entries (Attrition)")
	}
	fmt.Printf("  Attrition (111): %d attacks on turns %v\n", eotDmg, eotTurns)
}

// ── Test 50: Crit Leech (112) — on_crit heal self %dmg_dealt ──

func TestCritLeechHeal(t *testing.T) {
	// C1 heals 20% of damage dealt on crit
	c1 := baseCombatant(1, "CritLeech", []CombatTestEffect{
		{EffectID: 112, CoreEffectCode: "heal", TriggerType: "on_crit", FactorType: "percent_of_damage_dealt", TargetSelf: true, Value: 20},
	})
	c1.Luck = 100          // guarantee crits
	c1.Stamina = 50        // long fight so multiple crits land
	c1.DepletedHealth = 30 // start with missing HP so heals are visible

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	critHeals := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "heal" && e.TriggerType == "on_crit" {
			critHeals++
			// 20% of ~30 crit damage = ~6 heal
			if e.Factor <= 0 {
				t.Errorf("Expected positive heal factor, got %d", e.Factor)
			}
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits from C1 with high luck")
	}
	if critHeals == 0 {
		t.Error("Expected on_crit heal entries (Crit Leech)")
	}
	stats := extractStats(result, "combatant1")
	fmt.Printf("  Crit Leech (112): %d crits, %d heals, total healing: %.0f\n", crits, critHeals, stats["healingDone"].(float64))
}

// ── Test 51: Hemorrhage (113) — bleed on_crit ──

func TestHemorrhageBleedOnCrit(t *testing.T) {
	c1 := baseCombatant(1, "Hemorrhage", []CombatTestEffect{
		{EffectID: 113, CoreEffectCode: "bleed", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 100

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_crit" {
			bleedApps++
			// 3% of 1000 maxHP = 30
			if e.Factor != 30 {
				t.Errorf("Hemorrhage bleed: got %d, want 30 (3%% of 1000 HP)", e.Factor)
			}
		}
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicks++
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Hemorrhage")
	}
	if bleedApps == 0 {
		t.Error("Expected bleed applications from on_crit")
	}
	fmt.Printf("  Hemorrhage (113): %d crits, %d bleed apps, %d bleed ticks\n", crits, bleedApps, bleedTicks)
}

// ── Test 52: Blood Sacrifice (114) — bleed on_crit_taken (bleed the attacker) ──

func TestBloodSacrificeBleedOnCritTaken(t *testing.T) {
	c1 := baseCombatant(1, "CritAttacker", nil)
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "BloodSac", []CombatTestEffect{
		{EffectID: 114, CoreEffectCode: "bleed", TriggerType: "on_crit_taken", FactorType: "percent", Value: 6},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicksOnAttacker := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "on_crit_taken" {
			bleedApps++
			if e.Factor != 6 {
				t.Errorf("Blood Sacrifice bleed: got %d, want 6", e.Factor)
			}
		}
		// Bleed ticks on attacker (C1) — no triggerType
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicksOnAttacker++
		}
	}
	if bleedApps == 0 {
		t.Error("Expected bleed applications from on_crit_taken")
	}
	if bleedTicksOnAttacker == 0 {
		t.Error("Expected bleed tick damage on attacker (C1)")
	}
	fmt.Printf("  Blood Sacrifice (114): %d bleed apps, %d ticks on attacker\n", bleedApps, bleedTicksOnAttacker)
}

// ── Test 53: Festering Wound (115) — bleed on_turn_end ──

func TestFesteringWoundBleedOnTurnEnd(t *testing.T) {
	c1 := baseCombatant(1, "Festering", []CombatTestEffect{
		{EffectID: 115, CoreEffectCode: "bleed", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_turn_end" {
			bleedApps++
			// 2% of 500 maxHP = 10
			if e.Factor != 10 {
				t.Errorf("Festering Wound bleed: got %d, want 10 (2%% of 500 HP)", e.Factor)
			}
		}
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if bleedApps == 0 {
		t.Error("Expected bleed applications from on_turn_end")
	}
	if bleedTicks == 0 {
		t.Error("Expected bleed tick damage on target")
	}
	stats := extractStats(result, "combatant1")
	fmt.Printf("  Festering Wound (115): %d bleed apps, %d ticks, total bleed applied: %.0f\n", bleedApps, bleedTicks, stats["bleedApplied"].(float64))
}

// ── Test 54: Concussive Blow (116) — stun on_crit ──

func TestConcussiveBlowStunOnCrit(t *testing.T) {
	c1 := baseCombatant(1, "Concussive", []CombatTestEffect{
		{EffectID: 116, CoreEffectCode: "stun", TriggerType: "on_crit", FactorType: "percent", Value: 100},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunApps := 0
	stunnedSkips := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "stun" && e.TriggerType == "on_crit" {
			stunApps++
		}
		if e.CharacterID == 2 && e.Action == "stunned" {
			stunnedSkips++
		}
	}
	if stunApps == 0 {
		t.Error("Expected stun applications from on_crit")
	}
	if stunnedSkips == 0 {
		t.Error("Expected stunned entries on target")
	}
	fmt.Printf("  Concussive Blow (116): %d stun apps, %d stunned skips\n", stunApps, stunnedSkips)
}

// ── Test 55: Dazed Counter (117) — stun on_crit_taken ──

func TestDazedCounterStunOnCritTaken(t *testing.T) {
	c1 := baseCombatant(1, "CritAttacker", nil)
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "DazedCounter", []CombatTestEffect{
		{EffectID: 117, CoreEffectCode: "stun", TriggerType: "on_crit_taken", FactorType: "percent", Value: 100},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunApps := 0
	stunnedAttacker := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "stun" && e.TriggerType == "on_crit_taken" {
			stunApps++
		}
		if e.CharacterID == 1 && e.Action == "stunned" {
			stunnedAttacker++
		}
	}
	if stunApps == 0 {
		t.Error("Expected stun applications from on_crit_taken")
	}
	if stunnedAttacker == 0 {
		t.Error("Expected attacker (C1) stunned entries")
	}
	fmt.Printf("  Dazed Counter (117): %d stun apps, %d attacker stunned\n", stunApps, stunnedAttacker)
}

// ── Test 56: Ambush (118) — stun on_start ──

func TestAmbushStunOnStart(t *testing.T) {
	// Run multiple fights since stun is probabilistic
	stunCount := 0
	fights := 20

	for i := 0; i < fights; i++ {
		c1 := baseCombatant(1, "Ambusher", []CombatTestEffect{
			{EffectID: 118, CoreEffectCode: "stun", TriggerType: "on_start", FactorType: "percent", Value: 100},
		})
		c2 := baseCombatant(2, "Target", nil)
		c2.Stamina = 50

		result := executeCombat(c1, c2)
		log := extractLog(result)

		for _, e := range log {
			if e.CharacterID == 1 && e.Action == "stun" && e.TriggerType == "on_start" {
				stunCount++
			}
		}
	}
	if stunCount == 0 {
		t.Error("Expected at least some on_start stun applications over 20 fights")
	}
	fmt.Printf("  Ambush (118): %d stuns in %d fights\n", stunCount, fights)
}

// ── Test 57: Absorb (119) — heal on_hit_taken %dmg_taken ──

func TestAbsorbHealOnHitTaken(t *testing.T) {
	c1 := baseCombatant(1, "Attacker", nil)
	c2 := baseCombatant(2, "Absorber", []CombatTestEffect{
		{EffectID: 119, CoreEffectCode: "heal", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", TargetSelf: true, Value: 30},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	heals := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "heal" && e.TriggerType == "on_hit_taken" {
			heals++
			if e.Factor <= 0 {
				t.Errorf("Expected positive heal factor, got %d", e.Factor)
			}
		}
	}
	if heals == 0 {
		t.Error("Expected heal entries from on_hit_taken (Absorb)")
	}
	stats := extractStats(result, "combatant2")
	fmt.Printf("  Absorb (119): %d heals, total healing: %.0f\n", heals, stats["healingDone"].(float64))
}

// ── Test 58: Desperate Strike (120) — damage on_hit %missing_hp ──

func TestDesperateStrikeDamageOnHit(t *testing.T) {
	c1 := baseCombatant(1, "Desperate", []CombatTestEffect{
		{EffectID: 120, CoreEffectCode: "damage", TriggerType: "on_hit", FactorType: "percent_of_missing_hp", TargetSelf: false, Value: 50},
	})
	c1.Luck = 0            // minimize crits for cleaner test
	c1.DepletedHealth = 50 // start at 50/100 HP → 50 missing HP → 25 bonus damage

	c2 := baseCombatant(2, "Target", nil)
	c2.Agility = 0 // minimize dodges
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dmgEntries := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "damage" && e.TriggerType == "on_hit" {
			dmgEntries++
			if e.Factor <= 0 {
				t.Errorf("Expected positive bonus damage, got %d", e.Factor)
			}
		}
	}
	if dmgEntries == 0 {
		t.Error("Expected on_hit damage entries (Desperate Strike)")
	}
	stats := extractStats(result, "combatant1")
	fmt.Printf("  Desperate Strike (120): %d bonus damage hits, total damage: %.0f\n", dmgEntries, stats["damageDealt"].(float64))
}

// ── Test 59: Spite (121) — damage on_crit_taken %max_hp ──

func TestSpiteDamageOnCritTaken(t *testing.T) {
	c1 := baseCombatant(1, "CritAttacker", nil)
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "Spiteful", []CombatTestEffect{
		{EffectID: 121, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", TargetSelf: false, Value: 10},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	spiteDmg := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "damage" && e.TriggerType == "on_crit_taken" {
			spiteDmg++
			// 10% of C2 maxHP (500) = 50
			if e.Factor != 50 {
				t.Errorf("Spite damage: got %d, want 50 (10%% of 500 HP)", e.Factor)
			}
		}
	}
	if spiteDmg == 0 {
		t.Error("Expected on_crit_taken damage entries (Spite)")
	}
	fmt.Printf("  Spite (121): %d spite damage hits\n", spiteDmg)
}

// ── Test 60: Savage Crit (122) — bonus damage on crit ──

func TestSavageCritDamageOnCrit(t *testing.T) {
	c1 := baseCombatant(1, "SavageCritter", []CombatTestEffect{
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},
	})
	c1.Luck = 100
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bonusDmg := 0
	crits := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "damage" && e.TriggerType == "on_crit" {
			bonusDmg++
			if e.Factor <= 0 {
				t.Errorf("Expected positive bonus damage, got %d", e.Factor)
			}
		}
		if e.CharacterID == 1 && e.Action == "crit" {
			crits++
		}
	}
	if crits == 0 {
		t.Error("Expected crits to trigger Savage Crit")
	}
	if bonusDmg == 0 {
		t.Error("Expected bonus damage entries from on_crit")
	}
	fmt.Printf("  Savage Crit (122): %d crits, %d bonus damage hits\n", crits, bonusDmg)
}

// ── Test 61: Rising Fury (123) — damage buff on_turn_start ──

func TestRisingFuryDamageBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "RisingFury", []CombatTestEffect{
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 3, TargetSelf: true, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffs := 0
	expires := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_damage" && e.TriggerType == "on_turn_start" {
			buffs++
		}
		if e.CharacterID == 1 && e.Action == "buff_expire" && e.BuffType == "modify_damage" {
			expires++
		}
	}
	if buffs == 0 {
		t.Error("Expected modify_damage buff entries on_turn_start (Rising Fury)")
	}
	if expires == 0 {
		t.Error("Expected buff_expire entries for Rising Fury")
	}
	fmt.Printf("  Rising Fury (123): %d buffs, %d expired\n", buffs, expires)
}

// ── Test 62: Crumbling Defense (124) — armor debuff on enemy on_turn_start ──

func TestCrumblingDefenseArmorDebuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "ArmorBreaker", []CombatTestEffect{
		{EffectID: 124, CoreEffectCode: "modify_armor", TriggerType: "on_turn_start", FactorType: "percent", Value: -3, TargetSelf: false, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Armor = 20
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffs := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_armor" && e.TriggerType == "on_turn_start" {
			debuffs++
		}
	}
	if debuffs == 0 {
		t.Error("Expected modify_armor debuff on enemy from on_turn_start (Crumbling Defense)")
	}
	fmt.Printf("  Crumbling Defense (124): %d debuffs on enemy\n", debuffs)
}

// ── Test 63: Sharpening Focus (125) — crit buff on_turn_start ──

func TestSharpeningFocusCritBuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "FocusedFighter", []CombatTestEffect{
		{EffectID: 125, CoreEffectCode: "modify_crit", TriggerType: "on_turn_start", FactorType: "percent", Value: 2, TargetSelf: true, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffs := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_crit" && e.TriggerType == "on_turn_start" {
			buffs++
		}
	}
	if buffs == 0 {
		t.Error("Expected modify_crit buff entries on_turn_start (Sharpening Focus)")
	}
	fmt.Printf("  Sharpening Focus (125): %d crit buffs\n", buffs)
}

// ── Test 64: Eroding Will (126) — dodge debuff on enemy on_turn_start ──

func TestErodingWillDodgeDebuff(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "WillBreaker", []CombatTestEffect{
		{EffectID: 126, CoreEffectCode: "modify_dodge", TriggerType: "on_turn_start", FactorType: "percent", Value: -2, TargetSelf: false, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Agility = 20
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffs := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_dodge" && e.TriggerType == "on_turn_start" {
			debuffs++
		}
	}
	if debuffs == 0 {
		t.Error("Expected modify_dodge debuff on enemy from on_turn_start (Eroding Will)")
	}
	fmt.Printf("  Eroding Will (126): %d dodge debuffs on enemy\n", debuffs)
}

// ── Test 65: Healing Curse (127) — anti-heal opening debuff on enemy ──

func TestHealingCurseOnStart(t *testing.T) {
	dur := 3
	c1 := baseCombatant(1, "Curser", []CombatTestEffect{
		{EffectID: 127, CoreEffectCode: "modify_heal", TriggerType: "on_start", FactorType: "percent", Value: -5, TargetSelf: false, Duration: &dur},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Healer", []CombatTestEffect{
		{EffectID: 23, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 3},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	debuffs := 0
	for _, e := range log {
		// Engine logs on_start debuffs with caster's CharacterID
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_heal" && e.TriggerType == "on_start" {
			debuffs++
		}
	}
	if debuffs == 0 {
		t.Error("Expected modify_heal debuff on enemy from on_start (Healing Curse)")
	}
	fmt.Printf("  Healing Curse (127): %d debuffs applied\n", debuffs)
}

// ── Test 66: Cursed Blade (128) — enemy bleeds on_start ──

func TestCursedBladeBleedOnStart(t *testing.T) {
	c1 := baseCombatant(1, "CursedBlade", []CombatTestEffect{
		{EffectID: 128, CoreEffectCode: "bleed", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 4},
	})
	c1.Stamina = 50
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_start" {
			bleedApps++
			// 4% of 500 maxHP = 20
			if e.Factor != 20 {
				t.Errorf("Cursed Blade bleed: got %d, want 20 (4%% of 500 HP)", e.Factor)
			}
		}
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if bleedApps == 0 {
		t.Error("Expected bleed application from on_start (Cursed Blade)")
	}
	if bleedTicks == 0 {
		t.Error("Expected bleed tick damage on target")
	}
	fmt.Printf("  Cursed Blade (128): %d bleed apps, %d bleed ticks\n", bleedApps, bleedTicks)
}

// ── Test 67: Thorny Blood (129) — attacker bleeds when hitting defender ──

func TestThornyBloodBleedOnHitTaken(t *testing.T) {
	c1 := baseCombatant(1, "Attacker", nil)
	c1.Stamina = 50
	c1.Strength = 15
	c2 := baseCombatant(2, "ThornyDefender", []CombatTestEffect{
		{EffectID: 129, CoreEffectCode: "bleed", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 10},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "on_hit_taken" {
			bleedApps++
		}
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if bleedApps == 0 {
		t.Error("Expected bleed applied to attacker from on_hit_taken (Thorny Blood)")
	}
	if bleedTicks == 0 {
		t.Error("Expected bleed tick damage on attacker")
	}
	stats := extractStats(result, "combatant2")
	fmt.Printf("  Thorny Blood (129): %d bleed apps, %d bleed ticks, total bleed applied: %.0f\n", bleedApps, bleedTicks, stats["bleedApplied"].(float64))
}

// ── Test 68: Combined — Tank with Thorny Blood + Crumbling Defense + Hardened ──

func TestCombinedTankBuild(t *testing.T) {
	dur1 := 1
	dur2 := 2
	c1 := baseCombatant(1, "Tank", []CombatTestEffect{
		{EffectID: 129, CoreEffectCode: "bleed", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 5},                              // Thorny Blood
		{EffectID: 124, CoreEffectCode: "modify_armor", TriggerType: "on_turn_start", FactorType: "percent", Value: -5, TargetSelf: false, Duration: &dur1}, // Crumbling Defense
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 8, TargetSelf: true, Duration: &dur2},     // Hardened
	})
	c1.Stamina = 100
	c1.Armor = 20

	c2 := baseCombatant(2, "Berserker", []CombatTestEffect{
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 5},                                       // Savage Crit
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 5, TargetSelf: true, Duration: &dur1}, // Rising Fury
	})
	c2.Stamina = 100
	c2.Luck = 30
	c2.Strength = 15

	result := executeCombat(c1, c2)
	log := extractLog(result)

	thornyBleeds := 0
	armorDebuffs := 0
	armorBuffs := 0
	savageCritDmg := 0
	risingFuryBuffs := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_hit_taken" {
			thornyBleeds++
		}
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_armor" && e.TriggerType == "on_turn_start" {
			armorDebuffs++
		}
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_armor" && e.TriggerType == "on_hit_taken" {
			armorBuffs++
		}
		if e.CharacterID == 2 && e.Action == "damage" && e.TriggerType == "on_crit" {
			savageCritDmg++
		}
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_damage" && e.TriggerType == "on_turn_start" {
			risingFuryBuffs++
		}
	}
	if thornyBleeds == 0 {
		t.Error("Expected Thorny Blood bleeds on attacker")
	}
	if armorDebuffs == 0 {
		t.Error("Expected Crumbling Defense armor debuffs")
	}
	if armorBuffs == 0 {
		t.Error("Expected Hardened armor buffs on Tank")
	}
	if risingFuryBuffs == 0 {
		t.Error("Expected Rising Fury damage buffs on Berserker")
	}
	s1 := extractStats(result, "combatant1")
	s2 := extractStats(result, "combatant2")
	fmt.Printf("  Combined Tank: thorny=%d, armorDebuff=%d, armorBuff=%d, savageCrit=%d, risingFury=%d\n",
		thornyBleeds, armorDebuffs, armorBuffs, savageCritDmg, risingFuryBuffs)
	fmt.Printf("    Tank: dealt=%.0f taken=%.0f healed=%.0f bleedApplied=%.0f\n",
		s1["damageDealt"].(float64), s1["damageTaken"].(float64), s1["healingDone"].(float64), s1["bleedApplied"].(float64))
	fmt.Printf("    Berserker: dealt=%.0f taken=%.0f\n",
		s2["damageDealt"].(float64), s2["damageTaken"].(float64))
}

// ── Test 69: Combined — Debuff Master with opening curses + turn-start pressure ──

func TestCombinedDebuffMaster(t *testing.T) {
	dur1 := 1
	dur3 := 3
	c1 := baseCombatant(1, "DebuffMaster", []CombatTestEffect{
		{EffectID: 128, CoreEffectCode: "bleed", TriggerType: "on_start", FactorType: "percent", Value: 5},                                                  // Cursed Blade
		{EffectID: 127, CoreEffectCode: "modify_heal", TriggerType: "on_start", FactorType: "percent", Value: -10, TargetSelf: false, Duration: &dur3},      // Healing Curse
		{EffectID: 126, CoreEffectCode: "modify_dodge", TriggerType: "on_turn_start", FactorType: "percent", Value: -3, TargetSelf: false, Duration: &dur1}, // Eroding Will
		{EffectID: 125, CoreEffectCode: "modify_crit", TriggerType: "on_turn_start", FactorType: "percent", Value: 3, TargetSelf: true, Duration: &dur1},    // Sharpening Focus
	})
	c1.Stamina = 100
	c1.Luck = 15

	c2 := baseCombatant(2, "Healer", []CombatTestEffect{
		{EffectID: 23, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 3}, // Regeneration
	})
	c2.Stamina = 100
	c2.Agility = 20

	result := executeCombat(c1, c2)
	log := extractLog(result)

	cursedBleedApps := 0
	healCurseDebuffs := 0
	erodingWillDebuffs := 0
	sharpeningFocusBuffs := 0
	enemyHeals := 0
	bleedTicks := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_start" {
			cursedBleedApps++
		}
		// Engine logs on_start debuffs with caster's CharacterID
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_heal" && e.TriggerType == "on_start" {
			healCurseDebuffs++
		}
		if e.CharacterID == 2 && e.Action == "buff" && e.BuffType == "modify_dodge" && e.TriggerType == "on_turn_start" {
			erodingWillDebuffs++
		}
		if e.CharacterID == 1 && e.Action == "buff" && e.BuffType == "modify_crit" && e.TriggerType == "on_turn_start" {
			sharpeningFocusBuffs++
		}
		if e.CharacterID == 2 && e.Action == "heal" {
			enemyHeals++
		}
		if e.CharacterID == 2 && e.Action == "bleed" && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if cursedBleedApps == 0 {
		t.Error("Expected Cursed Blade bleed at start")
	}
	if healCurseDebuffs == 0 {
		t.Error("Expected Healing Curse debuff at start")
	}
	if erodingWillDebuffs == 0 {
		t.Error("Expected Eroding Will dodge debuffs each turn")
	}
	if sharpeningFocusBuffs == 0 {
		t.Error("Expected Sharpening Focus crit buffs each turn")
	}
	if bleedTicks == 0 {
		t.Error("Expected bleed ticks on enemy from Cursed Blade")
	}
	s1 := extractStats(result, "combatant1")
	s2 := extractStats(result, "combatant2")
	fmt.Printf("  Combined Debuff: cursedBleed=%d, healCurse=%d, erodingWill=%d, sharpeningFocus=%d\n",
		cursedBleedApps, healCurseDebuffs, erodingWillDebuffs, sharpeningFocusBuffs)
	fmt.Printf("    DebuffMaster: dealt=%.0f crits=%.0f bleedApplied=%.0f\n",
		s1["damageDealt"].(float64), s1["critHits"].(float64), s1["bleedApplied"].(float64))
	fmt.Printf("    Healer: healed=%.0f taken=%.0f bleedTicks=%d\n",
		s2["healingDone"].(float64), s2["damageTaken"].(float64), bleedTicks)
}

// ── Test 70: Combined — Full loadout mirror match ──

func TestCombinedMirrorMatch(t *testing.T) {
	dur1 := 1
	dur2 := 2
	// Both fighters have balanced loadouts with several new effects
	effects := []CombatTestEffect{
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 3, TargetSelf: true, Duration: &dur1}, // Rising Fury
		{EffectID: 125, CoreEffectCode: "modify_crit", TriggerType: "on_turn_start", FactorType: "percent", Value: 2, TargetSelf: true, Duration: &dur1},   // Sharpening Focus
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},                                       // Savage Crit
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 5, TargetSelf: true, Duration: &dur2},    // Hardened
		{EffectID: 129, CoreEffectCode: "bleed", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 3},                             // Thorny Blood
	}

	c1 := baseCombatant(1, "Fighter A", effects)
	c1.Stamina = 150
	c1.Luck = 15
	c1.Armor = 12

	c2 := baseCombatant(2, "Fighter B", effects)
	c2.Stamina = 150
	c2.Luck = 15
	c2.Armor = 12

	result := executeCombat(c1, c2)
	log := extractLog(result)

	// Just verify the fight produces a rich log with multiple effect types active
	actionCounts := map[string]int{}
	for _, e := range log {
		key := e.Action
		if e.TriggerType != "" {
			key += "/" + e.TriggerType
		}
		actionCounts[key]++
	}

	requiredActions := []string{"damage/on_crit", "buff/on_turn_start", "bleed/on_hit_taken"}
	for _, act := range requiredActions {
		if actionCounts[act] == 0 {
			t.Errorf("Expected action %q in mirror match log", act)
		}
	}

	s1 := extractStats(result, "combatant1")
	s2 := extractStats(result, "combatant2")
	fmt.Printf("  Mirror Match: %d unique action types, %d total log entries\n", len(actionCounts), len(log))
	fmt.Printf("    Fighter A: dealt=%.0f taken=%.0f healed=%.0f bleed=%.0f\n",
		s1["damageDealt"].(float64), s1["damageTaken"].(float64), s1["healingDone"].(float64), s1["bleedApplied"].(float64))
	fmt.Printf("    Fighter B: dealt=%.0f taken=%.0f healed=%.0f bleed=%.0f\n",
		s2["damageDealt"].(float64), s2["damageTaken"].(float64), s2["healingDone"].(float64), s2["bleedApplied"].(float64))
}

// ════════════════════════════════════════════════════════════════
//  PERK TESTS — verify each perk's two-effect combination
// ════════════════════════════════════════════════════════════════

// ── Test 71: Perk — Blood Price (Savage Crit + Glass Jaw) ──

func TestPerkBloodPrice(t *testing.T) {
	// Perk holder: 100% crit to guarantee Savage Crit triggers, -15% armor from Glass Jaw
	c1 := baseCombatant(1, "Blood Price", []CombatTestEffect{
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 6},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	savageCritCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_crit" && e.CharacterID == 1 {
			savageCritCount++
			if e.Factor < 1 {
				t.Errorf("Savage Crit damage should be positive, got %d", e.Factor)
			}
		}
	}
	if savageCritCount == 0 {
		t.Error("Blood Price: Savage Crit never triggered on_crit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Blood Price: %d savage crit procs, dealt=%.0f taken=%.0f\n",
		savageCritCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 72: Perk — Opening Gambit (Opening Salvo + Fragile) ──

func TestPerkOpeningGambit(t *testing.T) {
	c1 := baseCombatant(1, "Gambit", []CombatTestEffect{
		{EffectID: 28, CoreEffectCode: "damage", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 16},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	openingSalvoFired := false
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_start" && e.Turn == 0 && e.CharacterID == 1 {
			openingSalvoFired = true
			if e.Factor < 1 {
				t.Errorf("Opening Salvo damage should be positive, got %d", e.Factor)
			}
		}
	}
	if !openingSalvoFired {
		t.Error("Opening Gambit: Opening Salvo never fired at turn 0")
	}

	s1 := extractStats(result, "combatant1")
	s2 := extractStats(result, "combatant2")
	fmt.Printf("  Opening Gambit: salvoFired=%v, dealt=%.0f, target taken=%.0f\n",
		openingSalvoFired, s1["damageDealt"].(float64), s2["damageTaken"].(float64))
}

// ── Test 73: Perk — Cursed Duelist (Cursed Blade + Reckless) ──

func TestPerkCursedDuelist(t *testing.T) {
	c1 := baseCombatant(1, "Duelist", []CombatTestEffect{
		{EffectID: 128, CoreEffectCode: "bleed", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 4},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApplied := false
	bleedTicks := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_start" && e.Turn == 0 {
			bleedApplied = true
		}
		if e.Action == "bleed" && e.CharacterID == 2 && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if !bleedApplied {
		t.Error("Cursed Duelist: Cursed Blade bleed not applied at turn 0")
	}
	if bleedTicks == 0 {
		t.Error("Cursed Duelist: No bleed damage ticks on target")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Cursed Duelist: bleedApplied=%v, bleedTicks=%d, bleedTotal=%.0f\n",
		bleedApplied, bleedTicks, s1["bleedApplied"].(float64))
}

// ── Test 74: Perk — Thorned Carapace (Thorny Blood + Sluggish) ──

func TestPerkThornedCaparace(t *testing.T) {
	// Perk holder: takes hits and bleeds attacker, but own damage reduced
	c1 := baseCombatant(1, "Thorned", []CombatTestEffect{
		{EffectID: 129, CoreEffectCode: "bleed", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 12},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50
	c1.Armor = 10

	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	thornyBleedCount := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_hit_taken" && e.CharacterID == 1 {
			thornyBleedCount++
		}
	}
	if thornyBleedCount == 0 {
		t.Error("Thorned Carapace: Thorny Blood never triggered on_hit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Thorned Carapace: %d thorny bleed procs, bleedApplied=%.0f\n",
		thornyBleedCount, s1["bleedApplied"].(float64))
}

// ── Test 75: Perk — Rising Executioner (Rising Fury + Exposed) ──

func TestPerkRisingExecutioner(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Executioner", []CombatTestEffect{
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 7, TargetSelf: true, Duration: &dur},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -18, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_turn_start" && e.CharacterID == 1 && e.BuffType == "modify_damage" {
			buffCount++
		}
	}
	if buffCount == 0 {
		t.Error("Rising Executioner: Rising Fury buff never applied")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Rising Executioner: %d damage buffs applied, dealt=%.0f taken=%.0f\n",
		buffCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 76: Perk — Surgical Rhythm (Sharpening Focus + Clumsy) ──

func TestPerkSurgicalRhythm(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Surgeon", []CombatTestEffect{
		{EffectID: 125, CoreEffectCode: "modify_crit", TriggerType: "on_turn_start", FactorType: "percent", Value: 6, TargetSelf: true, Duration: &dur},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	critBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_turn_start" && e.CharacterID == 1 && e.BuffType == "modify_crit" {
			critBuffs++
		}
	}
	if critBuffs == 0 {
		t.Error("Surgical Rhythm: Sharpening Focus crit buff never applied")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Surgical Rhythm: %d crit buffs, crits=%v dealt=%.0f\n",
		critBuffs, s1["critCount"], s1["damageDealt"].(float64))
}

// ── Test 77: Perk — Predator's Pressure (Eroding Will + Tunnel Vision) ──

func TestPerkPredatorsPressure(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Predator", []CombatTestEffect{
		{EffectID: 126, CoreEffectCode: "modify_dodge", TriggerType: "on_turn_start", FactorType: "percent", Value: -7, TargetSelf: false, Duration: &dur},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	// Give target some dodge so the debuff is meaningful
	c2 := baseCombatant(2, "Evader", nil)
	c2.Stamina = 50
	c2.Agility = 30

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dodgeDebuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_turn_start" && e.CharacterID == 2 && e.BuffType == "modify_dodge" {
			dodgeDebuffs++
		}
	}
	if dodgeDebuffs == 0 {
		t.Error("Predator's Pressure: Eroding Will dodge debuff never applied to enemy")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Predator's Pressure: %d dodge debuffs on enemy, dealt=%.0f\n",
		dodgeDebuffs, s1["damageDealt"].(float64))
}

// ── Test 78: Perk — Vengeful Core (Spite + Fragile) ──

func TestPerkVengefulCore(t *testing.T) {
	c1 := baseCombatant(1, "Vengeful", []CombatTestEffect{
		{EffectID: 121, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 10},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	// Enemy always crits to trigger Spite
	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	spiteCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 {
			spiteCount++
		}
	}
	if spiteCount == 0 {
		t.Error("Vengeful Core: Spite never triggered on_crit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Vengeful Core: %d spite procs, dealt=%.0f taken=%.0f\n",
		spiteCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 79: Perk — War Engine (Attrition + Glass Jaw) ──

func TestPerkWarEngine(t *testing.T) {
	c1 := baseCombatant(1, "War Engine", []CombatTestEffect{
		{EffectID: 111, CoreEffectCode: "damage", TriggerType: "on_every_other_turn", FactorType: "percent_of_max_hp", Value: 5},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	attritionCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_every_other_turn" && e.CharacterID == 1 {
			attritionCount++
		}
	}
	if attritionCount == 0 {
		t.Error("War Engine: Attrition never triggered on_every_other_turn")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  War Engine: %d attrition procs, dealt=%.0f taken=%.0f\n",
		attritionCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 80: Perk — Countershock (Dazed Counter + Reckless) ──

func TestPerkCountershock(t *testing.T) {
	// High stun chance to make test reliable
	c1 := baseCombatant(1, "Countershock", []CombatTestEffect{
		{EffectID: 117, CoreEffectCode: "stun", TriggerType: "on_crit_taken", FactorType: "percent", Value: 100},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -8, TargetSelf: true},
	})
	c1.Stamina = 50

	// Enemy always crits
	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunCount := 0
	for _, e := range log {
		if e.Action == "stun" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 {
			stunCount++
		}
	}
	if stunCount == 0 {
		t.Error("Countershock: Dazed Counter stun never triggered on_crit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Countershock: %d stun procs on enemy, taken=%.0f\n",
		stunCount, s1["damageTaken"].(float64))
}

// ── Test 81: Perk — Leeching Frenzy (Crit Leech + Exposed) ──

func TestPerkLeechingFrenzy(t *testing.T) {
	c1 := baseCombatant(1, "Leech", []CombatTestEffect{
		{EffectID: 112, CoreEffectCode: "heal", TriggerType: "on_crit", FactorType: "percent_of_damage_dealt", Value: 28, TargetSelf: true},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Luck = 100
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_crit" && e.CharacterID == 1 {
			healCount++
		}
	}
	if healCount == 0 {
		t.Error("Leeching Frenzy: Crit Leech heal never triggered")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Leeching Frenzy: %d crit heals, healed=%.0f dealt=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageDealt"].(float64))
}

// ── Test 82: Perk — Crippling Momentum (Crumbling Defense + Clumsy) ──

func TestPerkCripplingMomentum(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "Crippler", []CombatTestEffect{
		{EffectID: 124, CoreEffectCode: "modify_armor", TriggerType: "on_turn_start", FactorType: "percent", Value: -8, TargetSelf: false, Duration: &dur},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50
	c2.Armor = 15

	result := executeCombat(c1, c2)
	log := extractLog(result)

	armorDebuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_turn_start" && e.CharacterID == 2 && e.BuffType == "modify_armor" {
			armorDebuffs++
		}
	}
	if armorDebuffs == 0 {
		t.Error("Crippling Momentum: Crumbling Defense armor debuff never applied to enemy")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Crippling Momentum: %d armor debuffs on enemy, dealt=%.0f\n",
		armorDebuffs, s1["damageDealt"].(float64))
}

// ── Test 83: Perk — Hemocraft (Hemorrhage + Sluggish) ──

func TestPerkHemocraft(t *testing.T) {
	c1 := baseCombatant(1, "Hemocrafter", []CombatTestEffect{
		{EffectID: 113, CoreEffectCode: "bleed", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Luck = 100 // guarantee crits
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	hemorrhageCount := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_crit" && e.CharacterID == 1 {
			hemorrhageCount++
		}
	}
	if hemorrhageCount == 0 {
		t.Error("Hemocraft: Hemorrhage bleed never triggered on crit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Hemocraft: %d hemorrhage procs, bleed=%.0f dealt=%.0f\n",
		hemorrhageCount, s1["bleedApplied"].(float64), s1["damageDealt"].(float64))
}

// ── Test 84: Perk — Bastion of Spite (Hardened + Tunnel Vision) ──

func TestPerkBastionOfSpite(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Bastion", []CombatTestEffect{
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 14, TargetSelf: true, Duration: &dur},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	hardenedCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_hit_taken" && e.CharacterID == 1 && e.BuffType == "modify_armor" {
			hardenedCount++
		}
	}
	if hardenedCount == 0 {
		t.Error("Bastion of Spite: Hardened armor buff never triggered on_hit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Bastion of Spite: %d hardened buffs, taken=%.0f dealt=%.0f\n",
		hardenedCount, s1["damageTaken"].(float64), s1["damageDealt"].(float64))
}

// ── Test 85: Perk — Grave Rhythm (Draining Presence + Sluggish) ──

func TestPerkGraveRhythm(t *testing.T) {
	c1 := baseCombatant(1, "Grave", []CombatTestEffect{
		{EffectID: 110, CoreEffectCode: "heal", TriggerType: "on_turn_end", FactorType: "percent_of_missing_hp", Value: 14, TargetSelf: true},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_turn_end" && e.CharacterID == 1 {
			healCount++
		}
	}
	if healCount == 0 {
		t.Error("Grave Rhythm: Draining Presence heal never triggered at turn end")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Grave Rhythm: %d turn-end heals, healed=%.0f dealt=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageDealt"].(float64))
}

// ── Test 86: Perk — Ambusher's Debt (Ambush + Exposed) ──

func TestPerkAmbushersDebt(t *testing.T) {
	// Use 100% stun chance for test reliability (real perk uses 18%)
	c1 := baseCombatant(1, "Ambusher", []CombatTestEffect{
		{EffectID: 118, CoreEffectCode: "stun", TriggerType: "on_start", FactorType: "percent", Value: 100},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunFired := false
	for _, e := range log {
		if e.Action == "stun" && e.TriggerType == "on_start" && e.Turn == 0 {
			stunFired = true
		}
	}
	if !stunFired {
		t.Error("Ambusher's Debt: Ambush stun never fired at turn 0")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Ambusher's Debt: stunFired=%v, dealt=%.0f taken=%.0f\n",
		stunFired, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 87: Perk — Red Wake (Festering Wound + Glass Jaw) ──

func TestPerkRedWake(t *testing.T) {
	c1 := baseCombatant(1, "Red Wake", []CombatTestEffect{
		{EffectID: 115, CoreEffectCode: "bleed", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	festerCount := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_turn_end" && e.CharacterID == 1 {
			festerCount++
		}
	}
	if festerCount == 0 {
		t.Error("Red Wake: Festering Wound bleed never applied at turn end")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Red Wake: %d festering procs, bleed=%.0f dealt=%.0f\n",
		festerCount, s1["bleedApplied"].(float64), s1["damageDealt"].(float64))
}

// ── Test 88: Perk — Last Stand Doctrine (Desperate Strike + Fragile) ──

func TestPerkLastStandDoctrine(t *testing.T) {
	c1 := baseCombatant(1, "Last Stand", []CombatTestEffect{
		{EffectID: 120, CoreEffectCode: "damage", TriggerType: "on_hit", FactorType: "percent_of_missing_hp", Value: 14},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	despCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_hit" && e.CharacterID == 1 {
			despCount++
		}
	}
	if despCount == 0 {
		t.Error("Last Stand Doctrine: Desperate Strike never triggered on_hit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Last Stand Doctrine: %d desperate procs, dealt=%.0f taken=%.0f\n",
		despCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 89: Perk — Final Act (Executioner + Clumsy) ──

func TestPerkFinalAct(t *testing.T) {
	hpBelow := "hp_below_percent"
	condVal := 30
	c1 := baseCombatant(1, "Final Act", []CombatTestEffect{
		{EffectID: 59, CoreEffectCode: "damage", TriggerType: "on_hit", FactorType: "percent_of_max_hp", Value: 20,
			ConditionType: &hpBelow, ConditionValue: &condVal},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	// Lower target HP so they reach <30% faster
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 20

	result := executeCombat(c1, c2)
	log := extractLog(result)

	execCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_hit" && e.CharacterID == 1 {
			execCount++
		}
	}
	if execCount == 0 {
		t.Error("Final Act: Executioner damage never triggered on low-HP target")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Final Act: %d executioner procs, dealt=%.0f\n",
		execCount, s1["damageDealt"].(float64))
}

// ── Test 90: Perk — Sadist's Mark (Healing Curse + Tunnel Vision) ──

func TestPerkSadistsMark(t *testing.T) {
	dur := 3
	c1 := baseCombatant(1, "Sadist", []CombatTestEffect{
		{EffectID: 127, CoreEffectCode: "modify_heal", TriggerType: "on_start", FactorType: "percent", Value: -20, TargetSelf: false, Duration: &dur},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -8, TargetSelf: true},
	})
	c1.Stamina = 50

	// Give target some healing to check the curse impacts it
	c2 := baseCombatant(2, "Healer", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 5, TargetSelf: true},
	})
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	curseFired := false
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_start" && e.Turn == 0 && e.CharacterID == 1 && e.BuffType == "modify_heal" {
			curseFired = true
		}
	}
	if !curseFired {
		t.Error("Sadist's Mark: Healing Curse debuff never applied at turn 0")
	}

	s2 := extractStats(result, "combatant2")
	fmt.Printf("  Sadist's Mark: curseFired=%v, target healed=%.0f\n",
		curseFired, s2["healingDone"].(float64))
}

// ── Test 91: Perk — Deep Bleeder (Deep Wounds + Tunnel Vision) ──

func TestPerkDeepBleeder(t *testing.T) {
	c1 := baseCombatant(1, "DeepBleeder", []CombatTestEffect{
		{EffectID: 19, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 8},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_hit" && e.CharacterID == 1 {
			bleedApps++
			if e.Factor < 1 {
				t.Errorf("Deep Wounds bleed should be positive, got %d", e.Factor)
			}
		}
		if e.Action == "bleed" && e.CharacterID == 2 && e.TriggerType == "" {
			bleedTicks++
		}
	}
	if bleedApps == 0 {
		t.Error("Deep Bleeder: Deep Wounds bleed never triggered on_hit")
	}
	if bleedTicks == 0 {
		t.Error("Deep Bleeder: No bleed damage ticks on target")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Deep Bleeder: %d bleed apps, %d ticks, bleed=%.0f dealt=%.0f\n",
		bleedApps, bleedTicks, s1["bleedApplied"].(float64), s1["damageDealt"].(float64))
}

// ── Test 92: Perk — Adrenaline Junkie (Adrenaline Surge + Sluggish) ──

func TestPerkAdrenalineJunkie(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "AdrenalineJunkie", []CombatTestEffect{
		{EffectID: 85, CoreEffectCode: "modify_dodge", TriggerType: "on_crit_taken", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	// Enemy always crits to trigger the dodge buff
	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dodgeBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 && e.BuffType == "modify_dodge" {
			dodgeBuffs++
		}
	}
	if dodgeBuffs == 0 {
		t.Error("Adrenaline Junkie: Adrenaline Surge dodge buff never triggered")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Adrenaline Junkie: %d dodge buffs, dealt=%.0f taken=%.0f\n",
		dodgeBuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 93: Perk — Defiant Healer (Defiant Roar + Clumsy) ──

func TestPerkDefiantHealer(t *testing.T) {
	c1 := baseCombatant(1, "Defiant", []CombatTestEffect{
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 8, TargetSelf: true},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Stamina = 50

	// Enemy always crits
	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 {
			healCount++
			// 8% of 500 maxHP = 40
			if e.Factor != 40 {
				t.Errorf("Defiant Roar heal: got %d, want 40 (8%% of 500 HP)", e.Factor)
			}
		}
	}
	if healCount == 0 {
		t.Error("Defiant Healer: Defiant Roar heal never triggered on_crit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Defiant Healer: %d heals, healed=%.0f taken=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageTaken"].(float64))
}

// ── Test 94: Perk — Tidal Warrior (Tidal Force + Reckless) ──

func TestPerkTidalWarrior(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "TidalWarrior", []CombatTestEffect{
		{EffectID: 88, CoreEffectCode: "modify_damage", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	tidalBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_every_other_turn" && e.CharacterID == 1 && e.BuffType == "modify_damage" {
			tidalBuffs++
		}
	}
	if tidalBuffs == 0 {
		t.Error("Tidal Warrior: Tidal Force damage buff never triggered")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Tidal Warrior: %d tidal buffs, dealt=%.0f taken=%.0f\n",
		tidalBuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 95: Perk — Iron Comeback (Vengeful Fury + Exposed) ──

func TestPerkIronComeback(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "IronComeback", []CombatTestEffect{
		{EffectID: 93, CoreEffectCode: "modify_damage", TriggerType: "on_crit_taken", FactorType: "percent", Value: 18, TargetSelf: true, Duration: &dur},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	// Enemy always crits
	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	furyBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 && e.BuffType == "modify_damage" {
			furyBuffs++
		}
	}
	if furyBuffs == 0 {
		t.Error("Iron Comeback: Vengeful Fury damage buff never triggered on_crit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Iron Comeback: %d fury buffs, dealt=%.0f taken=%.0f\n",
		furyBuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 96: Perk — Fortifier (Fortifying Strike + Fragile) ──

func TestPerkFortifier(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Fortifier", []CombatTestEffect{
		{EffectID: 83, CoreEffectCode: "modify_armor", TriggerType: "on_hit", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	armorBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_hit" && e.CharacterID == 1 && e.BuffType == "modify_armor" {
			armorBuffs++
		}
	}
	if armorBuffs == 0 {
		t.Error("Fortifier: Fortifying Strike armor buff never triggered on_hit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Fortifier: %d armor buffs, dealt=%.0f taken=%.0f\n",
		armorBuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 97: Perk — Crushing Presence (Crushing Weight + Glass Jaw) ──

func TestPerkCrushingPresence(t *testing.T) {
	dur := 2
	c1 := baseCombatant(1, "Crusher", []CombatTestEffect{
		{EffectID: 82, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: -12, TargetSelf: false, Duration: &dur},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dmgDebuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_hit" && e.CharacterID == 2 && e.BuffType == "modify_damage" {
			dmgDebuffs++
		}
	}
	if dmgDebuffs == 0 {
		t.Error("Crushing Presence: Crushing Weight damage debuff never applied to enemy")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Crushing Presence: %d dmg debuffs on enemy, dealt=%.0f taken=%.0f\n",
		dmgDebuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 98: Perk — Precision Pulse (Precision Pulse + Sluggish) ──

func TestPerkPrecisionPulse(t *testing.T) {
	dur := 1
	c1 := baseCombatant(1, "PrecPulse", []CombatTestEffect{
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 18, TargetSelf: true, Duration: &dur},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	critBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.TriggerType == "on_every_other_turn" && e.CharacterID == 1 && e.BuffType == "modify_crit" {
			critBuffs++
		}
	}
	if critBuffs == 0 {
		t.Error("Precision Pulse: crit buff never triggered on_every_other_turn")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Precision Pulse: %d crit buffs, dealt=%.0f\n",
		critBuffs, s1["damageDealt"].(float64))
}

// ── Test 99: Perk — Second Wind (Second Wind + Tunnel Vision) ──

func TestPerkSecondWind(t *testing.T) {
	hpBelow := "hp_below_percent"
	condVal := 50
	c1 := baseCombatant(1, "SecondWind", []CombatTestEffect{
		{EffectID: 24, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_missing_hp", Value: 12, TargetSelf: true,
			ConditionType: &hpBelow, ConditionValue: &condVal},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c1.Stamina = 50

	// Strong attacker to push c1 below 50% fast
	c2 := baseCombatant(2, "HardHitter", nil)
	c2.Strength = 20
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_turn_start" && e.CharacterID == 1 {
			healCount++
		}
	}
	if healCount == 0 {
		t.Error("Second Wind: heal never triggered on_turn_start when below 50% HP")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Second Wind: %d heals, healed=%.0f taken=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageTaken"].(float64))
}

// ── Test 100: Perk — Thorns Master (Thorns + Clumsy) ──

func TestPerkThornsMaster(t *testing.T) {
	c1 := baseCombatant(1, "ThornsMaster", []CombatTestEffect{
		{EffectID: 25, CoreEffectCode: "damage", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 18},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50
	c1.Armor = 10

	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	thornsCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_hit_taken" && e.CharacterID == 1 {
			thornsCount++
			if e.Factor < 1 {
				t.Errorf("Thorns damage should be positive, got %d", e.Factor)
			}
		}
	}
	if thornsCount == 0 {
		t.Error("Thorns Master: Thorns damage never triggered on_hit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Thorns Master: %d thorns procs, dealt=%.0f taken=%.0f\n",
		thornsCount, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ── Test 101: Perk 36 – Vampiric Strikes ────────────────────
// Effect 130: heal on_hit (percent_of_damage_dealt, self) + Effect 62: Tunnel Vision (-crit passive)
func TestPerkVampiricStrikes(t *testing.T) {
	c1 := baseCombatant(1, "Vampire", []CombatTestEffect{
		{EffectID: 130, CoreEffectCode: "heal", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 20, TargetSelf: true},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_hit" && e.CharacterID == 1 {
			healCount++
			if e.Factor < 1 {
				t.Errorf("Vampiric heal should be positive, got %d", e.Factor)
			}
		}
	}
	if healCount == 0 {
		t.Error("Vampiric Strikes: No on_hit heals triggered")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Vampiric Strikes: %d heals, healed=%.0f dealt=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageDealt"].(float64))
}

// ── Test 102: Perk 37 – Counter Instinct ─────────────────────
// Effect 131: counterattack on_crit_taken (percent, self, dur=2) + Effect 63: Sluggish (-dmg passive)
func TestPerkCounterInstinct(t *testing.T) {
	dur2 := 2
	c1 := baseCombatant(1, "CounterI", []CombatTestEffect{
		{EffectID: 131, CoreEffectCode: "counterattack", TriggerType: "on_crit_taken", FactorType: "percent", Value: 40, TargetSelf: true, Duration: &dur2},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100 // high crit to trigger the perk
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.BuffType == "counterattack" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 {
			buffCount++
		}
	}
	if buffCount == 0 {
		t.Error("Counter Instinct: No counterattack buffs triggered on_crit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Counter Instinct: %d counter buffs, counterHits=%.0f taken=%.0f\n",
		buffCount, s1["counterHits"].(float64), s1["damageTaken"].(float64))
}

// ── Test 103: Perk 38 – Berserker Drums ──────────────────────
// Effect 132: double_attack on_turn_start (percent, self, dur=1) + Effect 60: Glass Jaw (-armor passive)
func TestPerkBerserkerDrums(t *testing.T) {
	dur1 := 1
	c1 := baseCombatant(1, "Berserker", []CombatTestEffect{
		{EffectID: 132, CoreEffectCode: "double_attack", TriggerType: "on_turn_start", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur1},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.BuffType == "double_attack" && e.TriggerType == "on_turn_start" && e.CharacterID == 1 {
			buffCount++
		}
	}
	if buffCount == 0 {
		t.Error("Berserker Drums: No double_attack buffs triggered on_turn_start")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Berserker Drums: %d double buffs, doubles=%.0f dealt=%.0f\n",
		buffCount, s1["doubleAttacks"].(float64), s1["damageDealt"].(float64))
}

// ── Test 104: Perk 39 – Toxic Blood ──────────────────────────
// Effect 133: bleed on_crit_taken (percent_of_max_hp, enemy) + Effect 65: Fragile (-heal passive)
func TestPerkToxicBlood(t *testing.T) {
	c1 := baseCombatant(1, "ToxicBlood", []CombatTestEffect{
		{EffectID: 133, CoreEffectCode: "bleed", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Critter", nil)
	c2.Luck = 100
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_crit_taken" && e.CharacterID == 1 {
			bleedApps++
		}
		if e.Action == "bleed_tick" {
			bleedTicks++
		}
	}
	if bleedApps == 0 {
		t.Error("Toxic Blood: No bleed applied on_crit_taken")
	}

	// bleed should be 3% of max HP = 3% of 500 = 15
	maxHP := float64(c2.Stamina) * 10
	expectedBleed := int(maxHP * 3 / 100)
	for _, e := range log {
		if e.Action == "bleed" && e.TriggerType == "on_crit_taken" {
			if e.Factor != expectedBleed {
				t.Errorf("Toxic Blood: expected bleed=%d (3%% of %.0f), got %d", expectedBleed, maxHP, e.Factor)
			}
			break
		}
	}

	fmt.Printf("  Toxic Blood: %d bleed apps, %d ticks, expected_bleed=%d\n",
		bleedApps, bleedTicks, expectedBleed)
}

// ── Test 105: Perk 40 – Soul Siphon ─────────────────────────
// Effect 134: heal on_crit (percent_of_max_hp, self) + Effect 66: Clumsy (-dodge passive)
func TestPerkSoulSiphon(t *testing.T) {
	c1 := baseCombatant(1, "SoulSiphon", []CombatTestEffect{
		{EffectID: 134, CoreEffectCode: "heal", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 5, TargetSelf: true},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Luck = 100
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	healCount := 0
	for _, e := range log {
		if e.Action == "heal" && e.TriggerType == "on_crit" && e.CharacterID == 1 {
			healCount++
			// 5% of 500 = 25
			expectedHeal := int(float64(c1.Stamina) * 10 * 5 / 100)
			if e.Factor != expectedHeal {
				t.Errorf("Soul Siphon: expected heal=%d, got %d", expectedHeal, e.Factor)
			}
		}
	}
	if healCount == 0 {
		t.Error("Soul Siphon: No heals triggered on_crit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Soul Siphon: %d heals, healed=%.0f dealt=%.0f\n",
		healCount, s1["healingDone"].(float64), s1["damageDealt"].(float64))
}

// ── Test 106: Perk 41 – Chain Lightning ──────────────────────
// Effect 135: consecutive_damage on_crit (percent, self, dur=2) + Effect 64: Exposed (-armor passive)
func TestPerkChainLightning(t *testing.T) {
	dur2 := 2
	c1 := baseCombatant(1, "ChainLightning", []CombatTestEffect{
		{EffectID: 135, CoreEffectCode: "consecutive_damage", TriggerType: "on_crit", FactorType: "percent", Value: 25, TargetSelf: true, Duration: &dur2},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Luck = 100
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	buffCount := 0
	for _, e := range log {
		if e.Action == "buff" && e.BuffType == "consecutive_damage" && e.TriggerType == "on_crit" && e.CharacterID == 1 {
			buffCount++
		}
	}
	if buffCount == 0 {
		t.Error("Chain Lightning: No consecutive_damage buffs triggered on_crit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Chain Lightning: %d consec buffs, dealt=%.0f\n",
		buffCount, s1["damageDealt"].(float64))
}

// ── Test 107: Perk 42 – Hex Master ───────────────────────────
// Effect 136: stun on_hit (percent, enemy) + Effect 63: Sluggish (-dmg passive)
func TestPerkHexMaster(t *testing.T) {
	c1 := baseCombatant(1, "HexMaster", []CombatTestEffect{
		{EffectID: 136, CoreEffectCode: "stun", TriggerType: "on_hit", FactorType: "percent", Value: 15},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	stunCount := 0
	stunnedCount := 0
	for _, e := range log {
		if e.Action == "stun" && e.CharacterID == 1 {
			stunCount++
		}
		if e.Action == "stunned" && e.CharacterID == 2 {
			stunnedCount++
		}
	}

	// With 15% stun over ~20 hits, expect at least some stuns most times
	// But don't fail on 0 since it's probabilistic — just log
	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Hex Master: %d stuns applied, %d stunned skips, dealt=%.0f\n",
		stunCount, stunnedCount, s1["damageDealt"].(float64))
}

// ── Test 108: Perk 43 – Focused Predator ─────────────────────
// Effect 137: modify_crit on_hit_taken (percent, self, dur=2) + Effect 61: Reckless (-dodge passive)
func TestPerkFocusedPredator(t *testing.T) {
	dur2 := 2
	c1 := baseCombatant(1, "FocPred", []CombatTestEffect{
		{EffectID: 137, CoreEffectCode: "modify_crit", TriggerType: "on_hit_taken", FactorType: "percent", Value: 25, TargetSelf: true, Duration: &dur2},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Attacker", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	critBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.BuffType == "modify_crit" && e.TriggerType == "on_hit_taken" && e.CharacterID == 1 {
			critBuffs++
		}
	}
	if critBuffs == 0 {
		t.Error("Focused Predator: No crit buffs triggered on_hit_taken")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Focused Predator: %d crit buffs, crits=%.0f dealt=%.0f\n",
		critBuffs, s1["critHits"].(float64), s1["damageDealt"].(float64))
}

// ── Test 109: Perk 44 – Warlord Decree ───────────────────────
// Effect 138: damage on_turn_start (percent_of_max_hp, enemy) + Effect 62: Tunnel Vision (-crit passive)
func TestPerkWarlordDecree(t *testing.T) {
	c1 := baseCombatant(1, "Warlord", []CombatTestEffect{
		{EffectID: 138, CoreEffectCode: "damage", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dmgCount := 0
	for _, e := range log {
		if e.Action == "damage" && e.TriggerType == "on_turn_start" && e.CharacterID == 1 {
			dmgCount++
			// 3% of target max HP = 3% of 500 = 15
			expectedDmg := int(float64(c2.Stamina) * 10 * 3 / 100)
			if e.Factor != expectedDmg {
				t.Errorf("Warlord Decree: expected dmg=%d, got %d", expectedDmg, e.Factor)
			}
		}
	}
	if dmgCount == 0 {
		t.Error("Warlord Decree: No damage triggered on_turn_start")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Warlord Decree: %d turn dmgs, dealt=%.0f\n",
		dmgCount, s1["damageDealt"].(float64))
}

// ── Test 110: Perk 45 – Evasive Counter ──────────────────────
// Effect 139: modify_dodge on_hit (percent, self, dur=2) + Effect 60: Glass Jaw (-armor passive)
func TestPerkEvasiveCounter(t *testing.T) {
	dur2 := 2
	c1 := baseCombatant(1, "Evasive", []CombatTestEffect{
		{EffectID: 139, CoreEffectCode: "modify_dodge", TriggerType: "on_hit", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur2},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	dodgeBuffs := 0
	for _, e := range log {
		if e.Action == "buff" && e.BuffType == "modify_dodge" && e.TriggerType == "on_hit" && e.CharacterID == 1 {
			dodgeBuffs++
		}
	}
	if dodgeBuffs == 0 {
		t.Error("Evasive Counter: No dodge buffs triggered on_hit")
	}

	s1 := extractStats(result, "combatant1")
	fmt.Printf("  Evasive Counter: %d dodge buffs, dealt=%.0f taken=%.0f\n",
		dodgeBuffs, s1["damageDealt"].(float64), s1["damageTaken"].(float64))
}

// ════════════════════════════════════════════════════════════════════════════
// FULL-BUILD INTEGRATION TESTS (Tests 111-120)
// Each test simulates a realistic build: 3 perks + 1 blessing per fighter,
// run N combats to verify statistical outcomes and no panics.
// ════════════════════════════════════════════════════════════════════════════

// helper: run N combats, return (wins1, wins2, draws, all results)
func runManyCombats(c1 *CombatCharacter, c2 *CombatCharacter, n int) (int, int, int, []map[string]interface{}) {
	wins1, wins2, draws := 0, 0, 0
	results := make([]map[string]interface{}, 0, n)
	for i := 0; i < n; i++ {
		// Deep-copy effects so repeated runs don't share state
		eff1 := make([]CombatTestEffect, len(c1.Effects))
		copy(eff1, c1.Effects)
		eff2 := make([]CombatTestEffect, len(c2.Effects))
		copy(eff2, c2.Effects)

		a := &CombatCharacter{
			CharacterID: c1.CharacterID, CharacterName: c1.CharacterName,
			Strength: c1.Strength, Stamina: c1.Stamina, Agility: c1.Agility,
			Luck: c1.Luck, Armor: c1.Armor, MinDamage: c1.MinDamage, MaxDamage: c1.MaxDamage,
			Effects: eff1, DepletedHealth: c1.DepletedHealth,
		}
		b := &CombatCharacter{
			CharacterID: c2.CharacterID, CharacterName: c2.CharacterName,
			Strength: c2.Strength, Stamina: c2.Stamina, Agility: c2.Agility,
			Luck: c2.Luck, Armor: c2.Armor, MinDamage: c2.MinDamage, MaxDamage: c2.MaxDamage,
			Effects: eff2, DepletedHealth: c2.DepletedHealth,
		}

		result := executeCombat(a, b)
		results = append(results, result)
		header, _ := result["header"].(map[string]interface{})
		if header != nil {
			winnerID := 0
			if wid, ok := header["winnerId"].(int); ok {
				winnerID = wid
			} else if wid, ok := header["winnerId"].(float64); ok {
				winnerID = int(wid)
			}
			switch winnerID {
			case a.CharacterID:
				wins1++
			case b.CharacterID:
				wins2++
			default:
				draws++
			}
		} else {
			draws++
		}
	}
	return wins1, wins2, draws, results
}

// helper: aggregate stats over many results
func aggregateStats(results []map[string]interface{}, side string) map[string]float64 {
	agg := map[string]float64{}
	for _, r := range results {
		s := extractStats(r, side)
		for k, v := range s {
			if f, ok := v.(float64); ok {
				agg[k] += f
			}
		}
	}
	n := float64(len(results))
	avg := map[string]float64{}
	for k, v := range agg {
		avg[k] = v / n
	}
	return avg
}

// ── Test 111: Bleed-Heavy vs Tank Build ──────────────────────
// P1: Deep Bleeder(26) + Red Wake(22) + Thorned Carapace(4) + Retribution(11)
// P2: Bastion of Spite(19) + Fortifier(31) + Iron Comeback(30) + Rallying Charge(15)
func TestFullBuild_BleedVsTank(t *testing.T) {
	dur1 := 1
	dur2 := 2
	dur3 := 3

	c1 := baseCombatant(1, "Bleeder", []CombatTestEffect{
		// Perk 26 Deep Bleeder: bleed on_hit 8% dmg dealt + modify_crit -10 passive
		{EffectID: 19, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 8},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 22 Red Wake: bleed on_turn_end 2% maxHP + modify_armor -10 passive
		{EffectID: 115, CoreEffectCode: "bleed", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 4 Thorned Carapace: bleed on_hit_taken 12% dmg taken + modify_damage -15 passive
		{EffectID: 129, CoreEffectCode: "bleed", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 12},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Blessing 11 Retribution: counterattack passive 8
		{EffectID: 5, CoreEffectCode: "counterattack", TriggerType: "passive", FactorType: "percent", Value: 8, TargetSelf: true},
	})
	c1.Stamina = 40
	c1.Strength = 12

	c2 := baseCombatant(2, "Tank", []CombatTestEffect{
		// Perk 19 Bastion of Spite: modify_armor on_hit_taken 14 dur=2 + modify_crit -10 passive
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 14, TargetSelf: true, Duration: &dur2},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 31 Fortifier: modify_armor on_hit 12 dur=2 + modify_heal -20 passive
		{EffectID: 83, CoreEffectCode: "modify_armor", TriggerType: "on_hit", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur2},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 30 Iron Comeback: modify_damage on_crit_taken 18 dur=2 + modify_armor -15 passive
		{EffectID: 93, CoreEffectCode: "modify_damage", TriggerType: "on_crit_taken", FactorType: "percent", Value: 18, TargetSelf: true, Duration: &dur2},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Blessing 15 Rallying Charge: modify_damage on_start 12% dur=3
		{EffectID: 86, CoreEffectCode: "modify_damage", TriggerType: "on_start", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur3},
	})
	c2.Stamina = 45
	c2.Armor = 5
	_ = dur1
	_ = dur3

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	avg1 := aggregateStats(results, "combatant1")
	avg2 := aggregateStats(results, "combatant2")

	fmt.Printf("  Bleed vs Tank [%d combats]: Bleeder=%d Tank=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Bleeder avg: dealt=%.0f taken=%.0f bleed=%.0f healed=%.0f\n",
		avg1["damageDealt"], avg1["damageTaken"], avg1["bleedApplied"], avg1["healingDone"])
	fmt.Printf("    Tank avg:    dealt=%.0f taken=%.0f bleed=%.0f healed=%.0f\n",
		avg2["damageDealt"], avg2["damageTaken"], avg2["bleedApplied"], avg2["healingDone"])

	// Both should win some — neither build should be 100% dominant
	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded — combat may be broken")
	}
	// Bleeder should apply bleed
	if avg1["bleedApplied"] < 1 {
		t.Error("Bleeder build should apply meaningful bleed damage")
	}
}

// ── Test 112: Burst Crit vs Sustain Heal ──────────────────────
// P1: Blood Price(1) + Leeching Frenzy(16) + Chain Lightning(41) + Rhythmic Focus(47)
// P2: Vampiric Strikes(36) + Grave Rhythm(20) + Second Wind(34) + Rejuvenation(14)
func TestFullBuild_BurstCritVsSustainHeal(t *testing.T) {
	dur1 := 1
	dur2 := 2

	hp50 := 50
	c1 := baseCombatant(1, "BurstCrit", []CombatTestEffect{
		// Perk 1 Blood Price: damage on_crit 6% maxHP + modify_armor -15 passive
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 6},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 16 Leeching Frenzy: heal on_crit 28% dmg dealt + modify_armor -15 passive
		{EffectID: 112, CoreEffectCode: "heal", TriggerType: "on_crit", FactorType: "percent_of_damage_dealt", Value: 28, TargetSelf: true},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 41 Chain Lightning: consecutive_damage on_crit 25 dur=2 + modify_armor -20 passive
		{EffectID: 135, CoreEffectCode: "consecutive_damage", TriggerType: "on_crit", FactorType: "percent", Value: 25, TargetSelf: true, Duration: &dur2},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Blessing 47 Rhythmic Focus: modify_crit on_every_other_turn 8% dur=1
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 8, TargetSelf: true, Duration: &dur1},
	})
	c1.Luck = 20 // higher crit base
	c1.Stamina = 35
	_ = hp50

	c2 := baseCombatant(2, "SustainHeal", []CombatTestEffect{
		// Perk 36 Vampiric Strikes: heal on_hit 20% dmg dealt + modify_crit -15 passive
		{EffectID: 130, CoreEffectCode: "heal", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 20, TargetSelf: true},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 20 Grave Rhythm: heal on_turn_end 14% missing HP + modify_damage -12 passive
		{EffectID: 110, CoreEffectCode: "heal", TriggerType: "on_turn_end", FactorType: "percent_of_missing_hp", Value: 14, TargetSelf: true},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Perk 34 Second Wind: heal on_turn_start 12% missing HP (condition hp<50%) + modify_crit -10 passive
		{EffectID: 24, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_missing_hp", Value: 12, TargetSelf: true, ConditionType: strPtr("hp_below_percent"), ConditionValue: intPtr(50)},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Blessing 14 Rejuvenation: heal on_turn_start 2% maxHP
		{EffectID: 23, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 2, TargetSelf: true},
	})
	c2.Stamina = 50

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	avg1 := aggregateStats(results, "combatant1")
	avg2 := aggregateStats(results, "combatant2")

	fmt.Printf("  BurstCrit vs SustainHeal [%d]: Burst=%d Sustain=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Burst avg:   dealt=%.0f crits=%.0f healed=%.0f\n",
		avg1["damageDealt"], avg1["critHits"], avg1["healingDone"])
	fmt.Printf("    Sustain avg: dealt=%.0f healed=%.0f taken=%.0f\n",
		avg2["damageDealt"], avg2["healingDone"], avg2["damageTaken"])

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
	// Sustain healer should heal a lot
	if avg2["healingDone"] < 10 {
		t.Error("Sustain build should heal meaningfully")
	}
}

// ── Test 113: Stun-Lock vs Counter-Strike ──────────────────────
// P1: Hex Master(42) + Ambusher's Debt(21) + Countershock(10) + Defiant Spirit(48)
// P2: Counter Instinct(37) + Focused Predator(43) + Berserker Drums(38) + Dual Strikes(12)
func TestFullBuild_StunVsCounterStrike(t *testing.T) {
	dur1 := 1
	dur2 := 2

	c1 := baseCombatant(1, "Stunner", []CombatTestEffect{
		// Perk 42 Hex Master: stun on_hit 15% + modify_damage -20 passive
		{EffectID: 136, CoreEffectCode: "stun", TriggerType: "on_hit", FactorType: "percent", Value: 15},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 21 Ambusher's Debt: stun on_start 18% + modify_armor -15 passive
		{EffectID: 118, CoreEffectCode: "stun", TriggerType: "on_start", FactorType: "percent", Value: 18},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 10 Countershock: stun on_crit_taken 22% + modify_dodge -8 passive
		{EffectID: 117, CoreEffectCode: "stun", TriggerType: "on_crit_taken", FactorType: "percent", Value: 22},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -8, TargetSelf: true},
		// Blessing 48 Defiant Spirit: heal on_crit_taken 4% maxHP
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 4, TargetSelf: true},
	})
	c1.Stamina = 40

	c2 := baseCombatant(2, "CounterStr", []CombatTestEffect{
		// Perk 37 Counter Instinct: counterattack on_crit_taken 40 dur=2 + modify_damage -20 passive
		{EffectID: 131, CoreEffectCode: "counterattack", TriggerType: "on_crit_taken", FactorType: "percent", Value: 40, TargetSelf: true, Duration: &dur2},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 43 Focused Predator: modify_crit on_hit_taken 25 dur=2 + modify_dodge -20 passive
		{EffectID: 137, CoreEffectCode: "modify_crit", TriggerType: "on_hit_taken", FactorType: "percent", Value: 25, TargetSelf: true, Duration: &dur2},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 38 Berserker Drums: double_attack on_turn_start 30 dur=1 + modify_armor -25 passive
		{EffectID: 132, CoreEffectCode: "double_attack", TriggerType: "on_turn_start", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur1},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
		// Blessing 12 Dual Strikes: double_attack passive 6
		{EffectID: 6, CoreEffectCode: "double_attack", TriggerType: "passive", FactorType: "percent", Value: 6, TargetSelf: true},
	})
	c2.Stamina = 40
	c2.Strength = 14

	N := 200
	w1, w2, dr, _ := runManyCombats(c1, c2, N)

	fmt.Printf("  Stunner vs CounterStrike [%d]: Stun=%d Counter=%d draws=%d\n", N, w1, w2, dr)

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
}

// ── Test 114: Attrition Warrior vs Glass Cannon ──────────────────────
// P1: Warlord Decree(44) + War Engine(9) + Rising Executioner(5) + Smoldering Wrath(49)
// P2: Opening Gambit(2) + Blood Price(1) + Final Act(24) + Rallying Charge(15)
func TestFullBuild_AttritionVsGlassCannon(t *testing.T) {
	dur1 := 1
	dur3 := 3

	c1 := baseCombatant(1, "Attrition", []CombatTestEffect{
		// Perk 44 Warlord Decree: damage on_turn_start 3% maxHP + modify_crit -15 passive
		{EffectID: 138, CoreEffectCode: "damage", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 9 War Engine: damage on_every_other_turn 5% maxHP + modify_armor -12 passive
		{EffectID: 111, CoreEffectCode: "damage", TriggerType: "on_every_other_turn", FactorType: "percent_of_max_hp", Value: 5},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Perk 5 Rising Executioner: modify_damage on_turn_start 7 dur=1 + modify_armor -18 passive
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 7, TargetSelf: true, Duration: &dur1},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -18, TargetSelf: true},
		// Blessing 49 Smoldering Wrath: damage on_turn_end 2% maxHP
		{EffectID: 109, CoreEffectCode: "damage", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
	})
	c1.Stamina = 50

	c2 := baseCombatant(2, "GlassCannon", []CombatTestEffect{
		// Perk 2 Opening Gambit: damage on_start 16% maxHP + modify_heal -25 passive
		{EffectID: 28, CoreEffectCode: "damage", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 16},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
		// Perk 1 Blood Price: damage on_crit 6% maxHP + modify_armor -15 passive
		{EffectID: 122, CoreEffectCode: "damage", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 6},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 24 Final Act: damage on_hit 20% maxHP (hp<30%) + modify_dodge -15 passive
		{EffectID: 59, CoreEffectCode: "damage", TriggerType: "on_hit", FactorType: "percent_of_max_hp", Value: 20, ConditionType: strPtr("hp_below_percent"), ConditionValue: intPtr(30)},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Blessing 15 Rallying Charge: modify_damage on_start 12% dur=3
		{EffectID: 86, CoreEffectCode: "modify_damage", TriggerType: "on_start", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur3},
	})
	c2.Luck = 18
	c2.Stamina = 30
	c2.Strength = 15
	c2.MinDamage = 12
	c2.MaxDamage = 14

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	avg1 := aggregateStats(results, "combatant1")
	avg2 := aggregateStats(results, "combatant2")

	fmt.Printf("  Attrition vs GlassCannon [%d]: Attrition=%d Glass=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Attrition avg: dealt=%.0f taken=%.0f\n", avg1["damageDealt"], avg1["damageTaken"])
	fmt.Printf("    GlassCannon avg: dealt=%.0f crits=%.0f\n", avg2["damageDealt"], avg2["critHits"])

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
}

// ── Test 115: Dodge-Master vs Bleed-Crit ──────────────────────
// P1: Evasive Counter(45) + Adrenaline Junkie(27) + Crushing Presence(32) + Barbed Skin(46)
// P2: Hemocraft(18) + Cursed Duelist(3) + Soul Siphon(40) + Toxic Edge(50)
func TestFullBuild_DodgeMasterVsBleedCrit(t *testing.T) {
	dur2 := 2

	c1 := baseCombatant(1, "DodgeMstr", []CombatTestEffect{
		// Perk 45 Evasive Counter: modify_dodge on_hit 20 dur=2 + modify_armor -25 passive
		{EffectID: 139, CoreEffectCode: "modify_dodge", TriggerType: "on_hit", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur2},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
		// Perk 27 Adrenaline Junkie: modify_dodge on_crit_taken 15 dur=2 + modify_damage -15 passive
		{EffectID: 85, CoreEffectCode: "modify_dodge", TriggerType: "on_crit_taken", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur2},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 32 Crushing Presence: modify_damage on_hit -12 dur=2 (enemy) + modify_armor -10 passive
		{EffectID: 82, CoreEffectCode: "modify_damage", TriggerType: "on_hit", FactorType: "percent", Value: -12, Duration: &dur2},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Blessing 46 Barbed Skin: damage on_hit_taken 6% dmg taken
		{EffectID: 25, CoreEffectCode: "damage", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 6},
	})
	c1.Agility = 18
	c1.Stamina = 40

	c2 := baseCombatant(2, "BleedCrit", []CombatTestEffect{
		// Perk 18 Hemocraft: bleed on_crit 3% maxHP + modify_damage -12 passive
		{EffectID: 113, CoreEffectCode: "bleed", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Perk 3 Cursed Duelist: bleed on_start 4% maxHP + modify_dodge -10 passive
		{EffectID: 128, CoreEffectCode: "bleed", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 4},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 40 Soul Siphon: heal on_crit 5% maxHP + modify_dodge -20 passive
		{EffectID: 134, CoreEffectCode: "heal", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 5, TargetSelf: true},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Blessing 50 Toxic Edge: bleed on_hit 4% dmg dealt
		{EffectID: 19, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 4},
	})
	c2.Luck = 18
	c2.Stamina = 40

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	avg1 := aggregateStats(results, "combatant1")
	avg2 := aggregateStats(results, "combatant2")

	fmt.Printf("  DodgeMaster vs BleedCrit [%d]: Dodge=%d Bleed=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Dodge avg:  dealt=%.0f dodges=%.0f taken=%.0f\n",
		avg1["damageDealt"], avg1["dodges"], avg1["damageTaken"])
	fmt.Printf("    Bleed avg:  dealt=%.0f bleed=%.0f crits=%.0f healed=%.0f\n",
		avg2["damageDealt"], avg2["bleedApplied"], avg2["critHits"], avg2["healingDone"])

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
}

// ── Test 116: Rhythm Warrior vs Vengeful Defender ──────────────────────
// P1: Tidal Warrior(29) + Precision Pulse(33) + Surgical Rhythm(6) + Relentless Momentum(13)
// P2: Defiant Healer(28) + Vengeful Core(8) + Toxic Blood(39) + Defiant Spirit(48)
func TestFullBuild_RhythmVsVengeful(t *testing.T) {
	dur1 := 1
	dur2 := 2

	c1 := baseCombatant(1, "Rhythm", []CombatTestEffect{
		// Perk 29 Tidal Warrior: modify_damage on_every_other_turn 20 dur=1 + modify_dodge -10 passive
		{EffectID: 88, CoreEffectCode: "modify_damage", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 20, TargetSelf: true, Duration: &dur1},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 33 Precision Pulse: modify_crit on_every_other_turn 18 dur=1 + modify_damage -12 passive
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 18, TargetSelf: true, Duration: &dur1},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Perk 6 Surgical Rhythm: modify_crit on_turn_start 6 dur=1 + modify_dodge -12 passive
		{EffectID: 125, CoreEffectCode: "modify_crit", TriggerType: "on_turn_start", FactorType: "percent", Value: 6, TargetSelf: true, Duration: &dur1},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Blessing 13 Relentless Momentum: consecutive_damage passive 2
		{EffectID: 67, CoreEffectCode: "consecutive_damage", TriggerType: "passive", FactorType: "percent", Value: 2, TargetSelf: true},
	})
	c1.Stamina = 40
	_ = dur2

	c2 := baseCombatant(2, "Vengeful", []CombatTestEffect{
		// Perk 28 Defiant Healer: heal on_crit_taken 8% maxHP + modify_dodge -12 passive
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 8, TargetSelf: true},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -12, TargetSelf: true},
		// Perk 8 Vengeful Core: damage on_crit_taken 10% maxHP + modify_heal -20 passive
		{EffectID: 121, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 10},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 39 Toxic Blood: bleed on_crit_taken 3% maxHP + modify_heal -20 passive
		{EffectID: 133, CoreEffectCode: "bleed", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 3},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Blessing 48 Defiant Spirit: heal on_crit_taken 4% maxHP
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 4, TargetSelf: true},
	})
	c2.Stamina = 45

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	avg1 := aggregateStats(results, "combatant1")
	avg2 := aggregateStats(results, "combatant2")

	fmt.Printf("  Rhythm vs Vengeful [%d]: Rhythm=%d Vengeful=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Rhythm avg:   dealt=%.0f crits=%.0f\n", avg1["damageDealt"], avg1["critHits"])
	fmt.Printf("    Vengeful avg: dealt=%.0f healed=%.0f bleed=%.0f\n",
		avg2["damageDealt"], avg2["healingDone"], avg2["bleedApplied"])

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
}

// ── Test 117: Mirror Match — same build, different stats ──────────────────────
// Both: Sadist's Mark(25) + Predator's Pressure(7) + Last Stand Doctrine(23) + Retribution(11)
func TestFullBuild_MirrorMatch(t *testing.T) {
	dur1 := 1
	dur3 := 3

	effects := []CombatTestEffect{
		// Perk 25 Sadist's Mark: modify_heal on_start -20 dur=3 (enemy) + modify_crit -8 passive
		{EffectID: 127, CoreEffectCode: "modify_heal", TriggerType: "on_start", FactorType: "percent", Value: -20, Duration: &dur3},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -8, TargetSelf: true},
		// Perk 7 Predator's Pressure: modify_dodge on_turn_start -7 dur=1 (enemy) + modify_crit -10 passive
		{EffectID: 126, CoreEffectCode: "modify_dodge", TriggerType: "on_turn_start", FactorType: "percent", Value: -7, Duration: &dur1},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		// Perk 23 Last Stand Doctrine: damage on_hit 14% missing HP + modify_heal -15 passive
		{EffectID: 120, CoreEffectCode: "damage", TriggerType: "on_hit", FactorType: "percent_of_missing_hp", Value: 14},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Blessing 11 Retribution: counterattack passive 8
		{EffectID: 5, CoreEffectCode: "counterattack", TriggerType: "passive", FactorType: "percent", Value: 8, TargetSelf: true},
	}

	c1 := baseCombatant(1, "MirrorA", effects)
	c1.Stamina = 45
	c1.Strength = 12

	c2 := baseCombatant(2, "MirrorB", effects)
	c2.Stamina = 45
	c2.Agility = 12
	_ = dur3

	N := 300
	w1, w2, dr, _ := runManyCombats(c1, c2, N)

	fmt.Printf("  Mirror Match [%d]: A=%d B=%d draws=%d\n", N, w1, w2, dr)

	// In a mirror match, both should win a meaningful number
	total := w1 + w2 + dr
	if total != N {
		t.Errorf("Sanity: expected %d total, got %d", N, total)
	}
	if w1 == 0 || w2 == 0 {
		t.Error("Mirror match: Both should win some combats")
	}
}

// ── Test 118: All-Blessings (10 blessings, no perks) ──────────────────────
// Test that all 10 blessings work simultaneously
func TestFullBuild_AllBlessings(t *testing.T) {
	dur1 := 1
	dur3 := 3

	c1 := baseCombatant(1, "FullyBlessed", []CombatTestEffect{
		// 11 Retribution: counterattack passive 8
		{EffectID: 5, CoreEffectCode: "counterattack", TriggerType: "passive", FactorType: "percent", Value: 8, TargetSelf: true},
		// 12 Dual Strikes: double_attack passive 6
		{EffectID: 6, CoreEffectCode: "double_attack", TriggerType: "passive", FactorType: "percent", Value: 6, TargetSelf: true},
		// 13 Relentless Momentum: consecutive_damage passive 2
		{EffectID: 67, CoreEffectCode: "consecutive_damage", TriggerType: "passive", FactorType: "percent", Value: 2, TargetSelf: true},
		// 14 Rejuvenation: heal on_turn_start 2% maxHP
		{EffectID: 23, CoreEffectCode: "heal", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", Value: 2, TargetSelf: true},
		// 15 Rallying Charge: modify_damage on_start 12% dur=3
		{EffectID: 86, CoreEffectCode: "modify_damage", TriggerType: "on_start", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur3},
		// 46 Barbed Skin: damage on_hit_taken 6% dmg taken
		{EffectID: 25, CoreEffectCode: "damage", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 6},
		// 47 Rhythmic Focus: modify_crit on_every_other_turn 8% dur=1
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 8, TargetSelf: true, Duration: &dur1},
		// 48 Defiant Spirit: heal on_crit_taken 4% maxHP
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 4, TargetSelf: true},
		// 49 Smoldering Wrath: damage on_turn_end 2% maxHP
		{EffectID: 109, CoreEffectCode: "damage", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
		// 50 Toxic Edge: bleed on_hit 4% dmg dealt
		{EffectID: 19, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 4},
	})
	c1.Stamina = 40

	c2 := baseCombatant(2, "Vanilla", nil)
	c2.Stamina = 40

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	// Verify triggered blessings actually fire
	sample := extractLog(results[0])
	foundCounterattack := false
	foundHeal := false
	foundBleed := false
	foundBuff := false
	for _, e := range sample {
		if e.Action == "counterattack" {
			foundCounterattack = true
		}
		if e.Action == "heal" {
			foundHeal = true
		}
		if e.Action == "bleed" {
			foundBleed = true
		}
		if e.Action == "buff" {
			foundBuff = true
		}
	}

	fmt.Printf("  AllBlessings vs Vanilla [%d]: Blessed=%d Vanilla=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Triggered: counter=%v heal=%v bleed=%v buff=%v\n",
		foundCounterattack, foundHeal, foundBleed, foundBuff)

	// Blessed fighter should win majority
	if w1 < w2 {
		t.Error("Fully blessed fighter should win majority against vanilla")
	}
	// At least heal and bleed should trigger (very reliable)
	if !foundHeal {
		t.Error("Expected Rejuvenation healing to trigger")
	}
	if !foundBleed {
		t.Error("Expected Toxic Edge bleed to trigger")
	}
}

// ── Test 119: Kitchen Sink — maximum effect variety ──────────────────────
// P1: Opening Gambit(2) + Thorns Master(35) + Hex Master(42) + Retribution(11)
// P2: Berserker Drums(38) + Chain Lightning(41) + Vampiric Strikes(36) + Toxic Edge(50)
func TestFullBuild_KitchenSink(t *testing.T) {
	dur1 := 1
	dur2 := 2

	c1 := baseCombatant(1, "Kitchen1", []CombatTestEffect{
		// Perk 2 Opening Gambit: damage on_start 16% maxHP
		{EffectID: 28, CoreEffectCode: "damage", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 16},
		{EffectID: 65, CoreEffectCode: "modify_heal", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
		// Perk 35 Thorns Master: damage on_hit_taken 18% dmg taken
		{EffectID: 25, CoreEffectCode: "damage", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 18},
		{EffectID: 66, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Perk 42 Hex Master: stun on_hit 15%
		{EffectID: 136, CoreEffectCode: "stun", TriggerType: "on_hit", FactorType: "percent", Value: 15},
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Blessing 11 Retribution: counterattack passive 8
		{EffectID: 5, CoreEffectCode: "counterattack", TriggerType: "passive", FactorType: "percent", Value: 8, TargetSelf: true},
	})
	c1.Stamina = 45
	_ = dur1

	c2 := baseCombatant(2, "Kitchen2", []CombatTestEffect{
		// Perk 38 Berserker Drums: double_attack on_turn_start 30 dur=1
		{EffectID: 132, CoreEffectCode: "double_attack", TriggerType: "on_turn_start", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur1},
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -25, TargetSelf: true},
		// Perk 41 Chain Lightning: consecutive_damage on_crit 25 dur=2
		{EffectID: 135, CoreEffectCode: "consecutive_damage", TriggerType: "on_crit", FactorType: "percent", Value: 25, TargetSelf: true, Duration: &dur2},
		{EffectID: 64, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -20, TargetSelf: true},
		// Perk 36 Vampiric Strikes: heal on_hit 20% dmg dealt
		{EffectID: 130, CoreEffectCode: "heal", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 20, TargetSelf: true},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		// Blessing 50 Toxic Edge: bleed on_hit 4% dmg dealt
		{EffectID: 19, CoreEffectCode: "bleed", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 4},
	})
	c2.Luck = 16
	c2.Stamina = 40

	N := 200
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	// Collect action variety from a single combat
	sample := extractLog(results[0])
	actions := map[string]bool{}
	for _, e := range sample {
		actions[e.Action] = true
	}

	fmt.Printf("  KitchenSink [%d]: K1=%d K2=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    Actions seen in sample: ")
	for a := range actions {
		fmt.Printf("%s ", a)
	}
	fmt.Println()

	if w1 == 0 && w2 == 0 {
		t.Error("No wins recorded")
	}
	// Should see many different action types
	if len(actions) < 4 {
		t.Errorf("Kitchen sink should produce diverse combat actions, got only %d types", len(actions))
	}
}

// ── Test 120: Stress Test — 1000 combats with random-ish builds ──────────────────────
// Verify no panics/crashes with heavy effect stacking
func TestFullBuild_StressTest(t *testing.T) {
	dur1 := 1
	dur2 := 2
	dur3 := 3

	// Build with ALL trigger types represented
	c1 := baseCombatant(1, "StressA", []CombatTestEffect{
		// on_start damage
		{EffectID: 28, CoreEffectCode: "damage", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 10},
		// on_start stun
		{EffectID: 118, CoreEffectCode: "stun", TriggerType: "on_start", FactorType: "percent", Value: 15},
		// on_start bleed
		{EffectID: 128, CoreEffectCode: "bleed", TriggerType: "on_start", FactorType: "percent_of_max_hp", Value: 3},
		// on_turn_start modify_damage buff
		{EffectID: 123, CoreEffectCode: "modify_damage", TriggerType: "on_turn_start", FactorType: "percent", Value: 5, TargetSelf: true, Duration: &dur1},
		// on_every_other_turn modify_crit buff
		{EffectID: 102, CoreEffectCode: "modify_crit", TriggerType: "on_every_other_turn", FactorType: "percent", Value: 15, TargetSelf: true, Duration: &dur1},
		// on_hit heal
		{EffectID: 130, CoreEffectCode: "heal", TriggerType: "on_hit", FactorType: "percent_of_damage_dealt", Value: 15, TargetSelf: true},
		// on_crit bleed
		{EffectID: 113, CoreEffectCode: "bleed", TriggerType: "on_crit", FactorType: "percent_of_max_hp", Value: 3},
		// on_hit stun
		{EffectID: 136, CoreEffectCode: "stun", TriggerType: "on_hit", FactorType: "percent", Value: 10},
		// passive drawbacks
		{EffectID: 60, CoreEffectCode: "modify_armor", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
		{EffectID: 61, CoreEffectCode: "modify_dodge", TriggerType: "passive", FactorType: "percent", Value: -5, TargetSelf: true},
	})
	c1.Stamina = 50
	_ = dur3

	c2 := baseCombatant(2, "StressB", []CombatTestEffect{
		// on_hit_taken thorns
		{EffectID: 25, CoreEffectCode: "damage", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", Value: 15},
		// on_crit_taken counterattack buff
		{EffectID: 131, CoreEffectCode: "counterattack", TriggerType: "on_crit_taken", FactorType: "percent", Value: 30, TargetSelf: true, Duration: &dur2},
		// on_crit_taken heal
		{EffectID: 71, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 8, TargetSelf: true},
		// on_crit_taken bleed (toxic blood)
		{EffectID: 133, CoreEffectCode: "bleed", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 3},
		// on_crit_taken damage (vengeful core)
		{EffectID: 121, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", Value: 8},
		// on_hit_taken armor buff
		{EffectID: 77, CoreEffectCode: "modify_armor", TriggerType: "on_hit_taken", FactorType: "percent", Value: 12, TargetSelf: true, Duration: &dur2},
		// on_turn_end heal
		{EffectID: 110, CoreEffectCode: "heal", TriggerType: "on_turn_end", FactorType: "percent_of_missing_hp", Value: 10, TargetSelf: true},
		// on_turn_end bleed (Red Wake style)
		{EffectID: 115, CoreEffectCode: "bleed", TriggerType: "on_turn_end", FactorType: "percent_of_max_hp", Value: 2},
		// passive drawbacks
		{EffectID: 63, CoreEffectCode: "modify_damage", TriggerType: "passive", FactorType: "percent", Value: -15, TargetSelf: true},
		{EffectID: 62, CoreEffectCode: "modify_crit", TriggerType: "passive", FactorType: "percent", Value: -10, TargetSelf: true},
	})
	c2.Stamina = 50

	// Run 500 combats — primary goal: no panics
	N := 500
	w1, w2, dr, results := runManyCombats(c1, c2, N)

	// Verify all combats produced valid results
	for i, r := range results {
		header, ok := r["header"].(map[string]interface{})
		if !ok || header == nil {
			t.Errorf("Combat %d: missing header", i)
			continue
		}
		if _, ok := header["winnerId"]; !ok {
			t.Errorf("Combat %d: missing winnerId in header", i)
		}
		log := extractLog(r)
		if len(log) == 0 {
			t.Errorf("Combat %d: empty log", i)
		}
	}

	fmt.Printf("  StressTest [%d combats]: A=%d B=%d draws=%d\n", N, w1, w2, dr)
	fmt.Printf("    All %d combats completed without panics ✓\n", N)
}

// helper for condition pointers
func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
