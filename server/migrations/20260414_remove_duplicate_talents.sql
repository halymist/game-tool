-- Migration: Add 12 new effects (86-97) and replace 22 duplicate talents
-- Effects use on_start, on_every_other_turn, and gap-filling trigger+modifier combos

-- ============================================================
-- 12 NEW EFFECTS (86–97)
-- ============================================================

-- 86: War Preparation — on_start +damage self dur=3
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (86, 'War Preparation', NULL, 0,
  'Boost damage by *% for 3 turns at combat start',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_start', 'percent', true, 3)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 87: Guardian's Shield — on_start +armor self dur=3
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (87, 'Guardian''s Shield', NULL, 0,
  'Boost armor by *% for 3 turns at combat start',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_start', 'percent', true, 3)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 88: Tidal Force — on_every_other_turn +damage self dur=1
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (88, 'Tidal Force', NULL, 0,
  'Boost damage by *% every other turn',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_every_other_turn', 'percent', true, 1)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 89: Pulsing Ward — on_every_other_turn +armor self dur=1
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (89, 'Pulsing Ward', NULL, 0,
  'Boost armor by *% every other turn',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_every_other_turn', 'percent', true, 1)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 90: Weakening Strike — on_hit -heal enemy dur=2
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (90, 'Weakening Strike', NULL, 0,
  'Reduce enemy healing by *% for 2 turns on hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_heal'),
  'on_hit', 'percent', false, 2)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 91: Staggering Blow — on_crit -dodge enemy dur=2
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (91, 'Staggering Blow', NULL, 0,
  'Reduce enemy dodge by *% for 2 turns on critical hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_dodge'),
  'on_crit', 'percent', false, 2)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 92: Iron Resolve — on_hit_taken +crit self dur=2
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (92, 'Iron Resolve', NULL, 0,
  'Boost crit by *% for 2 turns when hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_crit'),
  'on_hit_taken', 'percent', true, 2)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 93: Vengeful Fury — on_crit_taken +damage self dur=2
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (93, 'Vengeful Fury', NULL, 0,
  'Boost damage by *% for 2 turns when critically hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_damage'),
  'on_crit_taken', 'percent', true, 2)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 94: Dodge Instinct — on_hit +dodge self dur=1
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (94, 'Dodge Instinct', NULL, 0,
  'Boost dodge by *% for 1 turn on hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_dodge'),
  'on_hit', 'percent', true, 1)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 95: Healing Fury — on_crit_taken +heal self dur=2
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (95, 'Healing Fury', NULL, 0,
  'Boost healing by *% for 2 turns when critically hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_heal'),
  'on_crit_taken', 'percent', true, 2)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 96: Armor Crusher — on_hit -armor enemy dur=1
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (96, 'Armor Crusher', NULL, 0,
  'Reduce enemy armor by *% for 1 turn on hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_armor'),
  'on_hit', 'percent', false, 1)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- 97: Crit Instinct — on_crit_taken +crit self dur=1
INSERT INTO game.effects (effect_id, name, slot, factor, description, core_effect_id, trigger_type, factor_type, target_self, duration)
VALUES (97, 'Crit Instinct', NULL, 0,
  'Boost crit by *% for 1 turn when critically hit',
  (SELECT core_effect_id FROM game.core_effects WHERE code = 'modify_crit'),
  'on_crit_taken', 'percent', true, 1)
