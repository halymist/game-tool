-- Combat Expansion: new core effect, new effects, new trigger type, talent updates

-- 1. New core effect: consecutive_damage
INSERT INTO game.core_effects (core_effect_id, code) VALUES (13, 'consecutive_damage');

-- 2. New effects
-- Momentum (large) — for higher-tier talents
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self)
VALUES (67, 'Momentum', NULL, 3, 'Increase damage by *% for each consecutive hit', 13, 'passive', 'percent', true);

-- Momentum (small) — for lower-tier talents  
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self)
VALUES (68, 'Building Pressure', NULL, 1, 'Increase damage by *% for each consecutive hit', 13, 'passive', 'percent', true);

-- Crippling Precision — reduce enemy healing on crit
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self)
VALUES (69, 'Crippling Precision', NULL, -5, 'Reduce enemy healing by *% on critical hit', 12, 'on_crit', 'percent', false);

-- Retaliating Fury — deal damage back when taking a crit
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self)
VALUES (70, 'Retaliating Fury', NULL, 20, 'Deal *% of damage taken back to attacker when critically hit', 1, 'on_crit_taken', 'percent_of_damage_taken', false);

-- Staggering Crit — stun on crit taken (you get stunned less by retaliating)
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self)
VALUES (71, 'Defiant Roar', NULL, -5, 'Heal *% of max HP when taking a critical hit', 1, 'on_crit_taken', 'percent_of_max_hp', true);

-- 3. Update some duplicate talents with new effects
-- R6C1 Ferocity (id=36): was Savage Strikes (modify_damage +2) → Momentum (+3)
UPDATE game.talents_info SET effect_id = 67, factor = 3, description = 'Gain momentum with each consecutive hit, increasing damage', version = COALESCE(version, 1) + 1 WHERE talent_id = 36;

-- R8C1 Master Striker (id=50): was Savage Strikes (modify_damage +2) → Building Pressure (+1)
UPDATE game.talents_info SET effect_id = 68, factor = 1, description = 'Build pressure with each consecutive hit', version = COALESCE(version, 1) + 1 WHERE talent_id = 50;

-- R6C7 Sharpened (id=42): was War Cry (modify_damage +3) → Crippling Precision (-5)
UPDATE game.talents_info SET effect_id = 69, factor = -5, description = 'Critical hits weaken enemy healing', version = COALESCE(version, 1) + 1 WHERE talent_id = 42;

-- R7C5 Dulling Blows (id=47): was Unnerve (modify_crit -1) → Retaliating Fury (20)
UPDATE game.talents_info SET effect_id = 70, factor = 20, description = 'Strike back when critically hit', version = COALESCE(version, 1) + 1 WHERE talent_id = 47;
