ALTER TABLE game.quests
    ADD COLUMN IF NOT EXISTS expedition_quest BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE game.world_info
    DROP COLUMN IF EXISTS failure_texts;
