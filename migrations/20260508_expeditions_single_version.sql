-- Expedition versioning simplification:
-- keep version only on game.expeditions and remove node/edge version columns.
-- Any graph change bumps game.expeditions.version, and clients re-download the full graph.

DROP INDEX IF EXISTS idx_game_expedition_nodes_version;
DROP INDEX IF EXISTS idx_game_expedition_edges_version;

ALTER TABLE IF EXISTS game.expedition_nodes
    DROP COLUMN IF EXISTS version;

ALTER TABLE IF EXISTS game.expedition_edges
    DROP COLUMN IF EXISTS version;

CREATE OR REPLACE FUNCTION public.download_expedition(p_version INT DEFAULT 0)
RETURNS JSONB
LANGUAGE sql
AS $$
WITH changed_expeditions AS (
    SELECT expedition_id, settlement_id, map_asset_id, version, is_deleted
    FROM game.expeditions
    WHERE version > p_version
),
active_expeditions AS (
    SELECT expedition_id, settlement_id, map_asset_id, version
    FROM changed_expeditions
    WHERE is_deleted = FALSE
),
max_changed_version AS (
    SELECT COALESCE(MAX(version), p_version) AS version
    FROM changed_expeditions
)
SELECT jsonb_build_object(
    'version', (SELECT version FROM max_changed_version),
    'expeditions', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'expedition_id', e.expedition_id,
            'settlement_id', e.settlement_id,
            'map_asset_id', e.map_asset_id,
            'version', e.version,
            'nodes', COALESCE((
                SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'node_id', n.node_id,
                    'quest_id', n.quest_id,
                    'is_start', n.is_start,
                    'pos_x', n.pos_x,
                    'pos_y', n.pos_y,
                    'label', n.label
                )) ORDER BY n.node_id)
                FROM game.expedition_nodes n
                WHERE n.expedition_id = e.expedition_id
                  AND n.is_deleted = FALSE
            ), '[]'::jsonb),
            'edges', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'edge_id', ed.edge_id,
                    'node_a', ed.node_a,
                    'node_b', ed.node_b
                ) ORDER BY ed.edge_id)
                FROM game.expedition_edges ed
                WHERE ed.expedition_id = e.expedition_id
                  AND ed.is_deleted = FALSE
            ), '[]'::jsonb)
        )) ORDER BY e.expedition_id)
        FROM active_expeditions e
    ), '[]'::jsonb),
    'deleted_expedition_ids', COALESCE((
        SELECT jsonb_agg(expedition_id ORDER BY expedition_id)
        FROM changed_expeditions
        WHERE is_deleted = TRUE
    ), '[]'::jsonb),
    'deleted_node_ids', '[]'::jsonb,
    'deleted_edge_ids', '[]'::jsonb
);
$$;
