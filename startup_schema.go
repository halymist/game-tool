package main

import (
	"database/sql"
	"fmt"
	"log"
)

const ensureQuestAndExpeditionLocationSQL = `
ALTER TABLE game.quests
    ADD COLUMN IF NOT EXISTS location_id BIGINT;

ALTER TABLE game.expedition_nodes
    ADD COLUMN IF NOT EXISTS location_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'quests_location_id_fkey'
    ) THEN
        ALTER TABLE game.quests
            ADD CONSTRAINT quests_location_id_fkey
            FOREIGN KEY (location_id)
            REFERENCES game.locations(location_id)
            ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'expedition_nodes_location_id_fkey'
    ) THEN
        ALTER TABLE game.expedition_nodes
            ADD CONSTRAINT expedition_nodes_location_id_fkey
            FOREIGN KEY (location_id)
            REFERENCES game.locations(location_id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quests_location_id ON game.quests(location_id);
CREATE INDEX IF NOT EXISTS idx_expedition_nodes_location_id ON game.expedition_nodes(location_id);

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

CREATE TABLE IF NOT EXISTS game.admin_tool_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH touched_expeditions AS (
    SELECT DISTINCT expedition_id
    FROM game.expedition_nodes
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND location_id IS NULL
), centroids AS (
    SELECT n.expedition_id,
           AVG(n.pos_x) AS center_x,
           AVG(n.pos_y) AS center_y
    FROM game.expedition_nodes n
    JOIN touched_expeditions te ON te.expedition_id = n.expedition_id
    WHERE COALESCE(n.is_deleted, FALSE) = FALSE
    GROUP BY n.expedition_id
)
UPDATE game.expedition_nodes n
SET pos_x = c.center_x + ((n.pos_x - c.center_x) * 0.72),
    pos_y = c.center_y + ((n.pos_y - c.center_y) * 0.72)
FROM centroids c
WHERE n.expedition_id = c.expedition_id
  AND COALESCE(n.is_deleted, FALSE) = FALSE;

WITH location_pool AS (
    SELECT e.expedition_id,
           l.location_id,
           ROW_NUMBER() OVER (PARTITION BY e.expedition_id ORDER BY l.location_id) AS location_rank,
           COUNT(*) OVER (PARTITION BY e.expedition_id) AS location_count
    FROM game.expeditions e
    JOIN game.locations l ON l.settlement_id = e.settlement_id
    WHERE COALESCE(e.is_deleted, FALSE) = FALSE
), nodes_to_assign AS (
    SELECT n.node_id,
           n.expedition_id,
           ROW_NUMBER() OVER (PARTITION BY n.expedition_id ORDER BY n.is_start DESC, n.node_id) AS node_rank
    FROM game.expedition_nodes n
    WHERE COALESCE(n.is_deleted, FALSE) = FALSE
      AND n.location_id IS NULL
), assignment AS (
    SELECT n.node_id,
           lp.location_id
    FROM nodes_to_assign n
    JOIN location_pool lp
      ON lp.expedition_id = n.expedition_id
     AND lp.location_rank = (((n.node_rank - 1) % lp.location_count) + 1)
)
UPDATE game.expedition_nodes n
SET location_id = assignment.location_id
FROM assignment
WHERE n.node_id = assignment.node_id;

WITH inferred_quest_locations AS (
    SELECT DISTINCT ON (n.quest_id)
           n.quest_id,
           n.location_id
    FROM game.expedition_nodes n
    JOIN game.expeditions e ON e.expedition_id = n.expedition_id
    WHERE COALESCE(n.is_deleted, FALSE) = FALSE
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND n.quest_id IS NOT NULL
      AND n.location_id IS NOT NULL
    ORDER BY n.quest_id, n.is_start DESC, n.node_id
)
UPDATE game.quests q
SET location_id = i.location_id,
    expedition_quest = TRUE
FROM inferred_quest_locations i
WHERE q.quest_id = i.quest_id
  AND (q.location_id IS NULL OR COALESCE(q.expedition_quest, FALSE) = FALSE);

DO $$
BEGIN
        IF NOT EXISTS (
                SELECT 1
                FROM game.admin_tool_migrations
                WHERE migration_key = '20260601_compact_expedition_location_nodes'
        ) THEN
                WITH ranked_nodes AS (
                        SELECT n.node_id,
                                     n.expedition_id,
                                     ROW_NUMBER() OVER (
                                             PARTITION BY n.expedition_id, n.location_id
                                             ORDER BY n.is_start DESC, (n.quest_id IS NOT NULL) DESC, n.node_id
                                     ) AS location_rank
                        FROM game.expedition_nodes n
                        WHERE COALESCE(n.is_deleted, FALSE) = FALSE
                            AND n.location_id IS NOT NULL
                ), duplicate_nodes AS (
                        SELECT node_id, expedition_id
                        FROM ranked_nodes
                        WHERE location_rank > 1
                )
                UPDATE game.expedition_edges e
                SET is_deleted = TRUE
                FROM duplicate_nodes d
                WHERE e.expedition_id = d.expedition_id
                    AND COALESCE(e.is_deleted, FALSE) = FALSE
                    AND (e.node_a = d.node_id OR e.node_b = d.node_id);

                WITH ranked_nodes AS (
                        SELECT n.node_id,
                                     ROW_NUMBER() OVER (
                                             PARTITION BY n.expedition_id, n.location_id
                                             ORDER BY n.is_start DESC, (n.quest_id IS NOT NULL) DESC, n.node_id
                                     ) AS location_rank
                        FROM game.expedition_nodes n
                        WHERE COALESCE(n.is_deleted, FALSE) = FALSE
                            AND n.location_id IS NOT NULL
                )
                UPDATE game.expedition_nodes n
                SET is_deleted = TRUE,
                        is_start = FALSE
                FROM ranked_nodes r
                WHERE n.node_id = r.node_id
                    AND r.location_rank > 1;

                WITH active_nodes AS (
                        SELECT n.node_id,
                                     n.expedition_id,
                                     ROW_NUMBER() OVER (PARTITION BY n.expedition_id ORDER BY n.is_start DESC, n.location_id, n.node_id) AS node_rank,
                                     COUNT(*) OVER (PARTITION BY n.expedition_id) AS node_count
                        FROM game.expedition_nodes n
                        WHERE COALESCE(n.is_deleted, FALSE) = FALSE
                            AND n.location_id IS NOT NULL
                ), layout AS (
                        SELECT node_id,
                                     node_rank,
                                     node_count,
                                     CEIL(SQRT(node_count::numeric))::int AS cols,
                                     CEIL(node_count::numeric / CEIL(SQRT(node_count::numeric)))::int AS rows
                        FROM active_nodes
                )
                UPDATE game.expedition_nodes n
                SET pos_x = CASE
                                                WHEN layout.node_count <= 1 THEN 0.5
                                                ELSE LEAST(0.82, GREATEST(0.18, 0.5 + ((((layout.node_rank - 1) % layout.cols)::numeric - ((layout.cols - 1)::numeric / 2)) * 0.16)))
                                        END,
                        pos_y = CASE
                                                WHEN layout.node_count <= 1 THEN 0.5
                                                ELSE LEAST(0.82, GREATEST(0.18, 0.5 + ((((layout.node_rank - 1) / layout.cols)::numeric - ((layout.rows - 1)::numeric / 2)) * 0.16)))
                                        END,
                        is_start = layout.node_rank = 1
                FROM layout
                WHERE n.node_id = layout.node_id;

                WITH compacted_expeditions AS (
                        SELECT expedition_id
                        FROM game.expedition_nodes
                        WHERE COALESCE(is_deleted, FALSE) = FALSE
                            AND location_id IS NOT NULL
                        GROUP BY expedition_id
                        HAVING COUNT(*) > 1
                )
                UPDATE game.expedition_edges e
                SET is_deleted = TRUE
                FROM compacted_expeditions c
                WHERE e.expedition_id = c.expedition_id
                    AND COALESCE(e.is_deleted, FALSE) = FALSE;

                WITH ordered_nodes AS (
                        SELECT n.expedition_id,
                                     n.node_id,
                                     ROW_NUMBER() OVER (PARTITION BY n.expedition_id ORDER BY n.is_start DESC, n.location_id, n.node_id) AS node_rank
                        FROM game.expedition_nodes n
                        WHERE COALESCE(n.is_deleted, FALSE) = FALSE
                            AND n.location_id IS NOT NULL
                ), edge_pairs AS (
                        SELECT a.expedition_id,
                                     LEAST(a.node_id, b.node_id) AS node_a,
                                     GREATEST(a.node_id, b.node_id) AS node_b
                        FROM ordered_nodes a
                        JOIN ordered_nodes b
                            ON b.expedition_id = a.expedition_id
                         AND b.node_rank = a.node_rank + 1
                )
                INSERT INTO game.expedition_edges (expedition_id, node_a, node_b, is_deleted)
                SELECT expedition_id, node_a, node_b, FALSE
                FROM edge_pairs
                ON CONFLICT (expedition_id, node_a, node_b)
                DO UPDATE SET is_deleted = FALSE;

                INSERT INTO game.admin_tool_migrations (migration_key)
                VALUES ('20260601_compact_expedition_location_nodes');
        END IF;
END $$;
`

