-- Add settlement context fields
ALTER TABLE game.world_info
    ADD COLUMN IF NOT EXISTS key_issues TEXT,
    ADD COLUMN IF NOT EXISTS recent_events TEXT;

-- Add NPC context fields
ALTER TABLE game.npc
    ADD COLUMN IF NOT EXISTS role TEXT,
    ADD COLUMN IF NOT EXISTS personality TEXT,
    ADD COLUMN IF NOT EXISTS goals TEXT;
