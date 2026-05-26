package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/lib/pq"
)

type PlayerManagementResponse struct {
	Success    bool              `json:"success"`
	Message    string            `json:"message,omitempty"`
	ServerID   int               `json:"serverId,omitempty"`
	Rankings   []PlayerRanking   `json:"rankings"`
	Characters []PlayerCharacter `json:"characters"`
}

type PlayerRanking struct {
	CharacterID   int    `json:"character_id"`
	PlayerID      int    `json:"player_id"`
	CharacterName string `json:"character_name"`
	Faction       int    `json:"faction"`
	VIP           bool   `json:"vip"`
	Status        string `json:"status"`
	Honor         int    `json:"honor"`
	Rank          int    `json:"rank"`
	Potion        *int   `json:"potion,omitempty"`
	PotionID      *int   `json:"potion_id,omitempty"`
	PotionFactor  *int   `json:"potion_factor,omitempty"`
	ElixirEffect1 *int   `json:"elixir_effect1,omitempty"`
	ElixirFactor1 *int   `json:"elixir_factor1,omitempty"`
	ElixirEffect2 *int   `json:"elixir_effect2,omitempty"`
	ElixirFactor2 *int   `json:"elixir_factor2,omitempty"`
}

type PlayerCharacter struct {
	CharacterID    int                   `json:"character_id"`
	PlayerID       int                   `json:"player_id"`
	CharacterName  string                `json:"character_name"`
	Faction        int                   `json:"faction"`
	VIP            bool                  `json:"vip"`
	Status         string                `json:"status"`
	Silver         int                   `json:"silver"`
	TalentPoints   int                   `json:"talent_points"`
	Stats          PlayerStats           `json:"stats"`
	Avatar         PlayerAvatar          `json:"avatar"`
	Inventory      []PlayerInventoryItem `json:"inventory"`
	Talents        []PlayerTalent        `json:"talents"`
	Perks          []PlayerPerk          `json:"perks"`
	Honor          int                   `json:"honor"`
	BlessingID     *int                  `json:"blessing_id,omitempty"`
	BlessingFactor *int                  `json:"blessing_factor,omitempty"`
	PotionID       *int                  `json:"potion_id,omitempty"`
	Potion         *int                  `json:"potion,omitempty"`
	PotionFactor   *int                  `json:"potion_factor,omitempty"`
	PotionUntil    *time.Time            `json:"potion_until,omitempty"`
	ElixirEffect1  *int                  `json:"elixir_effect1,omitempty"`
	ElixirFactor1  *int                  `json:"elixir_factor1,omitempty"`
	ElixirEffect2  *int                  `json:"elixir_effect2,omitempty"`
	ElixirFactor2  *int                  `json:"elixir_factor2,omitempty"`
	ElixirUntil    *time.Time            `json:"elixir_until,omitempty"`
	Destination    *int                  `json:"destination,omitempty"`
	Arrival        *time.Time            `json:"arrival,omitempty"`
}

type PlayerStats struct {
	Strength       int `json:"strength"`
	Stamina        int `json:"stamina"`
	Agility        int `json:"agility"`
	Luck           int `json:"luck"`
	Armor          int `json:"armor"`
	MinDamage      int `json:"min_damage"`
	MaxDamage      int `json:"max_damage"`
	DepletedHealth int `json:"depleted_health"`
}

type PlayerAvatar struct {
	Face    int `json:"face"`
	Hair    int `json:"hair"`
	Eyes    int `json:"eyes"`
	Nose    int `json:"nose"`
	Mouth   int `json:"mouth"`
	Brows   int `json:"brows"`
	Ears    int `json:"ears"`
	Special int `json:"special"`
}

