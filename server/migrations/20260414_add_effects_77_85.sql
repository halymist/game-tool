-- Migration: Add 9 new duration-based effects (77-85)
-- Date: 2026-04-14
-- All use existing core effects + triggers with the duration system.

-- 77: Hardened — on_hit_taken, +8% armor for 2 turns (self)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (77, 'Hardened',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_hit_taken', 'percent', 8, true, 2,
  NULL, 'Boost armor by *% for 2 turns when hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 78: Focused Rage — on_hit_taken, +10% damage for 1 turn (self)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (78, 'Focused Rage',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_hit_taken', 'percent', 10, true, 1,
  NULL, 'Boost damage by *% for 1 turn when hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 79: Exposed Nerve — on_crit, -8% armor on enemy for 2 turns
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (79, 'Exposed Nerve',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_crit', 'percent', -8, false, 2,
  NULL, 'Reduce enemy armor by *% for 2 turns on critical hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 80: Shaken — on_hit, -5% crit on enemy for 2 turns
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (80, 'Shaken',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_crit'),
  'on_hit', 'percent', -5, false, 2,
  NULL, 'Reduce enemy critical chance by *% for 2 turns on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 81: Renewed Vigor — on_hit, +10% heal for 1 turn (self)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (81, 'Renewed Vigor',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_heal'),
  'on_hit', 'percent', 10, true, 1,
  NULL, 'Boost healing by *% for 1 turn on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 82: Crushing Weight — on_hit, -5% damage on enemy for 2 turns
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (82, 'Crushing Weight',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_hit', 'percent', -5, false, 2,
  NULL, 'Reduce enemy damage by *% for 2 turns on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 83: Fortifying Strike — on_hit, +5% armor for 2 turns (self)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (83, 'Fortifying Strike',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_hit', 'percent', 5, true, 2,
  NULL, 'Boost armor by *% for 2 turns on hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 84: Rattled — on_crit, -10% crit on enemy for 1 turn
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (84, 'Rattled',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_crit'),
  'on_crit', 'percent', -10, false, 1,
  NULL, 'Reduce enemy critical chance by *% for 1 turn on critical hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;

-- 85: Adrenaline Surge — on_crit_taken, +10% dodge for 2 turns (self)
INSERT INTO game.effects (effect_id, name, core_effect_id, trigger_type, factor_type, factor, target_self, duration, slot, description)
VALUES (85, 'Adrenaline Surge',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_dodge'),
  'on_crit_taken', 'percent', 10, true, 2,
  NULL, 'Boost dodge by *% for 2 turns when critically hit')
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type,
  factor = EXCLUDED.factor, target_self = EXCLUDED.target_self,
  duration = EXCLUDED.duration, description = EXCLUDED.description;
