UPDATE game.effects
SET asset_id = 1
WHERE asset_id IS DISTINCT FROM 1;

ALTER TABLE game.effects
    ALTER COLUMN asset_id SET DEFAULT 1;
