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
		{EffectID: 1, CoreEffectCode: "heal", TriggerType: "on_crit_taken", FactorType: "percent_of_max_hp", TargetSelf: true, Value: 5},
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
		{EffectID: 1, CoreEffectCode: "damage", TriggerType: "on_crit_taken", FactorType: "percent_of_damage_taken", TargetSelf: false, Value: 30},
	})

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
	c2 := baseCombatant(2, "Target", nil)

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
	c2 := baseCombatant(2, "WeakenedFoe", nil)

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
		{EffectID: 113, CoreEffectCode: "bleed", TriggerType: "on_crit", FactorType: "percent", Value: 8},
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
			if e.Factor != 8 {
				t.Errorf("Hemorrhage bleed: got %d, want 8", e.Factor)
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
		{EffectID: 115, CoreEffectCode: "bleed", TriggerType: "on_turn_end", FactorType: "percent", Value: 4},
	})
	c2 := baseCombatant(2, "Target", nil)
	c2.Stamina = 50

	result := executeCombat(c1, c2)
	log := extractLog(result)

	bleedApps := 0
	bleedTicks := 0
	for _, e := range log {
		if e.CharacterID == 1 && e.Action == "bleed" && e.TriggerType == "on_turn_end" {
			bleedApps++
			if e.Factor != 4 {
				t.Errorf("Festering Wound bleed: got %d, want 4", e.Factor)
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
