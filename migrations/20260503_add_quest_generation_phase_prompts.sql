-- Add phase-specific prompts for the quest generation pipeline.
-- Keeps existing prompt columns intact for backward compatibility.

ALTER TABLE IF EXISTS game.concept
    ADD COLUMN IF NOT EXISTS quest_plan_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS quest_write_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS quest_reward_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS quest_polish_prompt JSONB NOT NULL DEFAULT '{}'::jsonb;
