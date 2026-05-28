UPDATE game.world_info
SET
    blessing1 = COALESCE(blessing1, 11),
    blessing2 = COALESCE(blessing2, 14),
    blessing3 = COALESCE(blessing3, 15)
WHERE (church = TRUE OR utility2_type = 'church')
  AND (blessing1 IS NULL OR blessing2 IS NULL OR blessing3 IS NULL);
