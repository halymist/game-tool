ALTER TABLE game.quests
ADD COLUMN IF NOT EXISTS failure_text TEXT;
