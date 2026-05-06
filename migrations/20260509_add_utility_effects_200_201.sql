-- Add/refresh utility effects used by non-combat systems and item references.
-- Keep fixed IDs for backwards compatibility with existing content and tooling.

INSERT INTO game.effects (effect_id, name, slot, factor, description)
VALUES
    (200, 'Quest HP Delta %', NULL, 0, 'Changes current HP by factor percent. Negative damages, positive heals.'),
    (201, 'Tempering Utility', NULL, 0, 'Utility effect used by hammer tempering and ingredient workflows.')
ON CONFLICT (effect_id) DO UPDATE
SET
    name = EXCLUDED.name,
    slot = EXCLUDED.slot,
    factor = EXCLUDED.factor,
    description = EXCLUDED.description;
