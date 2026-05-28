ALTER TABLE public.world_quests
    DROP CONSTRAINT IF EXISTS world_quests_pkey;

ALTER TABLE public.world_quests
    ADD CONSTRAINT world_quests_pkey
    PRIMARY KEY (server_id, server_day, settlement_id, quest_id);
