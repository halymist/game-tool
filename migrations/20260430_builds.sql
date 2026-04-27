-- Builds tester: persisted player builds (stats + ordered talents/perks)
-- and per-milestone tournament runs.

CREATE SCHEMA IF NOT EXISTS tooling;

-- Player builds
CREATE TABLE IF NOT EXISTS tooling.builds (
    build_id      BIGSERIAL PRIMARY KEY,
    build_name    TEXT NOT NULL,
    description   TEXT,
    strength      INT NOT NULL DEFAULT 10,
    stamina       INT NOT NULL DEFAULT 10,
    agility       INT NOT NULL DEFAULT 10,
    luck          INT NOT NULL DEFAULT 10,
    armor         INT NOT NULL DEFAULT 10,
    min_damage    INT NOT NULL DEFAULT 5,
    max_damage    INT NOT NULL DEFAULT 10,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_builds_created ON tooling.builds (created_at DESC);

-- Talent assignments per build (mirrors game.enemy_talents)
CREATE TABLE IF NOT EXISTS tooling.build_talents (
    build_id     BIGINT NOT NULL REFERENCES tooling.builds(build_id) ON DELETE CASCADE,
    talent_id    INT NOT NULL,
    points       INT NOT NULL DEFAULT 1,
    talent_order INT NOT NULL,
    perk_id      INT,
    PRIMARY KEY (build_id, talent_order)
);

CREATE INDEX IF NOT EXISTS idx_build_talents_build ON tooling.build_talents (build_id);

-- Tournament runs
CREATE TABLE IF NOT EXISTS tooling.build_runs (
    run_id            BIGSERIAL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at       TIMESTAMPTZ,
    status            TEXT NOT NULL DEFAULT 'running',
    config            JSONB NOT NULL,
    total_matches     INTEGER NOT NULL DEFAULT 0,
    completed_matches INTEGER NOT NULL DEFAULT 0,
    current_milestone INTEGER NOT NULL DEFAULT 0,
    notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_build_runs_created ON tooling.build_runs (created_at DESC);

-- Per (build, milestone) results
CREATE TABLE IF NOT EXISTS tooling.build_results (
    id            BIGSERIAL PRIMARY KEY,
    run_id        BIGINT NOT NULL REFERENCES tooling.build_runs(run_id) ON DELETE CASCADE,
    build_id      BIGINT NOT NULL REFERENCES tooling.builds(build_id) ON DELETE CASCADE,
    milestone_day INT NOT NULL,
    rating        NUMERIC(10,2) NOT NULL DEFAULT 1000,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    rank          INTEGER,
    UNIQUE (run_id, build_id, milestone_day)
);

CREATE INDEX IF NOT EXISTS idx_build_results_run ON tooling.build_results (run_id, milestone_day);
