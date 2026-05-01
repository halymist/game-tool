-- Add a prompt slot for the post-plan validation/repair phase in quest generation.

ALTER TABLE IF EXISTS game.concept
    ADD COLUMN IF NOT EXISTS quest_validate_prompt JSONB NOT NULL DEFAULT '{}'::jsonb;
