-- Redesign expeditions: drop legacy slide/option/outcome graph, replace with
-- map-image + node graph where each node references an existing quest.

-- Drop legacy tooling + game mirrors (CASCADE clears outcomes/options).
DROP TABLE IF EXISTS tooling.expedition_outcomes CASCADE;
DROP TABLE IF EXISTS tooling.expedition_options CASCADE;
DROP TABLE IF EXISTS tooling.expedition_slides CASCADE;

DROP TABLE IF EXISTS game.expedition_outcomes CASCADE;
DROP TABLE IF EXISTS game.expedition_options CASCADE;
DROP TABLE IF EXISTS game.expedition_slides CASCADE;

-- One expedition row per settlement (1:1 for now, UNIQUE allows future relaxation).
CREATE TABLE tooling.expeditions (
    expedition_id  SERIAL PRIMARY KEY,
    settlement_id  INT NOT NULL UNIQUE REFERENCES game.world_info(settlement_id) ON DELETE CASCADE,
    map_asset_id   INT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nodes positioned in normalized [0,1] coords on the map image.
CREATE TABLE tooling.expedition_nodes (
    node_id        SERIAL PRIMARY KEY,
    expedition_id  INT NOT NULL REFERENCES tooling.expeditions(expedition_id) ON DELETE CASCADE,
    quest_id       INT NULL REFERENCES game.quests(quest_id) ON DELETE SET NULL,
    is_start       BOOLEAN NOT NULL DEFAULT false,
    pos_x          DOUBLE PRECISION NOT NULL,
    pos_y          DOUBLE PRECISION NOT NULL,
    label          TEXT NULL
);
CREATE INDEX idx_expedition_nodes_expedition ON tooling.expedition_nodes(expedition_id);

-- Undirected edges; either endpoint completed unlocks the other (runtime concern).
CREATE TABLE tooling.expedition_edges (
    edge_id        SERIAL PRIMARY KEY,
    expedition_id  INT NOT NULL REFERENCES tooling.expeditions(expedition_id) ON DELETE CASCADE,
    node_a         INT NOT NULL REFERENCES tooling.expedition_nodes(node_id) ON DELETE CASCADE,
    node_b         INT NOT NULL REFERENCES tooling.expedition_nodes(node_id) ON DELETE CASCADE,
    CHECK (node_a <> node_b)
);
CREATE INDEX idx_expedition_edges_expedition ON tooling.expedition_edges(expedition_id);
