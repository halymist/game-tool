package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/joho/godotenv"
	"github.com/lestrrat-go/jwx/v2/jwk"
	_ "github.com/lib/pq" // PostgreSQL driver
)

// Configuration - loaded from environment variables
var (
	COGNITO_REGION        string
	COGNITO_USER_POOL     string
	COGNITO_CLIENT_ID     string
	S3_BUCKET_NAME        string
	S3_REGION             string
	S3_ENDPOINT           string
	S3_FORCE_PATH_STYLE   bool
	ASSET_PUBLIC_BASE_URL string
	AWS_ACCESS_KEY_ID     string
	AWS_SECRET_ACCESS_KEY string
	OPENAI_API_KEY        string
	DB_HOST               string
	DB_PORT               string
	DB_NAME               string
	DB_USER               string
	DB_PASSWORD           string
	DB_SSLMODE            string
)

var jwksSet jwk.Set
var s3Client *s3.Client
var db *sql.DB

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func init() {
	// Load environment variables from .env file in parent directory (secrets only)
	if err := godotenv.Load(".env"); err != nil {
		log.Printf("Warning: .env file not found, using environment variables")
	}

	// Non-secret configuration defaults
	COGNITO_REGION = envOrDefault("COGNITO_REGION", "eu-north-1")
	COGNITO_USER_POOL = envOrDefault("COGNITO_USER_POOL", "eu-north-1_il4Ww30RF")
	COGNITO_CLIENT_ID = envOrDefault("COGNITO_CLIENT_ID", "g7sjca510dnqgs2tldhgvbihj")
	S3_BUCKET_NAME = envOrDefault("S3_BUCKET_NAME", "wilds")
	S3_REGION = envOrDefault("S3_REGION", "auto")
	S3_ENDPOINT = envOrDefault("S3_ENDPOINT", "https://dd347d877a52595a55ba14508c8f0003.eu.r2.cloudflarestorage.com")
	ASSET_PUBLIC_BASE_URL = envOrDefault("ASSET_PUBLIC_BASE_URL", "https://pub-b959ac8ae579488bb4ed33c01a618ae2.r2.dev")
	S3_FORCE_PATH_STYLE = strings.EqualFold(envOrDefault("S3_FORCE_PATH_STYLE", "true"), "true")
	DB_HOST = envOrDefault("DB_HOST", "localhost")
	DB_PORT = envOrDefault("DB_PORT", "5432")
	DB_NAME = envOrDefault("DB_NAME", "Game")
	DB_USER = envOrDefault("DB_USER", "postgres")
	DB_SSLMODE = envOrDefault("DB_SSLMODE", "disable")

	// Secrets — must come from .env or environment
	AWS_ACCESS_KEY_ID = os.Getenv("AWS_ACCESS_KEY_ID")
	AWS_SECRET_ACCESS_KEY = os.Getenv("AWS_SECRET_ACCESS_KEY")
	OPENAI_API_KEY = os.Getenv("OPENAI_API_KEY")
	DB_PASSWORD = os.Getenv("DB_PASSWORD")

	// Validate required secrets
	if AWS_ACCESS_KEY_ID == "" || AWS_SECRET_ACCESS_KEY == "" {
		log.Fatal("Missing required S3 secret environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)")
	}
	if DB_PASSWORD == "" {
		log.Fatal("Missing required DB_PASSWORD environment variable")
	}

	// Fetch JWKS on startup
	jwksURL := fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s/.well-known/jwks.json",
		COGNITO_REGION, COGNITO_USER_POOL)

	var err error
	jwksSet, err = jwk.Fetch(context.Background(), jwksURL)
	if err != nil {
		log.Printf("Failed to fetch JWKS: %v", err)
	}

	// Initialize AWS S3 client
	log.Printf("Attempting to initialize AWS S3 client...")

	// Create credentials from environment variables
	creds := aws.CredentialsProviderFunc(func(ctx context.Context) (aws.Credentials, error) {
		return aws.Credentials{
			AccessKeyID:     AWS_ACCESS_KEY_ID,
			SecretAccessKey: AWS_SECRET_ACCESS_KEY,
		}, nil
	})

	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(S3_REGION),
		config.WithCredentialsProvider(creds),
	)
	if err != nil {
		log.Printf("CRITICAL: Failed to load AWS config: %v", err)
		log.Printf("Check your AWS environment variables")
		s3Client = nil
	} else {
		s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
			if S3_ENDPOINT != "" {
				o.BaseEndpoint = aws.String(S3_ENDPOINT)
			}
			o.UsePathStyle = S3_FORCE_PATH_STYLE
		})
		log.Printf("SUCCESS: S3 client initialized for region: %s", S3_REGION)
		if S3_ENDPOINT != "" {
			log.Printf("S3-compatible endpoint configured: %s (path-style=%v)", S3_ENDPOINT, S3_FORCE_PATH_STYLE)
		}
		log.Printf("Asset public base URL: %s", ASSET_PUBLIC_BASE_URL)

		// Test the credentials by attempting to list buckets (this will fail gracefully if no permission)
		log.Printf("Testing AWS credentials...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, testErr := s3Client.ListBuckets(ctx, &s3.ListBucketsInput{})
		if testErr != nil {
			log.Printf("WARNING: AWS credentials test failed: %v", testErr)
			log.Printf("This might be normal if your IAM user doesn't have ListBuckets permission")
		} else {
			log.Printf("SUCCESS: AWS credentials are working!")
		}
	}

	// Initialize PostgreSQL database connection
	log.Printf("Attempting to connect to PostgreSQL database...")
	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSLMODE)

	var errDatabase error
	db, errDatabase = sql.Open("postgres", psqlInfo)
	if errDatabase != nil {
		log.Printf("CRITICAL: Failed to open database connection: %v", errDatabase)
		db = nil
	} else {
		// Test the connection
		errDatabase = db.Ping()
		if errDatabase != nil {
			log.Printf("CRITICAL: Failed to ping database: %v", errDatabase)
			db = nil
		} else {
			log.Printf("SUCCESS: Connected to PostgreSQL database!")

			// Set search_path to game schema
			_, schemaErr := db.Exec(`SET search_path TO game, public`)
			if schemaErr != nil {
				log.Printf("WARNING: Failed to set search_path to game schema: %v", schemaErr)
			} else {
				log.Printf("SUCCESS: Set search_path to game schema")
			}
		}
	}
}

