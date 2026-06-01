INSERT INTO game.effects (effect_id, name, slot, factor, description)
VALUES (202, 'Perk Slot Utility', NULL, 0, 'Utility effect used by perk-slot talents to expose perk selection.')
ON CONFLICT (effect_id) DO UPDATE
SET
    name = EXCLUDED.name,
    slot = EXCLUDED.slot,
    factor = EXCLUDED.factor,
    description = EXCLUDED.description;

UPDATE game.talents_info
SET effect_id = 202,
    factor = COALESCE(factor, 0),
    version = COALESCE(version, 1) + 1
WHERE COALESCE(perk_slot, FALSE) = TRUE
  AND effect_id IS DISTINCT FROM 202;
