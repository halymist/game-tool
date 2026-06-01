-- Rebalance combat item baselines for the stamina/armor damage model.
-- Day 1 baseline:
--   armor pieces: +3-6 armor
--   item stat bonuses: +3-6 to each present stat
--   weapons: 9-13 damage
-- Rows within each gear type are treated as a day 1-70 progression and scaled
-- by 2% compounded per day after day 1.

WITH ranked AS (
    SELECT
        item_id,
        type,
        row_number() OVER (PARTITION BY type ORDER BY item_id) AS rn,
        count(*) OVER (PARTITION BY type) AS cnt
    FROM game.items
    WHERE type IN ('head', 'chest', 'hands', 'feet', 'belt', 'legs', 'back', 'amulet', 'weapon')
), planned AS (
    SELECT
        item_id,
        type,
        round(1 + (rn - 1) * 69.0 / greatest(cnt - 1, 1))::int AS day_num,
        3 + least(3, floor((rn - 1) * 4.0 / cnt)::int) AS base_stat
    FROM ranked
), scaled AS (
    SELECT
        item_id,
        type,
        base_stat,
        power(1.02, day_num - 1) AS scale_factor
    FROM planned
)
UPDATE game.items AS i
SET
    strength = CASE WHEN i.strength IS NULL THEN NULL ELSE greatest(1, round(s.base_stat * s.scale_factor)::int) END,
    stamina = CASE WHEN i.stamina IS NULL THEN NULL ELSE greatest(1, round(s.base_stat * s.scale_factor)::int) END,
    agility = CASE WHEN i.agility IS NULL THEN NULL ELSE greatest(1, round(s.base_stat * s.scale_factor)::int) END,
    luck = CASE WHEN i.luck IS NULL THEN NULL ELSE greatest(1, round(s.base_stat * s.scale_factor)::int) END,
    armor = CASE
        WHEN i.type IN ('head', 'chest', 'hands', 'feet', 'belt', 'legs', 'back') AND i.armor IS NOT NULL
            THEN greatest(1, round(s.base_stat * s.scale_factor)::int)
        ELSE i.armor
    END,
    min_damage = CASE
        WHEN i.type = 'weapon' THEN greatest(1, round(9 * s.scale_factor)::int)
        ELSE i.min_damage
    END,
    max_damage = CASE
        WHEN i.type = 'weapon' THEN greatest(1, round(13 * s.scale_factor)::int)
        ELSE i.max_damage
    END
FROM scaled AS s
WHERE i.item_id = s.item_id;