package main

import (
	"encoding/json"
	"log"
	"math"
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
	CoreEffectCode string  `json:"coreEffectCode"` // attack, stun, bleed, dodge, crit, counterattack, double_attack, modify_damage, modify_dodge, modify_crit, modify_armor, modify_heal, consecutive_damage
	TriggerType    string  `json:"triggerType"`    // passive, on_start, on_attack, on_hit, on_crit, on_crit_taken, on_hit_taken, on_turn_start, on_turn_end, on_every_other_turn
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
	DodgeChance            int
	CritChance             int
	DamageModifier         int
	DamageTakenMod         int
	ArmorModifier          int
	HealModifier           int
	CounterChance          int
	DoubleAttackChance     int
	ConsecutiveDamageBonus int // % damage increase per consecutive hit
}

// CombatLogEntry represents a single event in the combat log
type CombatLogEntry struct {
	Turn        int    `json:"turn"`
	CharacterID int    `json:"characterId"`
	Action      string `json:"action"` // attack, crit, dodge, stun, stunned, bleed, counterattack, double_attack, heal, buff, buff_expire
	Factor      int    `json:"factor"`
	EffectID    *int   `json:"effectId,omitempty"`
	TriggerType string `json:"triggerType,omitempty"` // on_start, on_hit, on_crit, on_crit_taken, on_hit_taken, on_turn_start, on_turn_end, on_every_other_turn
	Duration    *int   `json:"duration,omitempty"`    // how many turns a buff lasts (for buff/buff_expire actions)
	BuffType    string `json:"buffType,omitempty"`    // which modifier: modify_damage, modify_dodge, modify_crit, modify_armor, modify_heal
}

