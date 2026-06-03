UPDATE game.expedition_nodes
SET pos_x = 0.5 + ((pos_x - 0.5) * 0.75),
    pos_y = 0.5 + ((pos_y - 0.5) * 0.75)
WHERE COALESCE(is_deleted, FALSE) = FALSE;