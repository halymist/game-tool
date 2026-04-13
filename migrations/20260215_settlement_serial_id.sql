-- Migration: Recreate game.world_info with settlement_id as SERIAL PRIMARY KEY
-- Table is empty, so safe to drop and recreate

BEGIN;

DROP TABLE IF EXISTS game.world_info CASCADE;

CREATE TABLE game.world_info (
    settlement_id       SERIAL PRIMARY KEY,
    settlement_name     varchar,
    faction             smallint,
    description         text,
    context             text,
    settlement_asset_id integer,
    vendor_asset_id     integer,
    blacksmith_asset_id integer,
    alchemist_asset_id  integer,
    enchanter_asset_id  integer,
    trainer_asset_id    integer,
    church_asset_id     integer,
    arena_asset_id      integer,
    expedition_asset_id integer,
    blacksmith          boolean,
    alchemist           boolean,
    enchanter           boolean,
    trainer             boolean,
    church              boolean,
    blessing1           smallint,
    blessing2           smallint,
    blessing3           smallint,
    expedition_description text,
    expedition_context  text,
    vendor_on_entered   jsonb DEFAULT '{}'::jsonb,
    vendor_on_sold      jsonb DEFAULT '{}'::jsonb,
    vendor_on_bought    jsonb DEFAULT '{}'::jsonb,
    utility_on_entered  jsonb DEFAULT '{}'::jsonb,
    utility_on_placed   jsonb DEFAULT '{}'::jsonb,
    utility_on_action   jsonb DEFAULT '{}'::jsonb,
    key_issues          text[] DEFAULT ARRAY[]::text[],
    failure_texts       jsonb DEFAULT '[]'::jsonb,
    version             integer NOT NULL DEFAULT 1
);

COMMIT;