type PlayerInventoryItem struct {
	CharacterID     int     `json:"character_id"`
	SlotID          int     `json:"slot_id"`
	ItemID          *int    `json:"item_id,omitempty"`
	ServerDay       *int    `json:"server_day,omitempty"`
	Temper          *int    `json:"temper,omitempty"`
	EffectOverdrive *int    `json:"effect_overdrive,omitempty"`
	Factor          *int    `json:"factor,omitempty"`
	Socket          *int    `json:"socket,omitempty"`
	SocketDay       *int    `json:"socket_day,omitempty"`
	ElixirEffect    *int    `json:"elixir_effect,omitempty"`
	ItemName        *string `json:"item_name,omitempty"`
	ItemType        *string `json:"item_type,omitempty"`
	AssetID         *int    `json:"assetID,omitempty"`
	Icon            string  `json:"icon,omitempty"`
	Strength        *int    `json:"strength,omitempty"`
	Stamina         *int    `json:"stamina,omitempty"`
	Agility         *int    `json:"agility,omitempty"`
	Luck            *int    `json:"luck,omitempty"`
	Armor           *int    `json:"armor,omitempty"`
	MinDamage       *int    `json:"minDamage,omitempty"`
	MaxDamage       *int    `json:"maxDamage,omitempty"`
	EffectID        *int    `json:"effectID,omitempty"`
	EffectFactor    *int    `json:"effectFactor,omitempty"`
	Description     *string `json:"description,omitempty"`
}

type PlayerTalent struct {
	CharacterID int     `json:"character_id"`
	TalentID    int     `json:"talent_id"`
	Points      int     `json:"points"`
	Name        string  `json:"name"`
	AssetID     *int    `json:"assetID,omitempty"`
	EffectID    *int    `json:"effectId,omitempty"`
	Factor      *int    `json:"factor,omitempty"`
	Description *string `json:"description,omitempty"`
	Icon        string  `json:"icon,omitempty"`
	Row         int     `json:"row"`
	Col         int     `json:"col"`
	MaxPoints   int     `json:"maxPoints"`
	PerkSlot    bool    `json:"perkSlot"`
}

type PlayerPerk struct {
	CharacterID int    `json:"character_id"`
	PerkID      int    `json:"perk_id"`
	TalentID    *int   `json:"talent_id,omitempty"`
	Name        string `json:"name"`
	AssetID     *int   `json:"assetID,omitempty"`
	Icon        string `json:"icon,omitempty"`
}

