CREATE OR REPLACE FUNCTION public.download_expedition(p_version integer)
RETURNS jsonb
LANGUAGE sql
AS $function$
WITH changed_slides AS (
    SELECT *
    FROM game.expedition_slides
    WHERE version > p_version
),
active_slides AS (
    SELECT *
    FROM changed_slides
    WHERE is_deleted = FALSE
),
deleted_slides AS (
    SELECT slide_id
    FROM changed_slides
    WHERE is_deleted = TRUE
)
SELECT jsonb_build_object(
    'version', COALESCE((SELECT MAX(version) FROM changed_slides), 0),
    'slides', COALESCE((
        SELECT jsonb_agg(
            jsonb_strip_nulls(
                jsonb_build_object(
                    'slide_id', s.slide_id,
                    'slide_text', s.slide_text,
                    'asset_id', s.asset_id,
                    'is_start', s.is_start,
                    'settlement_id', s.settlement_id,
                    'effect_id', s.effect_id,
                    'effect_factor', s.effect_factor,
                    'reward', jsonb_strip_nulls(
                        jsonb_build_object(
                            'reward_stat_type', s.reward_stat_type,
                            'reward_stat_amount', s.reward_stat_amount,
                            'silver', s.reward_silver,
                            'talent', s.reward_talent,
                            'item', s.reward_item,
                            'perk', s.reward_perk,
                            'blessing', s.reward_blessing,
                            'potion', s.reward_potion
                        )
                    ),
                    'options', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_strip_nulls(
                                jsonb_build_object(
                                    'option_id', o.option_id,
                                    'option_text', o.option_text,
                                    'stat_type_required', o.stat_type,
                                    'stat_required', o.stat_required,
                                    'silver_required', o.silver_required,
                                    'faction_required', o.faction_required,
                                    'effect_id_required', o.effect_id,
                                    'effect_amount_required', o.effect_amount,
                                    'enemy_id', o.enemy_id
                                )
                            ) ORDER BY o.option_id
                        )
                        FROM game.expedition_options o
                        WHERE o.slide_id = s.slide_id
                    ), '[]'::jsonb)
                )
            ) ORDER BY s.slide_id
        )
        FROM active_slides s
    ), '[]'::jsonb),
    'deleted_slide_ids', COALESCE((
        SELECT jsonb_agg(sd.slide_id ORDER BY sd.slide_id)
        FROM deleted_slides sd
    ), '[]'::jsonb)
);
$function$;
