package main

import (
	"fmt"
	"log"
	"net/http"
)

type routeDefinition struct {
	Path    string
	Handler http.HandlerFunc
}

var registeredAPIRouteCount int

func registerHTTPRoutes() {
	registerPublicRoutes([]routeDefinition{
		{Path: "/", Handler: handleRoot},
		{Path: "/login", Handler: handleLogin},
		{Path: "/dashboard", Handler: handleDashboard},
		{Path: "/static/", Handler: handleStatic},
	})

	registerAPIRoutes([]routeDefinition{
		{Path: "/api/getEffects", Handler: handleGetEffects},
		{Path: "/api/saveEffect", Handler: handleSaveEffect},
		{Path: "/api/getEffectAssets", Handler: CreateGetAssetsHandler("perks")},
		{Path: "/api/uploadEffectAsset", Handler: CreateUploadAssetHandler("perks")},

		{Path: "/api/getItems", Handler: handleGetItems},
		{Path: "/api/createItem", Handler: handleCreateItem},
		{Path: "/api/toggleApproveItem", Handler: handleToggleApproveItem},
		{Path: "/api/mergeItems", Handler: handleMergeItems},
		{Path: "/api/getItemAssets", Handler: handleGetItemAssets},
		{Path: "/api/uploadItemAsset", Handler: handleUploadItemAsset},
		{Path: "/api/removePendingItem", Handler: CreateRemovePendingHandler("tooling.remove_item_pending", "item")},

		{Path: "/api/getPerks", Handler: getPerksHandler},
		{Path: "/api/createPerk", Handler: handleCreatePerk},
		{Path: "/api/toggleApprovePerk", Handler: handleToggleApprovePerk},
		{Path: "/api/mergePerks", Handler: handleMergePerks},
		{Path: "/api/getPerkAssets", Handler: handleGetPerkAssets},
		{Path: "/api/uploadPerkAsset", Handler: handleUploadPerkAsset},
		{Path: "/api/removePendingPerk", Handler: CreateRemovePendingHandler("tooling.remove_perk_pending", "perk")},

		{Path: "/api/getEnemies", Handler: handleGetEnemies},
		{Path: "/api/getTalentsInfo", Handler: handleGetTalentsInfo},
		{Path: "/api/updateTalentInfo", Handler: handleUpdateTalentInfo},
		{Path: "/api/createEnemy", Handler: handleCreateEnemy},
		{Path: "/api/toggleApproveEnemy", Handler: handleToggleApproveEnemy},
		{Path: "/api/mergeEnemies", Handler: handleMergeEnemies},
		{Path: "/api/removePendingEnemy", Handler: handleRemovePendingEnemy},
		{Path: "/api/getEnemyAssets", Handler: CreateGetAssetsHandler("enemies")},
		{Path: "/api/uploadEnemyAsset", Handler: CreateUploadAssetHandler("enemies")},

		{Path: "/api/getExpedition", Handler: handleGetExpedition},
		{Path: "/api/getExpeditionVersioned", Handler: handleGetExpeditionVersioned},
		{Path: "/api/saveExpedition", Handler: handleSaveExpedition},
		{Path: "/api/getQuestsLite", Handler: handleGetQuestsLite},
		{Path: "/api/getExpeditionMapAssets", Handler: CreateGetAssetsHandler("expedition-maps")},
		{Path: "/api/uploadExpeditionMapAsset", Handler: CreateUploadAssetHandler("expedition-maps")},

		{Path: "/api/getSettlements", Handler: handleGetSettlements},
		{Path: "/api/getSettlementAssets", Handler: handleGetSettlementAssets},
		{Path: "/api/uploadSettlementAsset", Handler: handleUploadSettlementAsset},
		{Path: "/api/saveSettlement", Handler: handleSaveSettlement},
		{Path: "/api/deleteSettlement", Handler: handleDeleteSettlement},

		{Path: "/api/getQuests", Handler: handleGetQuests},
		{Path: "/api/createQuest", Handler: handleCreateQuest},
		{Path: "/api/saveQuest", Handler: handleSaveQuest},
		{Path: "/api/deleteQuestOption", Handler: handleDeleteQuestOption},
		{Path: "/api/getQuestAssets", Handler: handleGetQuestAssets},
		{Path: "/api/uploadQuestAsset", Handler: handleUploadQuestAsset},
		{Path: "/api/generateQuestAi", Handler: handleGenerateQuestAi},

		{Path: "/api/getNpcs", Handler: handleGetNpcs},
		{Path: "/api/createNpc", Handler: handleCreateNpc},
		{Path: "/api/updateNpc", Handler: handleUpdateNpc},
		{Path: "/api/deleteNpc", Handler: handleDeleteNpc},

		{Path: "/api/getServers", Handler: handleGetServers},
		{Path: "/api/createServer", Handler: handleCreateServer},
		{Path: "/api/getPlayerManagement", Handler: handleGetPlayerManagement},
		{Path: "/api/getCoupons", Handler: handleGetCoupons},
		{Path: "/api/createCoupon", Handler: handleCreateCoupon},
		{Path: "/api/deleteCoupon", Handler: handleDeleteCoupon},

		{Path: "/api/getBannedWords", Handler: handleGetBannedWords},
		{Path: "/api/addBannedWord", Handler: handleAddBannedWord},
		{Path: "/api/deleteBannedWord", Handler: handleDeleteBannedWord},

		{Path: "/api/getConcept", Handler: handleGetConcept},
		{Path: "/api/saveConcept", Handler: handleSaveConcept},

		{Path: "/api/getRecentEvents", Handler: handleGetRecentEvents},
		{Path: "/api/saveRecentEvent", Handler: handleSaveRecentEvent},
		{Path: "/api/deleteRecentEvent", Handler: handleDeleteRecentEvent},

		{Path: "/api/getCosmetics", Handler: handleGetCosmetics},
		{Path: "/api/getCosmeticsVersioned", Handler: handleGetCosmeticsVersioned},
		{Path: "/api/saveCosmetic", Handler: handleSaveCosmetic},
		{Path: "/api/deleteCosmetic", Handler: handleDeleteCosmetic},
		{Path: "/api/uploadCosmetic", Handler: handleUploadCosmetic},
		{Path: "/api/getCosmeticAssets", Handler: CreateGetAssetsHandler("cosmetics")},

		{Path: "/api/testCombat", Handler: handleTestCombat},

		{Path: "/api/startBulkCombat", Handler: handleStartBulkCombat},
		{Path: "/api/getBulkCombatRuns", Handler: handleGetBulkCombatRuns},
		{Path: "/api/getBulkCombatRun", Handler: handleGetBulkCombatRun},
		{Path: "/api/deleteBulkCombatRun", Handler: handleDeleteBulkCombatRun},

		{Path: "/api/saveBuild", Handler: handleSaveBuild},
		{Path: "/api/getBuilds", Handler: handleGetBuilds},
		{Path: "/api/getBuild", Handler: handleGetBuild},
		{Path: "/api/deleteBuild", Handler: handleDeleteBuild},
		{Path: "/api/startBuildRun", Handler: handleStartBuildRun},
		{Path: "/api/getBuildRuns", Handler: handleGetBuildRuns},
		{Path: "/api/getBuildRun", Handler: handleGetBuildRun},
		{Path: "/api/deleteBuildRun", Handler: handleDeleteBuildRun},
		{Path: "/api/addBuildToRun", Handler: handleAddBuildToRun},
	})
}

func registerPublicRoutes(routes []routeDefinition) {
	for _, route := range routes {
		http.HandleFunc(route.Path, corsHandler(route.Handler))
	}
}

func registerAPIRoutes(routes []routeDefinition) {
	registeredAPIRouteCount += len(routes)
	for _, route := range routes {
		http.HandleFunc(route.Path, apiHandler(route.Handler))
	}
}

func printServerBanner(port string) {
	fmt.Printf("Server starting on :%s\n", port)
	fmt.Println("Available endpoints:")
	fmt.Println("  GET /login - Login page")
	fmt.Println("  GET /dashboard - Dashboard")
	fmt.Println("  GET /static/ - Static files (public)")
	fmt.Println("  GET /api/getEffects - Get all effects (authenticated)")
	fmt.Println("  GET /api/getItems - Get all items (authenticated)")
	fmt.Println("  POST /api/createItem - Create/update item (authenticated)")
	fmt.Println("  POST /api/toggleApproveItem - Toggle item approval (authenticated)")
	fmt.Println("  GET /api/getPerks - Get perks and effects (authenticated)")
	fmt.Println("  GET /api/getEnemies - Get enemies (authenticated)")
	log.Printf("Registered %d API routes", registeredAPIRouteCount)
}