func handleGetPlayerManagement(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serverID, err := strconv.Atoi(r.URL.Query().Get("serverId"))
	if err != nil || serverID <= 0 {
		json.NewEncoder(w).Encode(PlayerManagementResponse{Success: false, Message: "serverId is required"})
		return
	}

	rankings, err := loadPlayerRankings(serverID)
	if err != nil {
		log.Printf("Error loading player rankings for server %d: %v", serverID, err)
		json.NewEncoder(w).Encode(PlayerManagementResponse{Success: false, Message: err.Error()})
		return
	}

	characters, err := loadPlayerCharacters(serverID)
	if err != nil {
		log.Printf("Error loading player characters for server %d: %v", serverID, err)
		json.NewEncoder(w).Encode(PlayerManagementResponse{Success: false, Message: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(PlayerManagementResponse{
		Success:    true,
		ServerID:   serverID,
		Rankings:   rankings,
		Characters: characters,
	})
}

func loadPlayerRankings(serverID int) ([]PlayerRanking, error) {
	rows, err := db.Query(`
		SELECT character_id, player_id, character_name, faction, vip, status::text,
		       COALESCE(honnor, 0) AS honor,
		       RANK() OVER (ORDER BY COALESCE(honnor, 0) DESC, character_id ASC) AS rank,
		       potion, potion_id, potion_factor,
		       elixir_effect1, elixir_factor1, elixir_effect2, elixir_factor2
		FROM public.characters
		WHERE server_id = $1
		ORDER BY rank, character_id
	`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rankings []PlayerRanking
	for rows.Next() {
		var r PlayerRanking
		var potion, potionID, potionFactor sql.NullInt64
		var elixirEffect1, elixirFactor1, elixirEffect2, elixirFactor2 sql.NullInt64
		if err := rows.Scan(
			&r.CharacterID, &r.PlayerID, &r.CharacterName, &r.Faction, &r.VIP, &r.Status,
			&r.Honor, &r.Rank,
			&potion, &potionID, &potionFactor,
			&elixirEffect1, &elixirFactor1, &elixirEffect2, &elixirFactor2,
		); err != nil {
			return nil, err
		}
		r.Potion = nullInt64Ptr(potion)
		r.PotionID = nullInt64Ptr(potionID)
		r.PotionFactor = nullInt64Ptr(potionFactor)
		r.ElixirEffect1 = nullInt64Ptr(elixirEffect1)
		r.ElixirFactor1 = nullInt64Ptr(elixirFactor1)
		r.ElixirEffect2 = nullInt64Ptr(elixirEffect2)
		r.ElixirFactor2 = nullInt64Ptr(elixirFactor2)
		rankings = append(rankings, r)
	}
	return rankings, rows.Err()
}

func loadPlayerCharacters(serverID int) ([]PlayerCharacter, error) {
	rows, err := db.Query(`
		SELECT character_id, player_id, character_name, faction, vip, status::text,
		       COALESCE(silver, 0), COALESCE(talent_points, 0),
		       COALESCE(strength, 0), COALESCE(stamina, 0), COALESCE(agility, 0), COALESCE(luck, 0),
		       COALESCE(armor, 0), COALESCE(min_damage, 0), COALESCE(max_damage, 0), COALESCE(depleted_health, 0),
		       COALESCE(avatar_face, 0), COALESCE(avatar_hair, 0), COALESCE(avatar_eyes, 0), COALESCE(avatar_nose, 0),
		       COALESCE(avatar_mouth, 0), COALESCE(avatar_brows, 0), COALESCE(avatar_ears, 0), COALESCE(avatar_special, 0),
		       COALESCE(honnor, 0),
		       blessing_id, blessing_factor,
		       potion_id, potion, potion_factor, potion_until,
		       elixir_effect1, elixir_factor1, elixir_effect2, elixir_factor2, elixir_until,
		       destination, arrival
		FROM public.characters
		WHERE server_id = $1
		ORDER BY COALESCE(honnor, 0) DESC, character_id
	`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var characters []PlayerCharacter
	characterIDs := []int{}
	for rows.Next() {
		var c PlayerCharacter
		var blessingID, blessingFactor, potionID, potion, potionFactor sql.NullInt64
		var potionUntil sql.NullTime
		var elixirEffect1, elixirFactor1, elixirEffect2, elixirFactor2 sql.NullInt64
		var elixirUntil sql.NullTime
		var destination sql.NullInt64
		var arrival sql.NullTime
		if err := rows.Scan(
			&c.CharacterID, &c.PlayerID, &c.CharacterName, &c.Faction, &c.VIP, &c.Status,
			&c.Silver, &c.TalentPoints,
			&c.Stats.Strength, &c.Stats.Stamina, &c.Stats.Agility, &c.Stats.Luck,
			&c.Stats.Armor, &c.Stats.MinDamage, &c.Stats.MaxDamage, &c.Stats.DepletedHealth,
			&c.Avatar.Face, &c.Avatar.Hair, &c.Avatar.Eyes, &c.Avatar.Nose,
			&c.Avatar.Mouth, &c.Avatar.Brows, &c.Avatar.Ears, &c.Avatar.Special,
			&c.Honor,
			&blessingID, &blessingFactor,
			&potionID, &potion, &potionFactor, &potionUntil,
			&elixirEffect1, &elixirFactor1, &elixirEffect2, &elixirFactor2, &elixirUntil,
			&destination, &arrival,
		); err != nil {
			return nil, err
		}
		c.BlessingID = nullInt64Ptr(blessingID)
		c.BlessingFactor = nullInt64Ptr(blessingFactor)
		c.PotionID = nullInt64Ptr(potionID)
		c.Potion = nullInt64Ptr(potion)
		c.PotionFactor = nullInt64Ptr(potionFactor)
		c.PotionUntil = nullTimePtrFromSQL(potionUntil)
		c.ElixirEffect1 = nullInt64Ptr(elixirEffect1)
		c.ElixirFactor1 = nullInt64Ptr(elixirFactor1)
		c.ElixirEffect2 = nullInt64Ptr(elixirEffect2)
		c.ElixirFactor2 = nullInt64Ptr(elixirFactor2)
		c.ElixirUntil = nullTimePtrFromSQL(elixirUntil)
		c.Destination = nullInt64Ptr(destination)
		c.Arrival = nullTimePtrFromSQL(arrival)
		c.Inventory = []PlayerInventoryItem{}
		c.Talents = []PlayerTalent{}
		c.Perks = []PlayerPerk{}
		characterIDs = append(characterIDs, c.CharacterID)
		characters = append(characters, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(characterIDs) == 0 {
		return characters, nil
	}

	inventoryByCharacter, err := loadPlayerInventory(characterIDs)
	if err != nil {
		return nil, err
	}
	talentsByCharacter, err := loadPlayerTalents(characterIDs)
	if err != nil {
		return nil, err
	}
	perksByCharacter, err := loadPlayerPerks(characterIDs)
	if err != nil {
		return nil, err
	}

	for i := range characters {
		id := characters[i].CharacterID
		characters[i].Inventory = inventoryByCharacter[id]
		characters[i].Talents = talentsByCharacter[id]
		characters[i].Perks = perksByCharacter[id]
	}
	return characters, nil
}

func loadPlayerInventory(characterIDs []int) (map[int][]PlayerInventoryItem, error) {
	rows, err := db.Query(`
		SELECT inv.character_id, inv.slot_id, inv.item_id, inv.server_day, inv.temper,
		       inv.effect_overdrive, inv.factor, inv.socket, inv.socket_day, inv.elixir_effect,
		       i.item_name, i.type::text, i.asset_id,
		       i.strength, i.stamina, i.agility, i.luck, i.armor, i.min_damage, i.max_damage,
		       i.effect_id, i.effect_factor, i.description
		FROM public.inventory inv
		LEFT JOIN game.items i ON i.item_id = inv.item_id
		WHERE inv.character_id = ANY($1)
		ORDER BY inv.character_id, inv.slot_id
	`, pq.Array(characterIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make(map[int][]PlayerInventoryItem)
	for rows.Next() {
		var item PlayerInventoryItem
		var itemID, serverDay, temper, effectOverdrive, factor, socket, socketDay, elixirEffect sql.NullInt64
		var itemName, itemType, description sql.NullString
		var assetID, strength, stamina, agility, luck, armor, minDamage, maxDamage, effectID, effectFactor sql.NullInt64
		if err := rows.Scan(
			&item.CharacterID, &item.SlotID, &itemID, &serverDay, &temper,
			&effectOverdrive, &factor, &socket, &socketDay, &elixirEffect,
			&itemName, &itemType, &assetID,
			&strength, &stamina, &agility, &luck, &armor, &minDamage, &maxDamage,
			&effectID, &effectFactor, &description,
		); err != nil {
			return nil, err
		}
		item.ItemID = nullInt64Ptr(itemID)
		item.ServerDay = nullInt64Ptr(serverDay)
		item.Temper = nullInt64Ptr(temper)
		item.EffectOverdrive = nullInt64Ptr(effectOverdrive)
		item.Factor = nullInt64Ptr(factor)
		item.Socket = nullInt64Ptr(socket)
		item.SocketDay = nullInt64Ptr(socketDay)
		item.ElixirEffect = nullInt64Ptr(elixirEffect)
		item.ItemName = nullStringPtr(itemName)
		item.ItemType = nullStringPtr(itemType)
		item.AssetID = nullInt64Ptr(assetID)
		item.Strength = nullInt64Ptr(strength)
		item.Stamina = nullInt64Ptr(stamina)
		item.Agility = nullInt64Ptr(agility)
		item.Luck = nullInt64Ptr(luck)
		item.Armor = nullInt64Ptr(armor)
		item.MinDamage = nullInt64Ptr(minDamage)
		item.MaxDamage = nullInt64Ptr(maxDamage)
		item.EffectID = nullInt64Ptr(effectID)
		item.EffectFactor = nullInt64Ptr(effectFactor)
		item.Description = nullStringPtr(description)
		if item.AssetID != nil && *item.AssetID > 0 {
			item.Icon = GeneratePublicURL("items", *item.AssetID)
		}
		items[item.CharacterID] = append(items[item.CharacterID], item)
	}
	return items, rows.Err()
}

func loadPlayerTalents(characterIDs []int) (map[int][]PlayerTalent, error) {
	rows, err := db.Query(`
		SELECT t.character_id, t.talent_id, t.points, COALESCE(ti.talent_name, ''), ti.asset_id,
		       ti.effect_id, ti.factor, ti.description,
		       COALESCE(ti.row, 1), COALESCE(ti.col, 1), COALESCE(ti.max_points, 0), COALESCE(ti.perk_slot, false)
		FROM public.talents t
		LEFT JOIN game.talents_info ti ON ti.talent_id = t.talent_id
		WHERE t.character_id = ANY($1)
		ORDER BY t.character_id, t.talent_id
	`, pq.Array(characterIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	talents := make(map[int][]PlayerTalent)
	for rows.Next() {
		var t PlayerTalent
		var assetID, effectID, factor sql.NullInt64
		var description sql.NullString
		if err := rows.Scan(
			&t.CharacterID, &t.TalentID, &t.Points, &t.Name, &assetID,
			&effectID, &factor, &description,
			&t.Row, &t.Col, &t.MaxPoints, &t.PerkSlot,
		); err != nil {
			return nil, err
		}
		t.AssetID = nullInt64Ptr(assetID)
		t.EffectID = nullInt64Ptr(effectID)
		t.Factor = nullInt64Ptr(factor)
		t.Description = nullStringPtr(description)
		if t.AssetID != nil && *t.AssetID > 0 {
			t.Icon = GeneratePublicURL("perks", *t.AssetID)
		}
		talents[t.CharacterID] = append(talents[t.CharacterID], t)
	}
	return talents, rows.Err()
}

func loadPlayerPerks(characterIDs []int) (map[int][]PlayerPerk, error) {
	rows, err := db.Query(`
		SELECT p.character_id, p.perk_id, p.talent_id, COALESCE(pi.perk_name, ''), pi.asset_id
		FROM public.perks p
		LEFT JOIN game.perks_info pi ON pi.perk_id = p.perk_id
		WHERE p.character_id = ANY($1)
		ORDER BY p.character_id, p.perk_id
	`, pq.Array(characterIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	perks := make(map[int][]PlayerPerk)
	for rows.Next() {
		var p PlayerPerk
		var talentID, assetID sql.NullInt64
		if err := rows.Scan(&p.CharacterID, &p.PerkID, &talentID, &p.Name, &assetID); err != nil {
			return nil, err
		}
		p.TalentID = nullInt64Ptr(talentID)
		p.AssetID = nullInt64Ptr(assetID)
		if p.AssetID != nil && *p.AssetID > 0 {
			p.Icon = GeneratePublicURL("perks", *p.AssetID)
		}
		perks[p.CharacterID] = append(perks[p.CharacterID], p)
	}
	return perks, rows.Err()
}

func nullInt64Ptr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func nullStringPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func nullTimePtrFromSQL(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	return &v.Time
}
