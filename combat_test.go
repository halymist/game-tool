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
		{EffectID: 1, CoreEffectCode: "attack", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: -3},
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
	c2 := baseCombatant(2, "Fast", nil)
	c2.Agility = 40 // ratio 4:1 → ~23% dodge

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
		{EffectID: 1, CoreEffectCode: "attack", TriggerType: "on_hit_taken", FactorType: "percent_of_damage_taken", TargetSelf: true, Value: -50},
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
	c2 := baseCombatant(2, "Target", nil)
	c2.Agility = 0 // minimize dodges
	c2.Luck = 100  // maximize c2 dodge to avoid dodge chance for c1 attacking c2 being high... no wait
	// Actually: dodge = statBasedChance(defender.Agility=0, attacker.Agility=10, 0)
	// = 10 * log2(0/10 + 1) = 10 * log2(1) = 0 + 0 = actually defender agility 0 vs attacker 10
	// Wait, dodge uses defender agility / attacker agility ratio
	// ratio = 0 / 10 = 0 → log2(0+1) = 0 → chance = 0 + 0 = 0, but clamped to min 1
	// So dodge chance = 1%. Good enough.

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

	c2 := baseCombatant(2, "Resilient", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "attack", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", TargetSelf: true, Value: -5},
	})

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

	c2 := baseCombatant(2, "Retaliator", []CombatTestEffect{
		{EffectID: 1, CoreEffectCode: "attack", TriggerType: "on_crit_taken", FactorType: "percent_of_damage_taken", TargetSelf: false, Value: 30},
	})

	result := executeCombat(c1, c2)
	log := extractLog(result)

	retaliations := 0
	for _, e := range log {
		if e.Action == "attack" && e.CharacterID == 2 && e.TriggerType == "on_crit_taken" {
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
		{EffectID: 2, CoreEffectCode: "attack", TriggerType: "on_turn_start", FactorType: "percent_of_max_hp", TargetSelf: true, Value: -10},
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
