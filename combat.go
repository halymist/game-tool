package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
)

// ── Combat types ────────────────────────────────────────────────────────────

// CombatTestRequest is the JSON body for the /api/testCombat endpoint
type CombatTestRequest struct {
	Combatant1 CombatTestCombatant `json:"combatant1"`
	Combatant2 CombatTestCombatant `json:"combatant2"`
}

// CombatTestCombatant represents one side's configuration for a test fight
type CombatTestCombatant struct {
	Name      string             `json:"name"`
	Strength  int                `json:"strength"`
	Stamina   int                `json:"stamina"`
	Agility   int                `json:"agility"`
	Luck      int                `json:"luck"`
	Armor     int                `json:"armor"`
	MinDamage int                `json:"minDamage"`
	MaxDamage int                `json:"maxDamage"`
	Effects   []CombatTestEffect `json:"effects"`
}

// CombatTestEffect is a simplified effect sent from the UI
type CombatTestEffect struct {
	EffectID       int     `json:"effectId"`
	CoreEffectCode string  `json:"coreEffectCode"` // attack, stun, bleed, dodge, crit, counterattack, double_attack, modify_damage, modify_dodge, modify_crit, modify_armor, modify_heal
	TriggerType    string  `json:"triggerType"`    // passive, on_start, on_attack, on_hit, on_crit, on_hit_taken, on_turn_start, on_turn_end, on_every_other_turn
	FactorType     string  `json:"factorType"`     // percent, percent_of_max_hp, percent_of_missing_hp, percent_of_damage_dealt, percent_of_damage_taken
	TargetSelf     bool    `json:"targetSelf"`
	ConditionType  *string `json:"conditionType,omitempty"`
	ConditionValue *int    `json:"conditionValue,omitempty"`
	Duration       *int    `json:"duration,omitempty"`
	Value          int     `json:"value"`
}

// CombatCharacter represents a character's stats, effects, and header info for combat
type CombatCharacter struct {
	CharacterID    int
	CharacterName  string
	Strength       int
	Stamina        int
	Agility        int
	Luck           int
	Armor          int
	MinDamage      int
	MaxDamage      int
	Effects        []CombatTestEffect
	DepletedHealth int
}

// CombatModifiers holds pre-resolved passive modifiers for a combatant
type CombatModifiers struct {
	DodgeChance        int
	CritChance         int
	DamageModifier     int
	DamageTakenMod     int
	ArmorModifier      int
	HealModifier       int
	CounterChance      int
	DoubleAttackChance int
}

// CombatLogEntry represents a single event in the combat log
type CombatLogEntry struct {
	Turn        int    `json:"turn"`
	CharacterID int    `json:"characterId"`
	Action      string `json:"action"` // attack, crit, dodge, stun, stunned, bleed, counterattack, double_attack, heal
	Factor      int    `json:"factor"`
	EffectID    *int   `json:"effectId,omitempty"`
	TriggerType string `json:"triggerType,omitempty"` // on_start, on_hit, on_crit, on_hit_taken, on_turn_start, on_turn_end, on_every_other_turn
}

// ── Handler ─────────────────────────────────────────────────────────────────

