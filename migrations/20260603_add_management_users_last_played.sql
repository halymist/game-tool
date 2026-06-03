DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'management' AND table_name = 'users'
    ) THEN
        ALTER TABLE management.users
            ADD COLUMN IF NOT EXISTS last_played TIMESTAMPTZ;

        ALTER TABLE management.users
            ALTER COLUMN last_played SET DEFAULT NOW();

        UPDATE management.users
        SET last_played = COALESCE(last_played, NOW())
        WHERE last_played IS NULL;

        CREATE INDEX IF NOT EXISTS idx_management_users_last_played
            ON management.users (last_played);
    END IF;
END $$;