ON CONFLICT (effect_id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, core_effect_id = EXCLUDED.core_effect_id,
  trigger_type = EXCLUDED.trigger_type, factor_type = EXCLUDED.factor_type, target_self = EXCLUDED.target_self, duration = EXCLUDED.duration;

-- ============================================================
-- REPLACE 22 DUPLICATE TALENTS
-- Each gets a unique effect; description set to NULL (uses effect desc)
-- ============================================================

-- Group: Bloodletter (41) — keep talent 7, replace 20, 24, 55
UPDATE game.talents_info SET effect_id = 90, factor = 2, description = NULL WHERE talent_id = 20;
-- Blood Scent → Weakening Strike (reduce enemy heal on_hit dur=2)
UPDATE game.talents_info SET effect_id = 80, factor = 1, description = NULL WHERE talent_id = 24;
-- Hemorrhage → Shaken (reduce enemy crit on_hit dur=2)
UPDATE game.talents_info SET effect_id = 82, factor = 1, description = NULL WHERE talent_id = 55;
-- Deep Cuts → Crushing Weight (reduce enemy damage on_hit dur=2)

-- Group: Swift Retaliation (35) — keep talent 12, replace 30, 45
UPDATE game.talents_info SET effect_id = 92, factor = 2, description = NULL WHERE talent_id = 30;
-- Riposte Master → Iron Resolve (boost crit on_hit_taken dur=2)
UPDATE game.talents_info SET effect_id = 93, factor = 3, description = NULL WHERE talent_id = 45;
-- Retribution → Vengeful Fury (boost damage on_crit_taken dur=2)

-- Group: Rapid Assault (36) — keep talent 4, replace 31, 40
UPDATE game.talents_info SET effect_id = 88, factor = 3, description = NULL WHERE talent_id = 31;
-- Twin Strike → Tidal Force (boost damage on_every_other_turn dur=1)
UPDATE game.talents_info SET effect_id = 94, factor = 2, description = NULL WHERE talent_id = 40;
-- Flurry → Dodge Instinct (boost dodge on_hit dur=1)

-- Group: Deflection (46) — keep talent 13, replace 43, 56
UPDATE game.talents_info SET effect_id = 77, factor = 2, description = NULL WHERE talent_id = 43;
-- Impenetrable → Hardened (boost armor on_hit_taken dur=2)
UPDATE game.talents_info SET effect_id = 87, factor = 4, description = NULL WHERE talent_id = 56;
-- Iron Will → Guardian's Shield (boost armor on_start dur=3)

-- Group: Killer Instinct (34) — keep talent 2, replace 26, 37
UPDATE game.talents_info SET effect_id = 84, factor = 2, description = NULL WHERE talent_id = 26;
-- Predator → Rattled (reduce enemy crit on_crit dur=1)
UPDATE game.talents_info SET effect_id = 91, factor = 2, description = NULL WHERE talent_id = 37;
-- Lethal Edge → Staggering Blow (reduce enemy dodge on_crit dur=2)

-- Group: Mending Touch (37) — keep talent 10, replace 17, 21
UPDATE game.talents_info SET effect_id = 81, factor = 3, description = NULL WHERE talent_id = 17;
-- Mending → Renewed Vigor (boost heal on_hit dur=1)
UPDATE game.talents_info SET effect_id = 95, factor = 4, description = NULL WHERE talent_id = 21;
-- Vitality → Healing Fury (boost heal on_crit_taken dur=2)

-- Group: Catlike Grace (33) — keep talent 9, replace 29, 51
UPDATE game.talents_info SET effect_id = 85, factor = 2, description = NULL WHERE talent_id = 29;
-- Lightning Reflexes → Adrenaline Surge (boost dodge on_crit_taken dur=2)
UPDATE game.talents_info SET effect_id = 78, factor = 3, description = NULL WHERE talent_id = 51;
-- Master Evader → Focused Rage (boost damage on_hit_taken dur=1)

-- Group: Toughened Hide (31) — keep talent 8, replace 14, 49
UPDATE game.talents_info SET effect_id = 83, factor = 2, description = NULL WHERE talent_id = 14;
-- Stoneskin → Fortifying Strike (boost armor on_hit dur=2)
UPDATE game.talents_info SET effect_id = 89, factor = 3, description = NULL WHERE talent_id = 49;
-- Bulwark → Pulsing Ward (boost armor on_every_other_turn dur=1)

-- Group: Venom Coating (47) — keep talent 27, replace 39
UPDATE game.talents_info SET effect_id = 79, factor = 2, description = NULL WHERE talent_id = 39;
-- Toxic Blade → Exposed Nerve (reduce enemy armor on_crit dur=2)

-- Group: Expose Weakness (38) — keep talent 5, replace 34
UPDATE game.talents_info SET effect_id = 96, factor = 2, description = NULL WHERE talent_id = 34;
-- Armor Crush → Armor Crusher (reduce enemy armor on_hit dur=1)

-- Group: Siphon Life (42) — keep talent 15, replace 52
UPDATE game.talents_info SET effect_id = 71, factor = 5, description = NULL WHERE talent_id = 52;
-- Master Healer → Defiant Roar (heal on_crit_taken)

-- Group: Recuperation (43) — keep talent 16, replace 48
UPDATE game.talents_info SET effect_id = 86, factor = 3, description = NULL WHERE talent_id = 48;
-- Patchwork → War Preparation (boost damage on_start dur=3)

-- Group: Piercing Blows (44) — keep talent 23, replace 53
UPDATE game.talents_info SET effect_id = 97, factor = 3, description = NULL WHERE talent_id = 53;
-- Concussion → Crit Instinct (boost crit on_crit_taken dur=1)
