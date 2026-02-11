-- Add expedition_json_schema column to game.concept
ALTER TABLE game.concept
ADD COLUMN expedition_json_schema JSONB;