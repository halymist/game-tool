-- Move expedition graph storage from tooling schema to game schema and add
-- versioned soft-delete rows for client-side delta sync.

CREATE TABLE IF NOT EXISTS game.expeditions (
    expedition_id SERIAL PRIMARY KEY,
    settlement_id INT NOT NULL UNIQUE REFERENCES game.world_info(settlement_id) ON DELETE CASCADE,
    map_asset_id  INT NULL,
    version       INT NOT NULL DEFAULT 1,
    is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.expedition_nodes (
    node_id        SERIAL PRIMARY KEY,
    expedition_id  INT NOT NULL REFERENCES game.expeditions(expedition_id) ON DELETE CASCADE,
    quest_id       INT NULL REFERENCES game.quests(quest_id) ON DELETE SET NULL,
    is_start       BOOLEAN NOT NULL DEFAULT FALSE,
    pos_x          DOUBLE PRECISION NOT NULL,
    pos_y          DOUBLE PRECISION NOT NULL,
    label          TEXT NULL,
    version        INT NOT NULL DEFAULT 1,
    is_deleted     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS game.expedition_edges (
    edge_id        SERIAL PRIMARY KEY,
    expedition_id  INT NOT NULL REFERENCES game.expeditions(expedition_id) ON DELETE CASCADE,
    node_a         INT NOT NULL REFERENCES game.expedition_nodes(node_id) ON DELETE CASCADE,
    node_b         INT NOT NULL REFERENCES game.expedition_nodes(node_id) ON DELETE CASCADE,
    version        INT NOT NULL DEFAULT 1,
    is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (node_a < node_b)
);

CREATE INDEX IF NOT EXISTS idx_game_expeditions_settlement ON game.expeditions(settlement_id);
CREATE INDEX IF NOT EXISTS idx_game_expeditions_version ON game.expeditions(version);
CREATE INDEX IF NOT EXISTS idx_game_expeditions_active ON game.expeditions(is_deleted);

CREATE INDEX IF NOT EXISTS idx_game_expedition_nodes_expedition ON game.expedition_nodes(expedition_id);
CREATE INDEX IF NOT EXISTS idx_game_expedition_nodes_version ON game.expedition_nodes(version);
CREATE INDEX IF NOT EXISTS idx_game_expedition_nodes_active ON game.expedition_nodes(is_deleted);

CREATE INDEX IF NOT EXISTS idx_game_expedition_edges_expedition ON game.expedition_edges(expedition_id);
CREATE INDEX IF NOT EXISTS idx_game_expedition_edges_version ON game.expedition_edges(version);
CREATE INDEX IF NOT EXISTS idx_game_expedition_edges_active ON game.expedition_edges(is_deleted);

CREATE UNIQUE INDEX IF NOT EXISTS uq_game_expedition_edges_pair
    ON game.expedition_edges(expedition_id, node_a, node_b);

DO $$
BEGIN
    IF to_regclass('tooling.expeditions') IS NOT NULL THEN
        INSERT INTO game.expeditions (expedition_id, settlement_id, map_asset_id, version, is_deleted, updated_at)
        SELECT expedition_id, settlement_id, map_asset_id, 1, FALSE, COALESCE(updated_at, now())
        FROM tooling.expeditions
        ON CONFLICT (settlement_id) DO NOTHING;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('tooling.expedition_nodes') IS NOT NULL THEN
        INSERT INTO game.expedition_nodes (node_id, expedition_id, quest_id, is_start, pos_x, pos_y, label, version, is_deleted)
        SELECT n.node_id, n.expedition_id, n.quest_id, n.is_start, n.pos_x, n.pos_y, n.label, 1, FALSE
        FROM tooling.expedition_nodes n
        JOIN game.expeditions e ON e.expedition_id = n.expedition_id
        ON CONFLICT (node_id) DO NOTHING;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('tooling.expedition_edges') IS NOT NULL THEN
        INSERT INTO game.expedition_edges (edge_id, expedition_id, node_a, node_b, version, is_deleted)
        SELECT
            ed.edge_id,
            ed.expedition_id,
            LEAST(ed.node_a, ed.node_b),
            GREATEST(ed.node_a, ed.node_b),
            1,
            FALSE
        FROM tooling.expedition_edges ed
        JOIN game.expedition_nodes na ON na.node_id = ed.node_a
        JOIN game.expedition_nodes nb ON nb.node_id = ed.node_b
        WHERE ed.node_a <> ed.node_b
        ON CONFLICT (edge_id) DO NOTHING;
    END IF;
END $$;

SELECT setval(
    pg_get_serial_sequence('game.expeditions', 'expedition_id'),
    COALESCE((SELECT MAX(expedition_id) FROM game.expeditions), 1),
    TRUE
);

SELECT setval(
    pg_get_serial_sequence('game.expedition_nodes', 'node_id'),
    COALESCE((SELECT MAX(node_id) FROM game.expedition_nodes), 1),
    TRUE
);

SELECT setval(
    pg_get_serial_sequence('game.expedition_edges', 'edge_id'),
    COALESCE((SELECT MAX(edge_id) FROM game.expedition_edges), 1),
    TRUE
);


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
                    'label', n.label,
                    'version', n.version
                )) ORDER BY n.node_id)
                FROM game.expedition_nodes n
                WHERE n.expedition_id = e.expedition_id
                  AND n.is_deleted = FALSE
            ), '[]'::jsonb),
            'edges', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'edge_id', ed.edge_id,
                    'node_a', ed.node_a,
                    'node_b', ed.node_b,
                    'version', ed.version
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
