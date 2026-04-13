-- Migration: Move recent_events from per-settlement to global table
-- Also add event_id to questchain for event-specific quest chains

BEGIN;

-- 1. Create global recent_events table
CREATE TABLE game.recent_events (
    event_id    SERIAL PRIMARY KEY,
    event_name  VARCHAR(255) NOT NULL,
    description TEXT
);

-- 2. Migrate existing unique recent events from world_info into the new table
INSERT INTO game.recent_events (event_name)
SELECT DISTINCT unnest(recent_events)
FROM game.world_info
WHERE recent_events IS NOT NULL AND array_length(recent_events, 1) > 0;

-- 3. Add nullable event_id to questchain (NULL = default / applies to all events)
ALTER TABLE game.questchain
    ADD COLUMN event_id INTEGER REFERENCES game.recent_events(event_id) ON DELETE SET NULL;

-- 4. Drop recent_events column from world_info
ALTER TABLE game.world_info
    DROP COLUMN recent_events;

COMMIT;
