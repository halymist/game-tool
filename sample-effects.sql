-- Sample Effects Data for Testing
-- Run this to populate your Effects table with test data

-- Clear existing data (optional)
-- DELETE FROM "Effects";

-- Insert sample effects
INSERT INTO "Effects" ("name", "description") VALUES 
    ('Poison', 'Deals damage over time to the target'),
    ('Stun', 'Prevents the target from taking actions for several turns'),
    ('Heal', 'Restores health points to the target'),
    ('Burn', 'Fire damage that continues for multiple turns'),
    ('Shield', 'Reduces incoming damage by a percentage'),
    ('Freeze', 'Slows down the target and may prevent movement'),
    ('Blind', 'Reduces accuracy of the target''s attacks'),
    ('Rage', 'Increases damage output but reduces defense'),
    ('Regeneration', 'Gradually restores health over time'),
    ('Curse', 'Reduces all stats of the target temporarily')
ON CONFLICT ("id") DO NOTHING;

-- Check the inserted data
SELECT * FROM "Effects" ORDER BY "id";
