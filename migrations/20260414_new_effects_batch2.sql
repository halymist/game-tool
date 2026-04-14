-- New effects batch 2: fill coverage gaps using existing core_effect_codes
-- 15 new effects (IDs 98-112), no engine changes needed
-- Uses correct DB column names: effect_id, core_effect_id (FK to game.core_effects)
-- Core effect ID mapping: attack=1, modify_damage=8, modify_dodge=9, modify_crit=10, modify_armor=11, modify_heal=12

BEGIN;

-- 1. Warding Fury — on_crit: +armor self, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (98, 'Warding Fury', 'Gain * armor on crit for 2 turns', 11, 'on_crit', 'percent', true, 2, 0, 1);

-- 2. Bloodlust Debuff — on_crit: -damage enemy, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (99, 'Bloodlust Debuff', 'Reduce enemy damage by * on crit for 2 turns', 8, 'on_crit', 'percent', false, 2, 0, 1);

-- 3. Recovery Instinct — on_hit_taken: +heal self, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (100, 'Recovery Instinct', 'Boost healing by * when hit for 2 turns', 12, 'on_hit_taken', 'percent', true, 2, 0, 1);

-- 4. Feinting Dodge — on_every_other_turn: +dodge self, duration 1
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (101, 'Feinting Dodge', 'Gain * dodge every other turn for 1 turn', 9, 'on_every_other_turn', 'percent', true, 1, 0, 1);

-- 5. Precision Pulse — on_every_other_turn: +crit self, duration 1
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (102, 'Precision Pulse', 'Gain * crit every other turn for 1 turn', 10, 'on_every_other_turn', 'percent', true, 1, 0, 1);

-- 6. Opening Dodge — on_start: +dodge self, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (103, 'Opening Dodge', 'Gain * dodge at fight start for 2 turns', 9, 'on_start', 'percent', true, 2, 0, 1);

-- 7. Opening Crit — on_start: +crit self, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (104, 'Opening Crit', 'Gain * crit at fight start for 2 turns', 10, 'on_start', 'percent', true, 2, 0, 1);

-- 8. Weakening Aura — on_start: -damage enemy, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (105, 'Weakening Aura', 'Reduce enemy damage by * at fight start for 2 turns', 8, 'on_start', 'percent', false, 2, 0, 1);

-- 9. Shattering Start — on_start: -armor enemy, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (106, 'Shattering Start', 'Reduce enemy armor by * at fight start for 2 turns', 11, 'on_start', 'percent', false, 2, 0, 1);

-- 10. Dulling Retaliation — on_crit_taken: -damage enemy, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (107, 'Dulling Retaliation', 'Reduce enemy damage by * when crit for 2 turns', 8, 'on_crit_taken', 'percent', false, 2, 0, 1);

-- 11. Crit Armor — on_crit_taken: +armor self, duration 2
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, duration, factor, version)
VALUES (108, 'Crit Armor', 'Gain * armor when crit for 2 turns', 11, 'on_crit_taken', 'percent', true, 2, 0, 1);

-- 12. Finishing Blow — on_turn_end: attack enemy (% max hp), no condition
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, factor, version)
VALUES (109, 'Finishing Blow', 'Deal * of max HP as damage at turn end', 1, 'on_turn_end', 'percent_of_max_hp', false, 0, 1);

-- 13. Draining Presence — on_turn_end: heal self (% missing hp)
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, factor, version)
VALUES (110, 'Draining Presence', 'Heal * of missing HP at turn end', 1, 'on_turn_end', 'percent_of_missing_hp', true, 0, 1);

-- 14. Attrition — on_every_other_turn: attack enemy (% max hp)
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, factor, version)
VALUES (111, 'Attrition', 'Deal * of max HP every other turn', 1, 'on_every_other_turn', 'percent_of_max_hp', false, 0, 1);

-- 15. Crit Leech — on_crit: heal self (% damage dealt)
INSERT INTO game.effects (effect_id, name, description, core_effect_id, trigger_type, factor_type, target_self, factor, version)
VALUES (112, 'Crit Leech', 'Heal * of damage dealt on crit', 1, 'on_crit', 'percent_of_damage_dealt', true, 0, 1);

COMMIT;