// TempBuff represents a temporary modifier active for a limited number of turns
type TempBuff struct {
	ModifierType string // modify_damage, modify_dodge, modify_crit, modify_armor, modify_heal
	Value        int
	Remaining    int // turns remaining (decremented at end of owner's turn)
	EffectID     int
	TriggerType  string // what triggered it
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
		case "consecutive_damage":
			mods.ConsecutiveDamageBonus += eff.Value
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

func logDamageEntry(turn int, charID int, eff *CombatTestEffect, val int, trigger string) CombatLogEntry {
	eid := eff.EffectID
	return CombatLogEntry{Turn: turn, CharacterID: charID, Action: "damage", Factor: val, EffectID: &eid, TriggerType: trigger}
}

func logHealEntry(turn int, charID int, eff *CombatTestEffect, val int, trigger string) CombatLogEntry {
	eid := eff.EffectID
	return CombatLogEntry{Turn: turn, CharacterID: charID, Action: "heal", Factor: val, EffectID: &eid, TriggerType: trigger}
}

func executeCombat(player *CombatCharacter, enemy *CombatCharacter) map[string]interface{} {
	playerMods := resolveCombatModifiers(player)
	enemyMods := resolveCombatModifiers(enemy)

	calculateMaxHP := func(char *CombatCharacter) int {
		return char.Stamina * 10
	}

	// Ratio-based chance with diminishing returns:
	// Equal stats → 10%, double the stat → ~20%, triple → ~27%, clamped [1, 50]
	statBasedChance := func(myStat int, theirStat int, bonusMod int) int {
		denom := theirStat
		if denom < 1 {
			denom = 1
		}
		ratio := float64(myStat) / float64(denom)
		chance := int(10.0*math.Log2(ratio+1)) + bonusMod
		if chance < 1 {
			chance = 1
		}
		if chance > 50 {
			chance = 50
		}
		return chance
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

	log.Printf("⚔️ Combat Test: %s (%d HP) vs %s (%d HP)",
		player.CharacterName, playerCurrentHP,
		enemy.CharacterName, enemyCurrentHP)

	combatLog := []CombatLogEntry{}
	maxTurns := 30
	winnerID := 0

	playerStunned := false
	enemyStunned := false
	playerBleedStacks := 0
	enemyBleedStacks := 0
	playerConsecutiveHits := 0
	enemyConsecutiveHits := 0
	playerTempBuffs := []TempBuff{}
	enemyTempBuffs := []TempBuff{}

	// Helper: apply a modifier effect — if it has a duration, create a temp buff; otherwise apply permanently
	applyModifier := func(turn int, charID int, mods *CombatModifiers, tempBuffs *[]TempBuff, eff *CombatTestEffect, trigger string) {
		val := eff.Value
		hasDuration := eff.Duration != nil && *eff.Duration > 0

		if hasDuration {
			// Create temporary buff (+1 so the application turn doesn't consume a duration tick)
			*tempBuffs = append(*tempBuffs, TempBuff{
				ModifierType: eff.CoreEffectCode,
				Value:        val,
				Remaining:    *eff.Duration + 1,
				EffectID:     eff.EffectID,
				TriggerType:  trigger,
			})
			eid := eff.EffectID
			dur := *eff.Duration
			combatLog = append(combatLog, CombatLogEntry{
				Turn: turn, CharacterID: charID, Action: "buff", Factor: val,
				EffectID: &eid, TriggerType: trigger, Duration: &dur, BuffType: eff.CoreEffectCode,
			})
		}

		// Apply to mods immediately (temp buffs also apply right away)
		switch eff.CoreEffectCode {
		case "modify_damage":
			mods.DamageModifier += val
		case "modify_dodge":
			mods.DodgeChance += val
		case "modify_crit":
			mods.CritChance += val
		case "modify_armor":
			mods.ArmorModifier += val
		case "modify_heal":
			mods.HealModifier += val
		}
	}

	// ── Statistics tracking ──────────────────────────
	type combatStats struct {
		DamageDealt   int `json:"damageDealt"`
		DamageTaken   int `json:"damageTaken"`
		HealingDone   int `json:"healingDone"`
		Attacks       int `json:"attacks"`
		CritHits      int `json:"critHits"`
		DodgedAttacks int `json:"dodgedAttacks"`
		AttacksDodged int `json:"attacksDodged"` // times this char's attack was dodged
		StunApplied   int `json:"stunApplied"`
		TimesStunned  int `json:"timesStunned"`
		BleedApplied  int `json:"bleedApplied"`
		CounterHits   int `json:"counterHits"`
		DoubleAttacks int `json:"doubleAttacks"`
		MaxConsecHits int `json:"maxConsecHits"`
	}
	stats1 := &combatStats{}
	stats2 := &combatStats{}

	getStats := func(charID int) *combatStats {
		if charID == player.CharacterID {
			return stats1
		}
		return stats2
	}

	// Fire on_start effects
	fireStartEffects := func(char *CombatCharacter, charHP *int, charMaxHP int, charMods *CombatModifiers, charBuffs *[]TempBuff,
		opponentHP *int, opponentMaxHP int, opponentMods *CombatModifiers, opponentBuffs *[]TempBuff,
		opponentBleed *int, opponentStunned *bool) {
		for _, eff := range collectTriggeredEffects(char, "on_start") {
			if !checkCondition(&eff, *charHP, charMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "damage":
				val := resolveFactorValue(&eff, charMaxHP, *charHP, 0)
				if eff.TargetSelf {
					*charHP -= val
				} else {
					*opponentHP -= val
				}
				combatLog = append(combatLog, logDamageEntry(0, char.CharacterID, &eff, val, "on_start"))
			case "heal":
				val := resolveFactorValue(&eff, charMaxHP, *charHP, 0)
				if eff.TargetSelf {
					*charHP += val
					if val > 0 {
						getStats(char.CharacterID).HealingDone += val
					}
				} else {
					*opponentHP += val
				}
				combatLog = append(combatLog, logHealEntry(0, char.CharacterID, &eff, val, "on_start"))
			case "bleed":
				bleedAmount := resolveFactorValue(&eff, opponentMaxHP, *opponentHP, 0)
				*opponentBleed += bleedAmount
				getStats(char.CharacterID).BleedApplied += bleedAmount
				eid := eff.EffectID
				combatLog = append(combatLog, CombatLogEntry{Turn: 0, CharacterID: char.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_start"})
			case "stun":
				if rand.Intn(100) < eff.Value {
					*opponentStunned = true
					getStats(char.CharacterID).StunApplied++
					eid := eff.EffectID
					combatLog = append(combatLog, CombatLogEntry{Turn: 0, CharacterID: char.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_start"})
				}
			case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
				if eff.TargetSelf {
					applyModifier(0, char.CharacterID, charMods, charBuffs, &eff, "on_start")
				} else {
					applyModifier(0, char.CharacterID, opponentMods, opponentBuffs, &eff, "on_start")
				}
			}
		}
	}
	fireStartEffects(player, &playerCurrentHP, playerMaxHP, &playerMods, &playerTempBuffs,
		&enemyCurrentHP, enemyMaxHP, &enemyMods, &enemyTempBuffs, &enemyBleedStacks, &enemyStunned)
	fireStartEffects(enemy, &enemyCurrentHP, enemyMaxHP, &enemyMods, &enemyTempBuffs,
		&playerCurrentHP, playerMaxHP, &playerMods, &playerTempBuffs, &playerBleedStacks, &playerStunned)

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
		attacker *CombatCharacter, attackerMods *CombatModifiers, attackerHP *int, attackerMaxHP int, attackerStunned *bool, attackerBleed *int, attackerConsecHits *int, attackerBuffs *[]TempBuff,
		defender *CombatCharacter, defenderMods *CombatModifiers, defenderHP *int, defenderMaxHP int, defenderStunned *bool, defenderBleed *int, defenderConsecHits *int, defenderBuffs *[]TempBuff,
	) {
		aStats := getStats(attacker.CharacterID)

		// on_turn_start effects
		for _, eff := range collectTriggeredEffects(attacker, "on_turn_start") {
			if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "damage":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP -= val
				} else {
					*defenderHP -= val
					if val > 0 {
						aStats.DamageDealt += val
						getStats(defender.CharacterID).DamageTaken += val
					}
				}
				combatLog = append(combatLog, logDamageEntry(turn, attacker.CharacterID, &eff, val, "on_turn_start"))
			case "heal":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP += val
					if val > 0 {
						aStats.HealingDone += val
					}
				} else {
					*defenderHP += val
				}
				combatLog = append(combatLog, logHealEntry(turn, attacker.CharacterID, &eff, val, "on_turn_start"))
			case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
				if eff.TargetSelf {
					applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_turn_start")
				} else {
					applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_turn_start")
				}
			}
		}

		// on_every_other_turn effects
		if turn%2 == 1 {
			for _, eff := range collectTriggeredEffects(attacker, "on_every_other_turn") {
				if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
					continue
				}
				switch eff.CoreEffectCode {
				case "damage":
					val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
					if eff.TargetSelf {
						*attackerHP -= val
					} else {
						*defenderHP -= val
						if val > 0 {
							aStats.DamageDealt += val
							getStats(defender.CharacterID).DamageTaken += val
						}
					}
					combatLog = append(combatLog, logDamageEntry(turn, attacker.CharacterID, &eff, val, "on_every_other_turn"))
				case "heal":
					val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
					if eff.TargetSelf {
						*attackerHP += val
						if val > 0 {
							aStats.HealingDone += val
						}
					} else {
						*defenderHP += val
					}
					combatLog = append(combatLog, logHealEntry(turn, attacker.CharacterID, &eff, val, "on_every_other_turn"))
				case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
					if eff.TargetSelf {
						applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_every_other_turn")
					} else {
						applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_every_other_turn")
					}
				}
			}
		}

		// Bleed damage at start of turn
		if *attackerBleed > 0 {
			bleedDmg := *attackerBleed
			*attackerHP -= bleedDmg
			aStats.DamageTaken += bleedDmg
			combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedDmg})
		}

		// Stun check — character IS stunned, skips turn
		if *attackerStunned {
			*attackerStunned = false
			*attackerConsecHits = 0 // stun breaks consecutive hits
			aStats.TimesStunned++
			combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stunned", Factor: 0})
			goto turnEnd
		}

		// ── Perform attack (and potentially double attack) ──
		{
			// Helper: perform one full attack sequence (dodge check → damage → crit → armor → on_hit → on_crit → on_crit_taken → on_hit_taken → counter)
			performAttack := func(isDoubleAttack bool) {
				// Dodge check — based on defender agility vs attacker agility
				dodgeChance := statBasedChance(defender.Agility, attacker.Agility, defenderMods.DodgeChance)
				if rand.Intn(100) < dodgeChance {
					*attackerConsecHits = 0 // dodge breaks consecutive hits
					aStats.AttacksDodged++
					getStats(defender.CharacterID).DodgedAttacks++
					combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "dodge", Factor: 0})
					return
				}

				// Consecutive hit tracking
				*attackerConsecHits++
				if *attackerConsecHits > aStats.MaxConsecHits {
					aStats.MaxConsecHits = *attackerConsecHits
				}

				// Calculate base damage
				damage := calculateDamage(attacker, attackerMods)

				// Apply consecutive damage bonus (% increase per hit in streak)
				if attackerMods.ConsecutiveDamageBonus > 0 && *attackerConsecHits > 1 {
					bonus := attackerMods.ConsecutiveDamageBonus * (*attackerConsecHits - 1)
					damage = damage + (damage * bonus / 100)
				}

				// Crit check — based on attacker luck vs defender luck
				isCrit := false
				critChance := statBasedChance(attacker.Luck, defender.Luck, attackerMods.CritChance)
				if rand.Intn(100) < critChance {
					isCrit = true
					damage = damage * 2
					aStats.CritHits++
				}

				// Apply armor
				damage = applyArmor(damage, defender, defenderMods)

				// Apply damage
				*defenderHP -= damage
				aStats.DamageDealt += damage
				aStats.Attacks++
				getStats(defender.CharacterID).DamageTaken += damage

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
					case "damage":
						val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
						if eff.TargetSelf {
							*attackerHP -= val
						} else {
							*defenderHP -= val
							if val > 0 {
								aStats.DamageDealt += val
								getStats(defender.CharacterID).DamageTaken += val
							}
						}
						combatLog = append(combatLog, logDamageEntry(turn, attacker.CharacterID, &eff, val, "on_hit"))
					case "heal":
						val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
						if eff.TargetSelf {
							*attackerHP += val
							if val > 0 {
								aStats.HealingDone += val
							}
						} else {
							*defenderHP += val
						}
						combatLog = append(combatLog, logHealEntry(turn, attacker.CharacterID, &eff, val, "on_hit"))
					case "stun":
						if rand.Intn(100) < eff.Value {
							*defenderStunned = true
							aStats.StunApplied++
							eid := eff.EffectID
							combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_hit"})
						}
					case "bleed":
						bleedAmount := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
						*defenderBleed += bleedAmount
						aStats.BleedApplied += bleedAmount
						eid := eff.EffectID
						combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_hit"})
					case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
						if eff.TargetSelf {
							applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_hit")
						} else {
							applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_hit")
						}
					}
				}

				// on_crit effects
				if isCrit {
					for _, eff := range collectTriggeredEffects(attacker, "on_crit") {
						if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
							continue
						}
						switch eff.CoreEffectCode {
						case "damage":
							val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
							if eff.TargetSelf {
								*attackerHP -= val
							} else {
								*defenderHP -= val
								if val > 0 {
									aStats.DamageDealt += val
									getStats(defender.CharacterID).DamageTaken += val
								}
							}
							combatLog = append(combatLog, logDamageEntry(turn, attacker.CharacterID, &eff, val, "on_crit"))
						case "heal":
							val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
							if eff.TargetSelf {
								*attackerHP += val
								if val > 0 {
									aStats.HealingDone += val
								}
							} else {
								*defenderHP += val
							}
							combatLog = append(combatLog, logHealEntry(turn, attacker.CharacterID, &eff, val, "on_crit"))
						case "stun":
							if rand.Intn(100) < eff.Value {
								*defenderStunned = true
								aStats.StunApplied++
								eid := eff.EffectID
								combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_crit"})
							}
						case "bleed":
							bleedAmount := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
							*defenderBleed += bleedAmount
							aStats.BleedApplied += bleedAmount
							eid := eff.EffectID
							combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_crit"})
						case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
							if eff.TargetSelf {
								applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_crit")
							} else {
								applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_crit")
							}
						}
					}
				}

				// on_hit_taken effects (defender reacts)
				for _, eff := range collectTriggeredEffects(defender, "on_hit_taken") {
					if !checkCondition(&eff, *defenderHP, defenderMaxHP) {
						continue
					}
					switch eff.CoreEffectCode {
					case "damage":
						val := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
						if eff.TargetSelf {
							*defenderHP -= val
						} else {
							*attackerHP -= val
							if val > 0 {
								getStats(defender.CharacterID).DamageDealt += val
								aStats.DamageTaken += val
							}
						}
						combatLog = append(combatLog, logDamageEntry(turn, defender.CharacterID, &eff, val, "on_hit_taken"))
					case "heal":
						val := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
						if eff.TargetSelf {
							*defenderHP += val
							if val > 0 {
								getStats(defender.CharacterID).HealingDone += val
							}
						} else {
							*attackerHP += val
						}
						combatLog = append(combatLog, logHealEntry(turn, defender.CharacterID, &eff, val, "on_hit_taken"))
					case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
						if eff.TargetSelf {
							applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_hit_taken")
						} else {
							applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_hit_taken")
						}
					}
				}

				// on_crit_taken effects (defender reacts to being crit)
				if isCrit {
					for _, eff := range collectTriggeredEffects(defender, "on_crit_taken") {
						if !checkCondition(&eff, *defenderHP, defenderMaxHP) {
							continue
						}
						switch eff.CoreEffectCode {
						case "damage":
							val := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
							if eff.TargetSelf {
								*defenderHP -= val
							} else {
								*attackerHP -= val
								if val > 0 {
									getStats(defender.CharacterID).DamageDealt += val
									aStats.DamageTaken += val
								}
							}
							combatLog = append(combatLog, logDamageEntry(turn, defender.CharacterID, &eff, val, "on_crit_taken"))
						case "heal":
							val := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, damage)
							if eff.TargetSelf {
								*defenderHP += val
								if val > 0 {
									getStats(defender.CharacterID).HealingDone += val
								}
							} else {
								*attackerHP += val
							}
							combatLog = append(combatLog, logHealEntry(turn, defender.CharacterID, &eff, val, "on_crit_taken"))
						case "bleed":
							bleedAmount := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, damage)
							*attackerBleed += bleedAmount
							getStats(defender.CharacterID).BleedApplied += bleedAmount
							eid := eff.EffectID
							combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: defender.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_crit_taken"})
						case "stun":
							if rand.Intn(100) < eff.Value {
								*attackerStunned = true
								getStats(defender.CharacterID).StunApplied++
								eid := eff.EffectID
								combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: defender.CharacterID, Action: "stun", Factor: 0, EffectID: &eid, TriggerType: "on_crit_taken"})
							}
						case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
							if eff.TargetSelf {
								applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_crit_taken")
							} else {
								applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_crit_taken")
							}
						}
					}
				}

				// Counterattack check (only on first/main attack, not double)
				if !isDoubleAttack && defenderMods.CounterChance > 0 && rand.Intn(100) < defenderMods.CounterChance {
					counterDmg := calculateDamage(defender, defenderMods)
					counterDmg = applyArmor(counterDmg, attacker, attackerMods)
					*attackerHP -= counterDmg
					getStats(defender.CharacterID).DamageDealt += counterDmg
					getStats(defender.CharacterID).CounterHits++
					aStats.DamageTaken += counterDmg
					combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: defender.CharacterID, Action: "counterattack", Factor: counterDmg})
				}
			}

			// Primary attack
			performAttack(false)

			// Double attack check — if triggered, perform a full second attack
			if attackerMods.DoubleAttackChance > 0 && rand.Intn(100) < attackerMods.DoubleAttackChance {
				aStats.DoubleAttacks++
				performAttack(true)
			}
		}

	turnEnd:
		// on_turn_end effects
		for _, eff := range collectTriggeredEffects(attacker, "on_turn_end") {
			if !checkCondition(&eff, *attackerHP, attackerMaxHP) {
				continue
			}
			switch eff.CoreEffectCode {
			case "damage":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP -= val
				} else {
					*defenderHP -= val
					if val > 0 {
						aStats.DamageDealt += val
						getStats(defender.CharacterID).DamageTaken += val
					}
				}
				combatLog = append(combatLog, logDamageEntry(turn, attacker.CharacterID, &eff, val, "on_turn_end"))
			case "heal":
				val := resolveFactorValue(&eff, attackerMaxHP, *attackerHP, 0)
				if eff.TargetSelf {
					*attackerHP += val
					if val > 0 {
						aStats.HealingDone += val
					}
				} else {
					*defenderHP += val
				}
				combatLog = append(combatLog, logHealEntry(turn, attacker.CharacterID, &eff, val, "on_turn_end"))
			case "bleed":
				bleedAmount := resolveFactorValue(&eff, defenderMaxHP, *defenderHP, 0)
				*defenderBleed += bleedAmount
				aStats.BleedApplied += bleedAmount
				eid := eff.EffectID
				combatLog = append(combatLog, CombatLogEntry{Turn: turn, CharacterID: attacker.CharacterID, Action: "bleed", Factor: bleedAmount, EffectID: &eid, TriggerType: "on_turn_end"})
			case "modify_damage", "modify_dodge", "modify_crit", "modify_armor", "modify_heal":
				if eff.TargetSelf {
					applyModifier(turn, attacker.CharacterID, attackerMods, attackerBuffs, &eff, "on_turn_end")
				} else {
					applyModifier(turn, defender.CharacterID, defenderMods, defenderBuffs, &eff, "on_turn_end")
				}
			}
		}

		// Tick down temp buffs on attacker and remove expired ones
		{
			remaining := (*attackerBuffs)[:0]
			for _, b := range *attackerBuffs {
				b.Remaining--
				if b.Remaining <= 0 {
					// Remove the modifier
					switch b.ModifierType {
					case "modify_damage":
						attackerMods.DamageModifier -= b.Value
					case "modify_dodge":
						attackerMods.DodgeChance -= b.Value
					case "modify_crit":
						attackerMods.CritChance -= b.Value
					case "modify_armor":
						attackerMods.ArmorModifier -= b.Value
					case "modify_heal":
						attackerMods.HealModifier -= b.Value
					}
					eid := b.EffectID
					combatLog = append(combatLog, CombatLogEntry{
						Turn: turn, CharacterID: attacker.CharacterID, Action: "buff_expire",
						Factor: b.Value, EffectID: &eid, BuffType: b.ModifierType,
					})
				} else {
					remaining = append(remaining, b)
				}
			}
			*attackerBuffs = remaining
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
			player, &playerMods, &playerCurrentHP, playerMaxHP, &playerStunned, &playerBleedStacks, &playerConsecutiveHits, &playerTempBuffs,
			enemy, &enemyMods, &enemyCurrentHP, enemyMaxHP, &enemyStunned, &enemyBleedStacks, &enemyConsecutiveHits, &enemyTempBuffs,
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
			enemy, &enemyMods, &enemyCurrentHP, enemyMaxHP, &enemyStunned, &enemyBleedStacks, &enemyConsecutiveHits, &enemyTempBuffs,
			player, &playerMods, &playerCurrentHP, playerMaxHP, &playerStunned, &playerBleedStacks, &playerConsecutiveHits, &playerTempBuffs,
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
		"stats": map[string]interface{}{
			"combatant1": stats1,
			"combatant2": stats2,
		},
	}
}
