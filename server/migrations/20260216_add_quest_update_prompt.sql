ALTER TABLE game.concept ADD COLUMN IF NOT EXISTS quest_update_prompt JSONB DEFAULT '{}';
