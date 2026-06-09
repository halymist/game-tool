-- Remove deprecated expedition description and ensure church slots use blessing perks only.

ALTER TABLE game.world_info
    DROP COLUMN IF EXISTS expedition_description;

WITH blessing_defaults AS (
    SELECT
        perks[1] AS b1,
        COALESCE(perks[2], perks[1]) AS b2,
        COALESCE(perks[3], COALESCE(perks[2], perks[1])) AS b3
    FROM (
        SELECT array_agg(perk_id ORDER BY perk_id) AS perks
        FROM game.perks_info
        WHERE COALESCE(is_blessing, false) = true
    ) src
), churches AS (
    SELECT
        w.settlement_id,
        w.blessing1,
        w.blessing2,
        w.blessing3,
        COALESCE(p1.is_blessing, false) AS b1_is_blessing,
        COALESCE(p2.is_blessing, false) AS b2_is_blessing,
        COALESCE(p3.is_blessing, false) AS b3_is_blessing
    FROM game.world_info w
    LEFT JOIN game.perks_info p1 ON p1.perk_id = w.blessing1
    LEFT JOIN game.perks_info p2 ON p2.perk_id = w.blessing2
    LEFT JOIN game.perks_info p3 ON p3.perk_id = w.blessing3
    WHERE COALESCE(w.church, false) = true
)
UPDATE game.world_info w
SET
    blessing1 = CASE
        WHEN c.blessing1 IS NULL OR NOT c.b1_is_blessing THEN d.b1
        ELSE c.blessing1
    END,
    blessing2 = CASE
        WHEN c.blessing2 IS NULL OR NOT c.b2_is_blessing THEN d.b2
        ELSE c.blessing2
    END,
    blessing3 = CASE
        WHEN c.blessing3 IS NULL OR NOT c.b3_is_blessing THEN d.b3
        ELSE c.blessing3
    END
FROM churches c
CROSS JOIN blessing_defaults d
WHERE w.settlement_id = c.settlement_id
  AND d.b1 IS NOT NULL
  AND (
      c.blessing1 IS NULL OR c.blessing2 IS NULL OR c.blessing3 IS NULL
      OR NOT c.b1_is_blessing OR NOT c.b2_is_blessing OR NOT c.b3_is_blessing
  );