func main() {
	http.HandleFunc("/", corsHandler(handleRoot))
	http.HandleFunc("/login", corsHandler(handleLogin))
	http.HandleFunc("/dashboard", corsHandler(handleDashboard))
	http.HandleFunc("/static/", corsHandler(handleStatic))

	// Read-only endpoints (game schema)
	http.HandleFunc("/api/getEffects", apiHandler(handleGetEffects))
	http.HandleFunc("/api/getItems", apiHandler(handleGetItems))
	http.HandleFunc("/api/getPerks", apiHandler(getPerksHandler))
	http.HandleFunc("/api/generateQuestAi", apiHandler(handleGenerateQuestAi))

	// Item endpoints (uses tooling schema)
	http.HandleFunc("/api/createItem", apiHandler(handleCreateItem))
	http.HandleFunc("/api/toggleApproveItem", apiHandler(handleToggleApproveItem))
	http.HandleFunc("/api/mergeItems", apiHandler(handleMergeItems))
	http.HandleFunc("/api/getItemAssets", apiHandler(handleGetItemAssets))
	http.HandleFunc("/api/uploadItemAsset", apiHandler(handleUploadItemAsset))
	http.HandleFunc("/api/removePendingItem", apiHandler(CreateRemovePendingHandler("tooling.remove_item_pending", "item")))

	// Perk endpoints (uses tooling schema)
	http.HandleFunc("/api/createPerk", apiHandler(handleCreatePerk))
	http.HandleFunc("/api/toggleApprovePerk", apiHandler(handleToggleApprovePerk))
	http.HandleFunc("/api/mergePerks", apiHandler(handleMergePerks))
	http.HandleFunc("/api/getPerkAssets", apiHandler(handleGetPerkAssets))
	http.HandleFunc("/api/uploadPerkAsset", apiHandler(handleUploadPerkAsset))
	http.HandleFunc("/api/removePendingPerk", apiHandler(CreateRemovePendingHandler("tooling.remove_perk_pending", "perk")))

	// Enemy endpoints (uses tooling schema)
	http.HandleFunc("/api/getEnemies", apiHandler(handleGetEnemies))
	http.HandleFunc("/api/getTalentsInfo", apiHandler(handleGetTalentsInfo))
	http.HandleFunc("/api/updateTalentInfo", apiHandler(handleUpdateTalentInfo))
	http.HandleFunc("/api/getTalentAssets", apiHandler(CreateGetAssetsHandler("perks")))
	http.HandleFunc("/api/uploadTalentAsset", apiHandler(CreateUploadAssetHandler("perks")))
	http.HandleFunc("/api/createEnemy", apiHandler(handleCreateEnemy))
	http.HandleFunc("/api/toggleApproveEnemy", apiHandler(handleToggleApproveEnemy))
	http.HandleFunc("/api/mergeEnemies", apiHandler(handleMergeEnemies))
	http.HandleFunc("/api/removePendingEnemy", apiHandler(handleRemovePendingEnemy))
	http.HandleFunc("/api/getEnemyAssets", apiHandler(CreateGetAssetsHandler("enemies")))
	http.HandleFunc("/api/uploadEnemyAsset", apiHandler(CreateUploadAssetHandler("enemies")))

	// Expedition endpoints (map + quest-node graph)
	http.HandleFunc("/api/getExpedition", apiHandler(handleGetExpedition))
	http.HandleFunc("/api/getExpeditionVersioned", apiHandler(handleGetExpeditionVersioned))
	http.HandleFunc("/api/saveExpedition", apiHandler(handleSaveExpedition))
	http.HandleFunc("/api/getQuestsLite", apiHandler(handleGetQuestsLite))
	http.HandleFunc("/api/getExpeditionMapAssets", apiHandler(CreateGetAssetsHandler("expedition-maps")))
	http.HandleFunc("/api/uploadExpeditionMapAsset", apiHandler(CreateUploadAssetHandler("expedition-maps")))

	// Settlement endpoints
	http.HandleFunc("/api/getSettlements", apiHandler(handleGetSettlements))
	http.HandleFunc("/api/getSettlementAssets", apiHandler(handleGetSettlementAssets))
	http.HandleFunc("/api/uploadSettlementAsset", apiHandler(handleUploadSettlementAsset))
	http.HandleFunc("/api/saveSettlement", apiHandler(handleSaveSettlement))
	http.HandleFunc("/api/deleteSettlement", apiHandler(handleDeleteSettlement))

	// Quest endpoints
	http.HandleFunc("/api/getQuests", apiHandler(handleGetQuests))
	http.HandleFunc("/api/createQuest", apiHandler(handleCreateQuest))
	http.HandleFunc("/api/saveQuest", apiHandler(handleSaveQuest))
	http.HandleFunc("/api/deleteQuestOption", apiHandler(handleDeleteQuestOption))
	http.HandleFunc("/api/getQuestAssets", apiHandler(handleGetQuestAssets))
	http.HandleFunc("/api/uploadQuestAsset", apiHandler(handleUploadQuestAsset))

	// NPC endpoints
	http.HandleFunc("/api/getNpcs", apiHandler(handleGetNpcs))
	http.HandleFunc("/api/createNpc", apiHandler(handleCreateNpc))
	http.HandleFunc("/api/updateNpc", apiHandler(handleUpdateNpc))
	http.HandleFunc("/api/deleteNpc", apiHandler(handleDeleteNpc))

	// Server management endpoints
	http.HandleFunc("/api/getServers", apiHandler(handleGetServers))
	http.HandleFunc("/api/createServer", apiHandler(handleCreateServer))
	http.HandleFunc("/api/getCoupons", apiHandler(handleGetCoupons))
	http.HandleFunc("/api/createCoupon", apiHandler(handleCreateCoupon))
	http.HandleFunc("/api/deleteCoupon", apiHandler(handleDeleteCoupon))

	// Chat moderation endpoints
	http.HandleFunc("/api/getBannedWords", apiHandler(handleGetBannedWords))
	http.HandleFunc("/api/addBannedWord", apiHandler(handleAddBannedWord))
	http.HandleFunc("/api/deleteBannedWord", apiHandler(handleDeleteBannedWord))

	// Concept endpoints
	http.HandleFunc("/api/getConcept", apiHandler(handleGetConcept))
	http.HandleFunc("/api/saveConcept", apiHandler(handleSaveConcept))

	// Recent events endpoints (global)
	http.HandleFunc("/api/getRecentEvents", apiHandler(handleGetRecentEvents))
	http.HandleFunc("/api/saveRecentEvent", apiHandler(handleSaveRecentEvent))
	http.HandleFunc("/api/deleteRecentEvent", apiHandler(handleDeleteRecentEvent))

	// Cosmetics endpoints
	http.HandleFunc("/api/getCosmetics", apiHandler(handleGetCosmetics))
	http.HandleFunc("/api/getCosmeticsVersioned", apiHandler(handleGetCosmeticsVersioned))
	http.HandleFunc("/api/saveCosmetic", apiHandler(handleSaveCosmetic))
	http.HandleFunc("/api/deleteCosmetic", apiHandler(handleDeleteCosmetic))
	http.HandleFunc("/api/uploadCosmetic", apiHandler(handleUploadCosmetic))
	http.HandleFunc("/api/getCosmeticAssets", apiHandler(CreateGetAssetsHandler("cosmetics")))

	// Combat tester endpoint
	http.HandleFunc("/api/testCombat", apiHandler(handleTestCombat))

	// Bulk combat (effect ranking) endpoints
	http.HandleFunc("/api/startBulkCombat", apiHandler(handleStartBulkCombat))
	http.HandleFunc("/api/getBulkCombatRuns", apiHandler(handleGetBulkCombatRuns))
	http.HandleFunc("/api/getBulkCombatRun", apiHandler(handleGetBulkCombatRun))
	http.HandleFunc("/api/deleteBulkCombatRun", apiHandler(handleDeleteBulkCombatRun))

	// Builds tester endpoints (Test2 tab)
	http.HandleFunc("/api/saveBuild", apiHandler(handleSaveBuild))
	http.HandleFunc("/api/getBuilds", apiHandler(handleGetBuilds))
	http.HandleFunc("/api/getBuild", apiHandler(handleGetBuild))
	http.HandleFunc("/api/deleteBuild", apiHandler(handleDeleteBuild))
	http.HandleFunc("/api/startBuildRun", apiHandler(handleStartBuildRun))
	http.HandleFunc("/api/getBuildRuns", apiHandler(handleGetBuildRuns))
	http.HandleFunc("/api/getBuildRun", apiHandler(handleGetBuildRun))
	http.HandleFunc("/api/deleteBuildRun", apiHandler(handleDeleteBuildRun))
	http.HandleFunc("/api/addBuildToRun", apiHandler(handleAddBuildToRun))

	port := "8080"
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
	fmt.Println("  GET /api/getEnemies - Get enemies (temporarily read-only)")
	fmt.Println("  NOTE: createEnemy endpoint disabled during refactor")

	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func corsHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// LOG EVERY SINGLE REQUEST
		log.Printf("REQUEST: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	log.Printf("ROOT REQUEST - redirecting to login")
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	log.Printf("SERVING LOGIN PAGE")

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	serveFile(w, "login.html")
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if !isAuthenticated(r) {
		log.Printf("DASHBOARD ACCESS DENIED - redirecting to login")
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	log.Printf("SERVING DASHBOARD")
	serveFile(w, "index.html")
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	urlPath := strings.TrimPrefix(r.URL.Path, "/static/")
	filePath := filepath.Join("tool", urlPath)

	log.Printf("SERVING STATIC: %s", urlPath)
	serveFile(w, filePath)
}

func verifyToken(tokenString string) (string, bool) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Get the key ID from the token header
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("kid header not found")
		}

		// Find the key in the JWK set
		key, found := jwksSet.LookupKeyID(kid)
		if !found {
			return nil, fmt.Errorf("key not found")
		}

		// Convert to RSA public key
		var publicKey interface{}
		err := key.Raw(&publicKey)
		if err != nil {
			return nil, err
		}

		return publicKey, nil
	})

	if err != nil {
		log.Printf("Token parsing failed: %v", err)
		return "", false
	}

	// Check if token is valid
	if !token.Valid {
		log.Printf("Token is invalid")
		return "", false
	}

	// Additional claims validation
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		log.Printf("Claims parsing failed")
		return "", false
	}

	// Check token use
	tokenUse, ok := claims["token_use"].(string)
	if !ok || tokenUse != "access" {
		log.Printf("Invalid token use: %v", tokenUse)
		return "", false
	}

	// Get username
	username, _ := claims["username"].(string)
	isAdmin := false

	log.Printf("Token verified successfully for user: %v", username)
	return username, isAdmin
}

