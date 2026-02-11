-- Expedition dual storage + merge cleanup
-- Ensure base tables exist in the game schema (tooling schema already acts as the source of truth)
CREATE TABLE IF NOT EXISTS game.expedition_slides (
    tooling_id INTEGER PRIMARY KEY,
    slide_text TEXT NOT NULL DEFAULT '',
    asset_id INTEGER NOT NULL DEFAULT 0,
    effect_id INTEGER,
    effect_factor INTEGER,
    is_start BOOLEAN NOT NULL DEFAULT FALSE,
    settlement_id INTEGER,
    reward_stat_type TEXT,
    reward_stat_amount INTEGER,
    reward_talent BOOLEAN,
    reward_item INTEGER,
    reward_perk INTEGER,
    reward_blessing INTEGER,
    reward_potion INTEGER,
    pos_x DOUBLE PRECISION NOT NULL DEFAULT 100,
    pos_y DOUBLE PRECISION NOT NULL DEFAULT 100,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS game.expedition_options (
    tooling_id INTEGER PRIMARY KEY,
    slide_id INTEGER NOT NULL,
    option_text TEXT NOT NULL DEFAULT '',
    stat_type TEXT,
    stat_required INTEGER,
    effect_id INTEGER,
    effect_amount INTEGER,
    enemy_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS game.expedition_outcomes (
    tooling_id INTEGER PRIMARY KEY,
    option_id INTEGER NOT NULL,
    target_slide_id INTEGER NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1
);

-- Make sure tooling_id does not auto-increment inside the game schema (the value comes from tooling)
ALTER TABLE game.expedition_slides ALTER COLUMN tooling_id DROP DEFAULT;
ALTER TABLE game.expedition_options ALTER COLUMN tooling_id DROP DEFAULT;
ALTER TABLE game.expedition_outcomes ALTER COLUMN tooling_id DROP DEFAULT;

-- Enforce cascading relationships in the game schema
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'game.expedition_options'::regclass
          AND contype = 'f'
          AND confrelid = 'game.expedition_slides'::regclass
    ) THEN
        ALTER TABLE game.expedition_options
            ADD CONSTRAINT game_expedition_options_slide_fk
            FOREIGN KEY (slide_id)
            REFERENCES game.expedition_slides (tooling_id)
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'game.expedition_outcomes'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'game.expedition_options'::regclass
          AND a.attname = 'option_id'
    ) THEN
        ALTER TABLE game.expedition_outcomes
            ADD CONSTRAINT game_expedition_outcomes_option_fk
            FOREIGN KEY (option_id)
            REFERENCES game.expedition_options (tooling_id)
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'game.expedition_outcomes'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'game.expedition_slides'::regclass
          AND a.attname = 'target_slide_id'
    ) THEN
        ALTER TABLE game.expedition_outcomes
            ADD CONSTRAINT game_expedition_outcomes_target_fk
            FOREIGN KEY (target_slide_id)
            REFERENCES game.expedition_slides (tooling_id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS game_expedition_options_slide_idx ON game.expedition_options (slide_id);
CREATE INDEX IF NOT EXISTS game_expedition_outcomes_option_idx ON game.expedition_outcomes (option_id);
CREATE INDEX IF NOT EXISTS game_expedition_outcomes_target_idx ON game.expedition_outcomes (target_slide_id);

-- Selective merge that only touches changed rows
CREATE OR REPLACE FUNCTION tooling.merge_expeditions()
RETURNS void
LANGUAGE plpgsql
AS $merge$
BEGIN
    INSERT INTO game.expedition_slides AS ges (
        tooling_id, slide_text, asset_id, effect_id, effect_factor,
        is_start, settlement_id, reward_stat_type, reward_stat_amount,
        reward_talent, reward_item, reward_perk, reward_blessing,
        reward_potion, pos_x, pos_y, version
    )
    SELECT
        tooling_id, slide_text, asset_id, effect_id, effect_factor,
        is_start, settlement_id, reward_stat_type, reward_stat_amount,
        reward_talent, reward_item, reward_perk, reward_blessing,
        reward_potion, pos_x, pos_y, version
    FROM tooling.expedition_slides
    ON CONFLICT (tooling_id) DO UPDATE SET
        slide_text = EXCLUDED.slide_text,
        asset_id = EXCLUDED.asset_id,
        effect_id = EXCLUDED.effect_id,
        effect_factor = EXCLUDED.effect_factor,
        is_start = EXCLUDED.is_start,
        settlement_id = EXCLUDED.settlement_id,
        reward_stat_type = EXCLUDED.reward_stat_type,
        reward_stat_amount = EXCLUDED.reward_stat_amount,
        reward_talent = EXCLUDED.reward_talent,
        reward_item = EXCLUDED.reward_item,
        reward_perk = EXCLUDED.reward_perk,
        reward_blessing = EXCLUDED.reward_blessing,
        reward_potion = EXCLUDED.reward_potion,
        pos_x = EXCLUDED.pos_x,
        pos_y = EXCLUDED.pos_y,
        version = EXCLUDED.version
    WHERE (
        ges.slide_text IS DISTINCT FROM EXCLUDED.slide_text OR
        ges.asset_id IS DISTINCT FROM EXCLUDED.asset_id OR
        ges.effect_id IS DISTINCT FROM EXCLUDED.effect_id OR
        ges.effect_factor IS DISTINCT FROM EXCLUDED.effect_factor OR
        ges.is_start IS DISTINCT FROM EXCLUDED.is_start OR
        ges.settlement_id IS DISTINCT FROM EXCLUDED.settlement_id OR
        ges.reward_stat_type IS DISTINCT FROM EXCLUDED.reward_stat_type OR
        ges.reward_stat_amount IS DISTINCT FROM EXCLUDED.reward_stat_amount OR
        ges.reward_talent IS DISTINCT FROM EXCLUDED.reward_talent OR
        ges.reward_item IS DISTINCT FROM EXCLUDED.reward_item OR
        ges.reward_perk IS DISTINCT FROM EXCLUDED.reward_perk OR
        ges.reward_blessing IS DISTINCT FROM EXCLUDED.reward_blessing OR
        ges.reward_potion IS DISTINCT FROM EXCLUDED.reward_potion OR
        ges.pos_x IS DISTINCT FROM EXCLUDED.pos_x OR
        ges.pos_y IS DISTINCT FROM EXCLUDED.pos_y OR
        ges.version IS DISTINCT FROM EXCLUDED.version
    );

    -- Options
    INSERT INTO game.expedition_options AS geo (
        tooling_id, slide_id, option_text, stat_type, stat_required,
        effect_id, effect_amount, enemy_id, version
    )
    SELECT
        tooling_id, slide_id, option_text, stat_type, stat_required,
        effect_id, effect_amount, enemy_id, version
    FROM tooling.expedition_options
    ON CONFLICT (tooling_id) DO UPDATE SET
        slide_id = EXCLUDED.slide_id,
        option_text = EXCLUDED.option_text,
        stat_type = EXCLUDED.stat_type,
        stat_required = EXCLUDED.stat_required,
        effect_id = EXCLUDED.effect_id,
        effect_amount = EXCLUDED.effect_amount,
        enemy_id = EXCLUDED.enemy_id,
        version = EXCLUDED.version
    WHERE (
        geo.slide_id IS DISTINCT FROM EXCLUDED.slide_id OR
        geo.option_text IS DISTINCT FROM EXCLUDED.option_text OR
        geo.stat_type IS DISTINCT FROM EXCLUDED.stat_type OR
        geo.stat_required IS DISTINCT FROM EXCLUDED.stat_required OR
        geo.effect_id IS DISTINCT FROM EXCLUDED.effect_id OR
        geo.effect_amount IS DISTINCT FROM EXCLUDED.effect_amount OR
        geo.enemy_id IS DISTINCT FROM EXCLUDED.enemy_id OR
        geo.version IS DISTINCT FROM EXCLUDED.version
    );

    -- Outcomes
    INSERT INTO game.expedition_outcomes AS geo2 (
        tooling_id, option_id, target_slide_id, weight, version
    )
    SELECT
        tooling_id, option_id, target_slide_id, weight, version
    FROM tooling.expedition_outcomes
    ON CONFLICT (tooling_id) DO UPDATE SET
        option_id = EXCLUDED.option_id,
        target_slide_id = EXCLUDED.target_slide_id,
        weight = EXCLUDED.weight,
        version = EXCLUDED.version
    WHERE (
        geo2.option_id IS DISTINCT FROM EXCLUDED.option_id OR
        geo2.target_slide_id IS DISTINCT FROM EXCLUDED.target_slide_id OR
        geo2.weight IS DISTINCT FROM EXCLUDED.weight OR
        geo2.version IS DISTINCT FROM EXCLUDED.version
    );

    -- Delete stale rows (children first)
    DELETE FROM game.expedition_outcomes go
    WHERE NOT EXISTS (
        SELECT 1 FROM tooling.expedition_outcomes teo
        WHERE teo.tooling_id = go.tooling_id
    );

    DELETE FROM game.expedition_options go
    WHERE NOT EXISTS (
        SELECT 1 FROM tooling.expedition_options teo
        WHERE teo.tooling_id = go.tooling_id
    );

    DELETE FROM game.expedition_slides gs
    WHERE NOT EXISTS (
        SELECT 1 FROM tooling.expedition_slides ts
        WHERE ts.tooling_id = gs.tooling_id
    );
END;
$merge$;