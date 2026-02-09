-- Add settlement context fields
ALTER TABLE game.world_info
    ADD COLUMN IF NOT EXISTS key_issues TEXT,
    ADD COLUMN IF NOT EXISTS recent_events TEXT;

-- Add NPC context fields
ALTER TABLE game.npc
    ADD COLUMN IF NOT EXISTS role TEXT,
    ADD COLUMN IF NOT EXISTS personality TEXT,
    ADD COLUMN IF NOT EXISTS goals TEXT;

-- Concept prompt storage
CREATE TABLE IF NOT EXISTS game.concept (
    id INTEGER PRIMARY KEY DEFAULT 1,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    system_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    wilds_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE game.concept
    ADD COLUMN IF NOT EXISTS system_prompt JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS wilds_prompt JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Quest option effects and faction gating
ALTER TABLE game.quest_options
    ADD COLUMN IF NOT EXISTS option_effect_id INTEGER,
    ADD COLUMN IF NOT EXISTS option_effect_factor INTEGER,
    ADD COLUMN IF NOT EXISTS faction_required TEXT;



