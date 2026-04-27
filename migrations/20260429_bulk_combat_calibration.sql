-- Add calibration columns to bulk combat tables.
-- "draws" stays in the schema but is no longer written.

ALTER TABLE tooling.bulk_combat_runs
    ADD COLUMN IF NOT EXISTS phases INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS current_phase INT NOT NULL DEFAULT 0;

ALTER TABLE tooling.bulk_combat_results
    ADD COLUMN IF NOT EXISTS current_value NUMERIC(6,2) NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS phase_history JSONB NOT NULL DEFAULT '[]'::jsonb;