func ensureQuestAndExpeditionLocationSupport(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database not connected")
	}
	if _, err := db.Exec(ensureQuestAndExpeditionLocationSQL); err != nil {
		return err
	}
	log.Printf("SUCCESS: ensured quest/expedition location schema and backfill")
	return nil
}

const ensureTalentEffectAssetsSQL = `
ALTER TABLE game.talents_info
    DROP COLUMN IF EXISTS asset_id;

INSERT INTO game.effects (effect_id, name, slot, factor, description)
VALUES (202, 'Perk Slot Utility', NULL, 0, 'Utility effect used by perk-slot talents to expose perk selection.')
ON CONFLICT (effect_id) DO UPDATE
SET
    name = EXCLUDED.name,
    slot = EXCLUDED.slot,
    factor = EXCLUDED.factor,
    description = EXCLUDED.description;

UPDATE game.talents_info
SET effect_id = 202,
    factor = COALESCE(factor, 0),
    version = COALESCE(version, 1) + 1
WHERE COALESCE(perk_slot, FALSE) = TRUE
  AND effect_id IS DISTINCT FROM 202;
`

func ensureTalentEffectAssetSupport(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database not connected")
	}
	if _, err := db.Exec(ensureTalentEffectAssetsSQL); err != nil {
		return err
	}
	log.Printf("SUCCESS: ensured talents use effect assets")
	return nil
}
