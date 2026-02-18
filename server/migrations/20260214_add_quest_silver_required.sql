-- Add silver_required column to quest_options table
ALTER TABLE game.quest_options ADD COLUMN IF NOT EXISTS silver_required integer;
