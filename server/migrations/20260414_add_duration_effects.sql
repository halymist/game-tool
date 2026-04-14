-- Migration: Add duration-based temporary buff effects and replace duplicate talents
-- Date: 2026-04-14
--
-- New effects (72-76) use the duration field to create temporary combat buffs.
-- Duration 1 = buff lasts 1 turn, Duration 2 = buff lasts 2 turns.
-- Buffs apply their modifier immediately and are removed after N turn-end ticks.

-- ── New effects ──────────────────────────────────────────────────────────────

-- 72: Surge of Power — on_hit, +8% damage for 2 turns (player self-buff)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (72, 'Surge of Power',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_hit', 'percent', 8, true, 2,
  NULL, 'Boost damage by *% for 2 turns on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name,
  core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type,
  factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor,
  target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description;

-- 73: Adrenaline Rush — on_crit, +12% damage for 2 turns (player self-buff)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (73, 'Adrenaline Rush',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_crit', 'percent', 12, true, 2,
  NULL, 'Boost damage by *% for 2 turns on critical hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name,
  core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type,
  factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor,
  target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description;

-- 74: Battle Rhythm — on_hit, +5% crit for 1 turn (player self-buff)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (74, 'Battle Rhythm',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_crit'),
  'on_hit', 'percent', 5, true, 1,
  NULL, 'Boost critical chance by *% for 1 turn on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name,
  core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type,
  factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor,
  target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description;

-- 75: Disrupting Blow — on_hit, -5% dodge on enemy for 2 turns
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (75, 'Disrupting Blow',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_dodge'),
  'on_hit', 'percent', -5, false, 2,
  NULL, 'Reduce enemy dodge chance by *% for 2 turns on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name,
  core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type,
  factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor,
  target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description;

-- 76: Defensive Reflex — on_hit_taken, +10% dodge for 1 turn (player self-buff)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (76, 'Defensive Reflex',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_dodge'),
  'on_hit_taken', 'percent', 10, true, 1,
  NULL, 'Boost dodge chance by *% for 1 turn when hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name,
  core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type,
  factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor,
  target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description;

-- ── Replace duplicate talents with new duration-based effects ────────────────

-- R4C4 id=25 "Ruthless" was Savage Strikes (32) → Surge of Power (72)
UPDATE game.talents_info SET effect_id = 72 WHERE talent_id = 25;

-- R1C6 id=6 "Combat Training" was War Cry (45) → Adrenaline Rush (73)
UPDATE game.talents_info SET effect_id = 73 WHERE talent_id = 6;

-- R5C7 id=35 "Assault" was War Cry (45) → Battle Rhythm (74)
UPDATE game.talents_info SET effect_id = 74 WHERE talent_id = 35;

-- R6C6 id=41 "Demoralize" was Intimidate (39) → Disrupting Blow (75)
UPDATE game.talents_info SET effect_id = 75 WHERE talent_id = 41;

-- R7C2 id=44 "Evasive" was Catlike Grace (33) → Defensive Reflex (76)
UPDATE game.talents_info SET effect_id = 76 WHERE talent_id = 44;
