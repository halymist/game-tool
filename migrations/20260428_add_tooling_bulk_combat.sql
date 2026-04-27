CREATE SCHEMA IF NOT EXISTS tooling;

CREATE TABLE IF NOT EXISTS tooling.bulk_combat_runs (
    run_id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    config JSONB NOT NULL,
    total_matches INTEGER NOT NULL DEFAULT 0,
    completed_matches INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_bulk_combat_runs_created
    ON tooling.bulk_combat_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS tooling.bulk_combat_results (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES tooling.bulk_combat_runs(run_id) ON DELETE CASCADE,
    effect_id INTEGER NOT NULL,
    rating NUMERIC(10,2) NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    rank INTEGER,
    UNIQUE (run_id, effect_id)
);

CREATE INDEX IF NOT EXISTS idx_bulk_combat_results_run
    ON tooling.bulk_combat_results (run_id);