func handleTestCombat(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req CombatTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Build combat characters from request
	c1 := &CombatCharacter{
		CharacterID:   1,
		CharacterName: req.Combatant1.Name,
		Strength:      req.Combatant1.Strength,
		Stamina:       req.Combatant1.Stamina,
		Agility:       req.Combatant1.Agility,
		Luck:          req.Combatant1.Luck,
		Armor:         req.Combatant1.Armor,
		MinDamage:     req.Combatant1.MinDamage,
		MaxDamage:     req.Combatant1.MaxDamage,
		Effects:       req.Combatant1.Effects,
	}
	c2 := &CombatCharacter{
		CharacterID:   2,
		CharacterName: req.Combatant2.Name,
		Strength:      req.Combatant2.Strength,
		Stamina:       req.Combatant2.Stamina,
		Agility:       req.Combatant2.Agility,
		Luck:          req.Combatant2.Luck,
		Armor:         req.Combatant2.Armor,
		MinDamage:     req.Combatant2.MinDamage,
		MaxDamage:     req.Combatant2.MaxDamage,
		Effects:       req.Combatant2.Effects,
	}

	result := executeCombat(c1, c2)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ── Combat engine ───────────────────────────────────────────────────────────

func resolveCombatModifiers(char *CombatCharacter) CombatModifiers {
	mods := CombatModifiers{}
	for _, eff := range char.Effects {
		if eff.TriggerType != "passive" {
			continue
		}
		switch eff.CoreEffectCode {
		case "dodge":
			mods.DodgeChance += eff.Value
		case "crit":
			mods.CritChance += eff.Value
		case "modify_damage":
			if eff.TargetSelf {
				mods.DamageModifier += eff.Value
			}
		case "modify_armor":
			mods.ArmorModifier += eff.Value
		case "modify_heal":
			mods.HealModifier += eff.Value
		case "counterattack":
			mods.CounterChance += eff.Value
		case "double_attack":
			mods.DoubleAttackChance += eff.Value
		}
	}
	return mods
}

func checkCondition(eff *CombatTestEffect, currentHP int, maxHP int) bool {
	if eff.ConditionType == nil {
		return true
	}
	switch *eff.ConditionType {
	case "hp_below_percent":
		if eff.ConditionValue == nil {
			return true
		}
		return currentHP*100/maxHP < *eff.ConditionValue
	case "hp_above_percent":
		if eff.ConditionValue == nil {
			return true
		}
		return currentHP*100/maxHP > *eff.ConditionValue
	}
	return true
}

func resolveFactorValue(eff *CombatTestEffect, maxHP int, currentHP int, damageContext int) int {
	switch eff.FactorType {
	case "percent_of_max_hp":
		return maxHP * eff.Value / 100
	case "percent_of_missing_hp":
		missing := maxHP - currentHP
		if missing < 0 {
			missing = 0
		}
		return missing * eff.Value / 100
	case "percent_of_damage_dealt":
		return damageContext * eff.Value / 100
	case "percent_of_damage_taken":
		return damageContext * eff.Value / 100
	default: // "percent"
		return eff.Value
	}
}

func collectTriggeredEffects(char *CombatCharacter, trigger string) []CombatTestEffect {
	var result []CombatTestEffect
	for _, eff := range char.Effects {
		if eff.TriggerType == trigger {
			result = append(result, eff)
		}
	}
	return result
}

// logAttackEntry creates a combat log entry for an "attack" core effect.
// When value is negative and targetSelf is true, it is actually a heal.
func logAttackEntry(turn int, charID int, eff *CombatTestEffect, val int, trigger string) CombatLogEntry {
	eid := eff.EffectID
	if eff.TargetSelf && val < 0 {
		// Negative self-damage = heal
		return CombatLogEntry{Turn: turn, CharacterID: charID, Action: "heal", Factor: -val, EffectID: &eid, TriggerType: trigger}
	}
	return CombatLogEntry{Turn: turn, CharacterID: charID, Action: "attack", Factor: val, EffectID: &eid, TriggerType: trigger}
}

func executeCombat(player *CombatCharacter, enemy *CombatCharacter) map[string]interface{} {
	playerMods := resolveCombatModifiers(player)
	enemyMods := resolveCombatModifiers(enemy)

	calculateMaxHP := func(char *CombatCharacter) int {
		return char.Stamina * 10
	}

	playerMaxHP := calculateMaxHP(player)
	enemyMaxHP := calculateMaxHP(enemy)
	playerCurrentHP := playerMaxHP - player.DepletedHealth
	if playerCurrentHP < 1 {
		playerCurrentHP = 1
	}
	enemyCurrentHP := enemyMaxHP - enemy.DepletedHealth
	if enemyCurrentHP < 1 {
		enemyCurrentHP = 1
	}

	log.Printf("⚔️ Combat Test: %s (%d HP, dodge=%d%% crit=%d%%) vs %s (%d HP, dodge=%d%% crit=%d%%)",
		player.CharacterName, playerCurrentHP, playerMods.DodgeChance, playerMods.CritChance,
		enemy.CharacterName, enemyCurrentHP, enemyMods.DodgeChance, enemyMods.CritChance)

	combatLog := []CombatLogEntry{}
	maxTurns := 30
	winnerID := 0

	playerStunned := false
	enemyStunned := false
	playerBleedStacks := 0
	enemyBleedStacks := 0

	// Fire on_start effects
	fireStartEffects := func(char *CombatCharacter, charHP *int, charMaxHP int, opponentHP *int, opponentMaxHP int) {
		for _, eff := range collectTriggeredEffects(char, "on_start") {
			if !checkCondition(&eff, *charHP, charMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "attack":
				val := resolveFactorValue(&eff, charMaxHP, *charHP, 0)
				if eff.TargetSelf {
					*charHP -= val
				} else {
					*opponentHP -= val
				}
				combatLog = append(combatLog, logAttackEntry(0, char.CharacterID, &eff, val, "on_start"))
			}
		}
	}
	fireStartEffects(player, &playerCurrentHP, playerMaxHP, &enemyCurrentHP, enemyMaxHP)
	fireStartEffects(enemy, &enemyCurrentHP, enemyMaxHP, &playerCurrentHP, playerMaxHP)

	calculateDamage := func(attacker *CombatCharacter, attackerMods *CombatModifiers) int {
		damageRange := attacker.MaxDamage - attacker.MinDamage
		baseDamage := attacker.MinDamage
		if damageRange > 0 {
			baseDamage += rand.Intn(damageRange + 1)
		}
		finalDamage := baseDamage + attacker.Strength
		if attackerMods.DamageModifier != 0 {
			finalDamage = finalDamage + (finalDamage * attackerMods.DamageModifier / 100)
		}
		if finalDamage < 0 {
			finalDamage = 0
		}
		return finalDamage
	}

	applyArmor := func(damage int, defender *CombatCharacter, defenderMods *CombatModifiers) int {
		armor := defender.Armor
		if defenderMods.ArmorModifier != 0 {
			armor = armor + (armor * defenderMods.ArmorModifier / 100)
		}
		if armor <= 0 {
			return damage
		}
		reduced := damage * 100 / (armor + 100)
		if reduced < 1 {
			reduced = 1
		}
		return reduced
	}

	executeTurn := func(turn int,
		attacker *CombatCharacter, attackerMods *CombatModifiers, attackerHP *int, attackerMaxHP int, attackerStunned *bool, attackerBleed *int,
		defender *CombatCharacter, defenderMods *CombatModifiers, defenderHP *int, defenderMaxHP int, defenderStunned *bool, defenderBleed *int,
	) {
		// on_turn_start effects
		for _, eff := range collectTriggeredEffects(attacker, "on_turn_start") {
			if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "attack":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP -= val
				} else {
					*defenderHP -= val
				}
				combatLog = append(combatLog, logAttackEntry(turn, attacker.CharacterID, &eff, val, "on_turn_start"))
			}
		}

		// on_every_other_turn effects
		if turn%2 == 1 {
			for _, eff := range collectTriggeredEffects(attacker, "on_every_other_turn") {
				if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
					continue
				}
				switch eff.CoreEffectCode {
				case "attack":
					val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
					if eff.TargetSelf {
						*attackerHP -= val
					} else {
						*defenderHP -= val
					}
					combatLog = append(combatLog, logAttackEntry(turn, attacker.CharacterID, &eff, val, "on_every_other_turn"))
				}
			}
		}

		// Bleed damage at start of turn
		if *attackerBleed > 0 {
			bleedDmg := *attackerBleed
			*attackerHP -= bleedDmg
			combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedDmg})
		}

		// Stun check — character IS stunned, skips turn
		if *attackerStunned {
			*attackerStunned = false
			combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stunned", Factor: 0})
			goto turnEnd
		}

		{
			// Dodge check
			if defenderMods.DodgeChance > 0 && rand.Intn(100) < defenderMods.DodgeChance {
				combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "dodge", Factor: 0})
				goto turnEnd
			}

			// Calculate base damage
			damage := calculateDamage(attacker, attackerMods)

			// Crit check
			isCrit := false
			if attackerMods.CritChance > 0 && rand.Intn(100) < attackerMods.CritChance {
				isCrit = true
				damage = damage * 2
			}

			// Apply armor
			damage = applyArmor(damage, defender, defenderMods)

			// Apply damage
			*defenderHP -= damage
			action := "attack"
			if isCrit {
				action = "crit"
			}
			combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: action, Factor: damage})

			// on_hit effects
			for _, eff := range collectTriggeredEffects(attacker, "on_hit") {
				if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
					continue
				}
				switch eff.CoreEffectCode {
				case "attack":
					val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
					if eff.TargetSelf {
						*attackerHP -= val
					} else {
						*defenderHP -= val
					}
					combatLog = append(combatLog, logAttackEntry(turn, attacker.CharacterID, &eff, val, "on_hit"))
				case "stun":
					if rand.Intn(100) < eff.Value {
						*defenderStunned = true
						eid := eff.EffectID
						combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_hit"})
					}
				case "bleed":
					bleedAmount := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
					*defenderBleed += bleedAmount
					eid := eff.EffectID
					combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_hit"})
				}
			}

			// on_crit effects
			if isCrit {
				for _, eff := range collectTriggeredEffects(attacker, "on_crit") {
					if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
						continue
					}
					switch eff.CoreEffectCode {
					case "attack":
						val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
						if eff.TargetSelf {
							*attackerHP -= val
						} else {
							*defenderHP -= val
						}
						combatLog = append(combatLog, logAttackEntry(turn, attacker.CharacterID, &eff, val, "on_crit"))
					case "stun":
						if rand.Intn(100) < eff.Value {
							*defenderStunned = true
							eid := eff.EffectID
							combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_crit"})
						}
					case "bleed":
						bleedAmount := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
						*defenderBleed += bleedAmount
						eid := eff.EffectID
						combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_crit"})
					}
				}
			}

			// on_hit_taken effects (defender reacts)
			for _, eff := range collectTriggeredEffects(defender, "on_hit_taken") {
				if !checkCondition(&eff, *defenderHP, defenderMaxHP) {
					continue
				}
				switch eff.CoreEffectCode {
				case "attack":
					val := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
					if eff.TargetSelf {
						*defenderHP -= val
					} else {
						*attackerHP -= val
					}
					combatLog = append(combatLog, logAttackEntry(turn, defender.CharacterID, &eff, val, "on_hit_taken"))
				}
			}

			// Counterattack check
			if defenderMods.CounterChance > 0 && rand.Intn(100) < defenderMods.CounterChance {
				counterDmg := calculateDamage(defender, defenderMods)
				counterDmg = applyArmor(counterDmg, attacker, attackerMods)
				*attackerHP -= counterDmg
				combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: defender.CharacterID, Action: "counterattack", Factor: counterDmg})
			}

			// Double attack check
			if attackerMods.DoubleAttackChance > 0 && rand.Intn(100) < attackerMods.DoubleAttackChance {
				extraDmg := calculateDamage(attacker, attackerMods)
				extraDmg = applyArmor(extraDmg, defender, defenderMods)
				*defenderHP -= extraDmg
				combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "double_attack", Factor: extraDmg})
			}
		}

	turnEnd:
		// on_turn_end effects
		for _, eff := range collectTriggeredEffects(attacker, "on_turn_end") {
			if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "attack":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP -= val
				} else {
					*defenderHP -= val
				}
				combatLog = append(combatLog, logAttackEntry(turn, attacker.CharacterID, &eff, val, "on_turn_end"))
			}
		}

		// Clamp HP
		if *attackerHP > attackerMaxHP {
			*attackerHP = attackerMaxHP
		}
		if *defenderHP > defenderMaxHP {
			*defenderHP = defenderMaxHP
		}
	}

	// Combat loop
	for turn := 1; turn <= maxTurns; turn++ {
		executeTurn(turn,
			player, &playerMods, &playerCurrentHP, playerMaxHP, &playerStunned, &playerBleedStacks,
			enemy, &enemyMods, &enemyCurrentHP, enemyMaxHP, &enemyStunned, &enemyBleedStacks,
		)
		if enemyCurrentHP <= 0 {
			winnerID = player.CharacterID
			break
		}
		if playerCurrentHP <= 0 {
			winnerID = enemy.CharacterID
			break
		}

		executeTurn(turn,
			enemy, &enemyMods, &enemyCurrentHP, enemyMaxHP, &enemyStunned, &enemyBleedStacks,
			player, &playerMods, &playerCurrentHP, playerMaxHP, &playerStunned, &playerBleedStacks,
		)
		if playerCurrentHP <= 0 {
			winnerID = enemy.CharacterID
			break
		}
		if enemyCurrentHP <= 0 {
			winnerID = player.CharacterID
			break
		}
	}

	// Timeout: highest HP wins
	if winnerID == 0 {
		if playerCurrentHP >= enemyCurrentHP {
			winnerID = player.CharacterID
		} else {
			winnerID = enemy.CharacterID
		}
	}

	playerHPEnd := playerCurrentHP
	if playerHPEnd < 0 {
		playerHPEnd = 0
	}
	enemyHPEnd := enemyCurrentHP
	if enemyHPEnd < 0 {
		enemyHPEnd = 0
	}

	return map[string]interface{}{
		"header": map[string]interface{}{
			"winnerId": winnerID,
			"combatant1": map[string]interface{}{
				"id":    player.CharacterID,
				"name":  player.CharacterName,
				"maxHp": playerMaxHP,
				"hpEnd": playerHPEnd,
			},
			"combatant2": map[string]interface{}{
				"id":    enemy.CharacterID,
				"name":  enemy.CharacterName,
				"maxHp": enemyMaxHP,
				"hpEnd": enemyHPEnd,
			},
		},
		"log": combatLog,
	}
}
