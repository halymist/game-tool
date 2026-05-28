WITH target_settlements AS (
    SELECT settlement_id
    FROM game.world_info
    WHERE enchanter = TRUE
       OR utility2_type = 'enchanter'
)
DELETE FROM game.enchanter_inventory ei
USING target_settlements ts
WHERE ei.settlement_id = ts.settlement_id;

WITH target_settlements AS (
    SELECT settlement_id
    FROM game.world_info
    WHERE enchanter = TRUE
       OR utility2_type = 'enchanter'
),
canonical_effects(effect_id) AS (
    VALUES
        (9), (19), (27), (65), (75), (83),   -- back
        (7), (17), (25), (61), (73), (81),   -- belt
        (3), (14), (22), (30), (70), (78),   -- chest
        (5), (15), (23), (59), (71), (79),   -- hands
        (1), (12), (21), (29), (69), (77),   -- head
        (10), (20), (28), (67), (76), (84)   -- weapon
)
INSERT INTO game.enchanter_inventory (settlement_id, effect_id)
SELECT ts.settlement_id, ce.effect_id
FROM target_settlements ts
CROSS JOIN canonical_effects ce;
