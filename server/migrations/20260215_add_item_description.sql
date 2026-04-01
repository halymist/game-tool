-- Add description column to game.items and tooling.items

ALTER TABLE game.items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tooling.items ADD COLUMN IF NOT EXISTS description TEXT;

-- Recreate tooling.create_item to accept description parameter
CREATE OR REPLACE FUNCTION tooling.create_item(
    p_game_id       INTEGER,
    p_action        TEXT,
    p_item_name     TEXT,
    p_asset_id      INTEGER,
    p_type          game.item_type,
    p_strength      INTEGER,
    p_stamina       INTEGER,
    p_agility       INTEGER,
    p_luck          INTEGER,
    p_armor         INTEGER,
    p_effect_id     INTEGER,
    p_effect_factor INTEGER,
    p_socket        BOOLEAN,
    p_silver        INTEGER,
    p_min_damage    INTEGER,
    p_max_damage    INTEGER,
    p_description   TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_tooling_id INTEGER;
BEGIN
    INSERT INTO tooling.items (
        game_id, action, item_name, asset_id, type,
        strength, stamina, agility, luck, armor,
        effect_id, effect_factor, socket, silver,
        min_damage, max_damage, description
    ) VALUES (
        p_game_id, p_action, p_item_name, p_asset_id, p_type,
        p_strength, p_stamina, p_agility, p_luck, p_armor,
        p_effect_id, p_effect_factor, p_socket, p_silver,
        p_min_damage, p_max_damage, p_description
    ) RETURNING tooling_id INTO v_tooling_id;

    RETURN v_tooling_id;
END;
$$ LANGUAGE plpgsql;

-- Recreate tooling.merge_items with description column
CREATE OR REPLACE FUNCTION tooling.merge_items()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    rec RECORD;
    v_new_id INT;
    v_new_version INT;
BEGIN
    v_new_version := (SELECT COALESCE(MAX(version), 0) + 1 FROM game.items);

    FOR rec IN
        SELECT * FROM tooling.items
        WHERE approved = true
          AND action IN ('insert', 'update', 'delete')
    LOOP
        IF rec.action = 'insert' AND rec.game_id IS NULL THEN
            INSERT INTO game.items (
                item_name, asset_id, type, silver,
                strength, stamina, agility, luck, armor,
                effect_id, effect_factor, socket, min_damage, max_damage,
                description, version
            ) VALUES (
                rec.item_name, rec.asset_id, rec.type, rec.silver,
                rec.strength, rec.stamina, rec.agility, rec.luck, rec.armor,
                rec.effect_id, rec.effect_factor, rec.socket, rec.min_damage, rec.max_damage,
                rec.description, v_new_version
            )
            RETURNING item_id INTO v_new_id;
            UPDATE tooling.items SET game_id = v_new_id WHERE tooling_id = rec.tooling_id;
            DELETE FROM tooling.items WHERE tooling_id = rec.tooling_id;
        ELSIF rec.action = 'update' AND rec.game_id IS NOT NULL THEN
            INSERT INTO game.items (
                item_id, item_name, asset_id, type, silver,
                strength, stamina, agility, luck, armor,
                effect_id, effect_factor, socket, min_damage, max_damage,
                description, version
            ) VALUES (
                rec.game_id, rec.item_name, rec.asset_id, rec.type, rec.silver,
                rec.strength, rec.stamina, rec.agility, rec.luck, rec.armor,
                rec.effect_id, rec.effect_factor, rec.socket, rec.min_damage, rec.max_damage,
                rec.description, v_new_version
            )
            ON CONFLICT (item_id) DO UPDATE SET
                item_name = EXCLUDED.item_name,
                asset_id = EXCLUDED.asset_id,
                type = EXCLUDED.type,
                silver = EXCLUDED.silver,
                strength = EXCLUDED.strength,
                stamina = EXCLUDED.stamina,
                agility = EXCLUDED.agility,
                luck = EXCLUDED.luck,
                armor = EXCLUDED.armor,
                effect_id = EXCLUDED.effect_id,
                effect_factor = EXCLUDED.effect_factor,
                socket = EXCLUDED.socket,
                min_damage = EXCLUDED.min_damage,
                max_damage = EXCLUDED.max_damage,
                description = EXCLUDED.description,
                version = EXCLUDED.version;
            DELETE FROM tooling.items WHERE tooling_id = rec.tooling_id;
        ELSIF rec.action = 'delete' AND rec.game_id IS NOT NULL THEN
            DELETE FROM game.items WHERE item_id = rec.game_id;
            DELETE FROM tooling.items WHERE tooling_id = rec.tooling_id;
        END IF;
    END LOOP;
END;
$function$;