func isAuthenticated(r *http.Request) bool {
	if authAlreadyVerified(r) {
		return true
	}

	// Check for token in Authorization header
	authHeader := r.Header.Get("Authorization")
	var tokenString string

	if authHeader != "" {
		// Extract the token from "Bearer <token>"
		tokenString = strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			tokenString = ""
		}
	}

	if tokenString == "" {
		log.Printf("AUTH DENIED - No valid token for %s", r.URL.Path)
		return false
	}

	// Verify the token
	username, _ := verifyToken(tokenString)
	if username == "" {
		log.Printf("AUTH DENIED - Invalid token for %s", r.URL.Path)
		return false
	}

	log.Printf("AUTH SUCCESS - User: %v on %s", username, r.URL.Path)
	return true
}

func serveFile(w http.ResponseWriter, filePath string) {
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Open the file
	file, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "Unable to open file", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Set content type based on file extension
	ext := filepath.Ext(filePath)
	contentType := getContentType(ext)
	w.Header().Set("Content-Type", contentType)

	// Copy file content to response
	_, err = io.Copy(w, file)
	if err != nil {
		log.Printf("Error serving file %s: %v", filePath, err)
	}
}

func getContentType(ext string) string {
	switch ext {
	case ".html":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	default:
		return "text/plain"
	}
}
