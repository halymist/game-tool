ALTER TABLE game.world_info
    ADD COLUMN IF NOT EXISTS healer_asset_id INTEGER,
    ADD COLUMN IF NOT EXISTS healer_on_entered JSONB,
    ADD COLUMN IF NOT EXISTS healer_on_healed JSONB,
    ADD COLUMN IF NOT EXISTS healer_on_cured JSONB,
    ADD COLUMN IF NOT EXISTS healer_msg_rect JSONB,
    ADD COLUMN IF NOT EXISTS utility2_type VARCHAR(32),
    ADD COLUMN IF NOT EXISTS utility2_asset_id INTEGER,
    ADD COLUMN IF NOT EXISTS utility2_on_entered JSONB,
    ADD COLUMN IF NOT EXISTS utility2_on_placed JSONB,
    ADD COLUMN IF NOT EXISTS utility2_on_action JSONB,
    ADD COLUMN IF NOT EXISTS utility2_msg_rect JSONB;

CREATE OR REPLACE FUNCTION public.download_world(p_version integer)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    WITH changed AS (
        SELECT
            w.*,
            CASE
                WHEN w.blacksmith AND w.utility2_type IS DISTINCT FROM 'blacksmith' THEN 'blacksmith'
                WHEN w.alchemist AND w.utility2_type IS DISTINCT FROM 'alchemist' THEN 'alchemist'
                WHEN w.enchanter AND w.utility2_type IS DISTINCT FROM 'enchanter' THEN 'enchanter'
                WHEN w.trainer AND w.utility2_type IS DISTINCT FROM 'trainer' THEN 'trainer'
                WHEN w.church AND w.utility2_type IS DISTINCT FROM 'church' THEN 'church'
                WHEN w.blacksmith THEN 'blacksmith'
                WHEN w.alchemist THEN 'alchemist'
                WHEN w.enchanter THEN 'enchanter'
                WHEN w.trainer THEN 'trainer'
                WHEN w.church THEN 'church'
            END AS utility1_type
        FROM game.world_info w
        WHERE w.version > p_version
    ),
    shaped AS (
        SELECT
            c.*,
            CASE c.utility1_type
                WHEN 'blacksmith' THEN c.blacksmith_asset_id
                WHEN 'alchemist' THEN c.alchemist_asset_id
                WHEN 'enchanter' THEN c.enchanter_asset_id
                WHEN 'trainer' THEN c.trainer_asset_id
                WHEN 'church' THEN c.church_asset_id
            END AS utility1_asset_id
        FROM changed c
    )
    SELECT jsonb_build_object(
        'version', COALESCE(MAX(s.version), p_version),
        'settlements', COALESCE(
            jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'settlement_id', s.settlement_id,
                'settlement_name', s.settlement_name,
                'settlement_asset_id', s.settlement_asset_id,
                'faction', s.faction,
                'description', s.description,
                'expedition_asset_id', s.expedition_asset_id,
                'expedition_description', s.expedition_description,
                'arena_asset_id', s.arena_asset_id,
                'vendor', jsonb_strip_nulls(jsonb_build_object(
                    'vendor_asset_id', s.vendor_asset_id,
                    'msg_rect', s.vendor_msg_rect,
                    'on_entered', s.vendor_on_entered,
                    'on_sold', s.vendor_on_sold,
                    'on_bought', s.vendor_on_bought
                )),
                'healer', jsonb_strip_nulls(jsonb_build_object(
                    'healer_asset_id', s.healer_asset_id,
                    'msg_rect', s.healer_msg_rect,
                    'on_entered', s.healer_on_entered,
                    'on_healed', s.healer_on_healed,
                    'on_cured', s.healer_on_cured
                )),
                'utility', jsonb_strip_nulls(jsonb_build_object(
                    'type', s.utility1_type,
                    'utility_asset_id', s.utility1_asset_id,
                    'msg_rect', s.utility_msg_rect,
                    'blessing1', CASE WHEN s.utility1_type = 'church' THEN s.blessing1 END,
                    'blessing2', CASE WHEN s.utility1_type = 'church' THEN s.blessing2 END,
                    'blessing3', CASE WHEN s.utility1_type = 'church' THEN s.blessing3 END,
                    'on_entered', s.utility_on_entered,
                    'on_placed', s.utility_on_placed,
                    'on_action', s.utility_on_action
                )),
                'utility2', jsonb_strip_nulls(jsonb_build_object(
                    'type', s.utility2_type,
                    'utility_asset_id', s.utility2_asset_id,
                    'msg_rect', s.utility2_msg_rect,
                    'blessing1', CASE WHEN s.utility2_type = 'church' THEN s.blessing1 END,
                    'blessing2', CASE WHEN s.utility2_type = 'church' THEN s.blessing2 END,
                    'blessing3', CASE WHEN s.utility2_type = 'church' THEN s.blessing3 END,
                    'on_entered', s.utility2_on_entered,
                    'on_placed', s.utility2_on_placed,
                    'on_action', s.utility2_on_action
                )),
                'utilities', jsonb_build_array(
                    jsonb_strip_nulls(jsonb_build_object(
                        'slot', 1,
                        'type', s.utility1_type,
                        'utility_asset_id', s.utility1_asset_id,
                        'msg_rect', s.utility_msg_rect,
                        'blessing1', CASE WHEN s.utility1_type = 'church' THEN s.blessing1 END,
                        'blessing2', CASE WHEN s.utility1_type = 'church' THEN s.blessing2 END,
                        'blessing3', CASE WHEN s.utility1_type = 'church' THEN s.blessing3 END,
                        'on_entered', s.utility_on_entered,
                        'on_placed', s.utility_on_placed,
                        'on_action', s.utility_on_action
                    )),
                    jsonb_strip_nulls(jsonb_build_object(
                        'slot', 2,
                        'type', s.utility2_type,
                        'utility_asset_id', s.utility2_asset_id,
                        'msg_rect', s.utility2_msg_rect,
                        'blessing1', CASE WHEN s.utility2_type = 'church' THEN s.blessing1 END,
                        'blessing2', CASE WHEN s.utility2_type = 'church' THEN s.blessing2 END,
                        'blessing3', CASE WHEN s.utility2_type = 'church' THEN s.blessing3 END,
                        'on_entered', s.utility2_on_entered,
                        'on_placed', s.utility2_on_placed,
                        'on_action', s.utility2_on_action
                    ))
                )
            ))),
            '[]'::jsonb
        )
    )
    INTO v_result
    FROM shaped s;

    RETURN v_result;
END;
$function$;
