CREATE TABLE IF NOT EXISTS public.expedition_node_quests (
    server_id INTEGER NOT NULL,
    server_day INTEGER NOT NULL,
    settlement_id SMALLINT NOT NULL,
    expedition_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    location_id BIGINT NOT NULL,
    quest_id INTEGER NOT NULL,
    PRIMARY KEY (server_id, server_day, node_id)
);

CREATE INDEX IF NOT EXISTS idx_expedition_node_quests_server_day
    ON public.expedition_node_quests(server_id, server_day, settlement_id);

CREATE INDEX IF NOT EXISTS idx_expedition_node_quests_quest_id
    ON public.expedition_node_quests(quest_id);

UPDATE game.expedition_nodes
SET quest_id = NULL
WHERE quest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.download_expedition(p_version integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
AS $function$
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
                    'location_id', n.location_id,
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
$function$;