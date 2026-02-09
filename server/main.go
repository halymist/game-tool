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
	AWS_ACCESS_KEY_ID     string
	AWS_SECRET_ACCESS_KEY string
	DB_HOST               string
	DB_PORT               string
	DB_NAME               string
	DB_USER               string
	DB_PASSWORD           string
)

var jwksSet jwk.Set
var s3Client *s3.Client
var s3Presigner *s3.PresignClient
var db *sql.DB

func init() {
	// Load environment variables from .env file in parent directory
	if err := godotenv.Load("../.env"); err != nil {
		log.Printf("Warning: .env file not found, using environment variables")
	}

	// Load configuration from environment
	COGNITO_REGION = os.Getenv("COGNITO_REGION")
	COGNITO_USER_POOL = os.Getenv("COGNITO_USER_POOL")
	COGNITO_CLIENT_ID = os.Getenv("COGNITO_CLIENT_ID")
	S3_BUCKET_NAME = os.Getenv("S3_BUCKET_NAME")
	S3_REGION = os.Getenv("S3_REGION")
	AWS_ACCESS_KEY_ID = os.Getenv("AWS_ACCESS_KEY_ID")
	AWS_SECRET_ACCESS_KEY = os.Getenv("AWS_SECRET_ACCESS_KEY")
	DB_HOST = os.Getenv("DB_HOST")
	DB_PORT = os.Getenv("DB_PORT")
	DB_NAME = os.Getenv("DB_NAME")
	DB_USER = os.Getenv("DB_USER")
	DB_PASSWORD = os.Getenv("DB_PASSWORD")

	// Set defaults for database if not provided
	if DB_HOST == "" {
		DB_HOST = "game.cjeko20kq7as.eu-north-1.rds.amazonaws.com"
	}
	if DB_PORT == "" {
		DB_PORT = "5432"
	}
	if DB_NAME == "" {
		DB_NAME = "Game"
	}
	if DB_USER == "" {
		DB_USER = "postgres"
	}

	// Validate required environment variables
	if COGNITO_REGION == "" || COGNITO_USER_POOL == "" || COGNITO_CLIENT_ID == "" {
		log.Fatal("Missing required Cognito environment variables")
	}
	if S3_BUCKET_NAME == "" || S3_REGION == "" || AWS_ACCESS_KEY_ID == "" || AWS_SECRET_ACCESS_KEY == "" {
		log.Fatal("Missing required S3 environment variables")
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
		s3Presigner = nil
	} else {
		s3Client = s3.NewFromConfig(cfg)
		s3Presigner = s3.NewPresignClient(s3Client)
		log.Printf("SUCCESS: S3 client initialized for region: %s", S3_REGION)

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
	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=require",
		DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)

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
	http.HandleFunc("/api/getEffects", corsHandler(handleGetEffects))
	http.HandleFunc("/api/getItems", corsHandler(handleGetItems))
	http.HandleFunc("/api/getPerks", corsHandler(getPerksHandler))

	// Item endpoints (uses tooling schema)
	http.HandleFunc("/api/createItem", corsHandler(handleCreateItem))
	http.HandleFunc("/api/toggleApproveItem", corsHandler(handleToggleApproveItem))
	http.HandleFunc("/api/mergeItems", corsHandler(handleMergeItems))
	http.HandleFunc("/api/getItemAssets", corsHandler(handleGetItemAssets))
	http.HandleFunc("/api/uploadItemAsset", corsHandler(handleUploadItemAsset))
	http.HandleFunc("/api/removePendingItem", corsHandler(CreateRemovePendingHandler("tooling.remove_item_pending", "item")))

	// Perk endpoints (uses tooling schema)
	http.HandleFunc("/api/createPerk", corsHandler(handleCreatePerk))
	http.HandleFunc("/api/toggleApprovePerk", corsHandler(handleToggleApprovePerk))
	http.HandleFunc("/api/mergePerks", corsHandler(handleMergePerks))
	http.HandleFunc("/api/getPerkAssets", corsHandler(handleGetPerkAssets))
	http.HandleFunc("/api/uploadPerkAsset", corsHandler(handleUploadPerkAsset))
	http.HandleFunc("/api/removePendingPerk", corsHandler(CreateRemovePendingHandler("tooling.remove_perk_pending", "perk")))

	// Enemy endpoints (uses tooling schema)
	http.HandleFunc("/api/getEnemies", corsHandler(handleGetEnemies))
	http.HandleFunc("/api/getTalentsInfo", corsHandler(handleGetTalentsInfo))
	http.HandleFunc("/api/updateTalentInfo", corsHandler(handleUpdateTalentInfo))
	http.HandleFunc("/api/getTalentAssets", corsHandler(CreateGetAssetsHandler("perks")))
	http.HandleFunc("/api/uploadTalentAsset", corsHandler(CreateUploadAssetHandler("perks")))
	http.HandleFunc("/api/createEnemy", corsHandler(handleCreateEnemy))
	http.HandleFunc("/api/toggleApproveEnemy", corsHandler(handleToggleApproveEnemy))
	http.HandleFunc("/api/mergeEnemies", corsHandler(handleMergeEnemies))
	http.HandleFunc("/api/removePendingEnemy", corsHandler(handleRemovePendingEnemy))
	http.HandleFunc("/api/getEnemyAssets", corsHandler(CreateGetAssetsHandler("enemies")))
	http.HandleFunc("/api/uploadEnemyAsset", corsHandler(CreateUploadAssetHandler("enemies")))

	// Expedition endpoints
	http.HandleFunc("/api/getExpeditionAssets", corsHandler(handleGetExpeditionAssets))
	http.HandleFunc("/api/uploadExpeditionAsset", corsHandler(handleUploadExpeditionAsset))
	http.HandleFunc("/api/saveExpedition", corsHandler(handleSaveExpedition))
	http.HandleFunc("/api/getExpedition", corsHandler(handleGetExpedition))
	http.HandleFunc("/api/deleteExpeditionSlide", corsHandler(handleDeleteExpeditionSlide))
	http.HandleFunc("/api/deleteExpeditionOption", corsHandler(handleDeleteExpeditionOption))

	// Settlement endpoints
	http.HandleFunc("/api/getSettlements", corsHandler(handleGetSettlements))
	http.HandleFunc("/api/getSettlementAssets", corsHandler(handleGetSettlementAssets))
	http.HandleFunc("/api/uploadSettlementAsset", corsHandler(handleUploadSettlementAsset))
	http.HandleFunc("/api/saveSettlement", corsHandler(handleSaveSettlement))
	http.HandleFunc("/api/deleteSettlement", corsHandler(handleDeleteSettlement))

	// Quest endpoints
	http.HandleFunc("/api/getQuests", corsHandler(handleGetQuests))
	http.HandleFunc("/api/createQuest", corsHandler(handleCreateQuest))
	http.HandleFunc("/api/saveQuest", corsHandler(handleSaveQuest))
	http.HandleFunc("/api/deleteQuestOption", corsHandler(handleDeleteQuestOption))
	http.HandleFunc("/api/getQuestAssets", corsHandler(handleGetQuestAssets))
	http.HandleFunc("/api/uploadQuestAsset", corsHandler(handleUploadQuestAsset))

	// NPC endpoints
	http.HandleFunc("/api/getNpcs", corsHandler(handleGetNpcs))
	http.HandleFunc("/api/createNpc", corsHandler(handleCreateNpc))
	http.HandleFunc("/api/updateNpc", corsHandler(handleUpdateNpc))
	http.HandleFunc("/api/deleteNpc", corsHandler(handleDeleteNpc))

	// Server management endpoints
	http.HandleFunc("/api/getServers", corsHandler(handleGetServers))
	http.HandleFunc("/api/createServer", corsHandler(handleCreateServer))

	// Chat moderation endpoints
	http.HandleFunc("/api/getBannedWords", corsHandler(handleGetBannedWords))
	http.HandleFunc("/api/addBannedWord", corsHandler(handleAddBannedWord))
	http.HandleFunc("/api/deleteBannedWord", corsHandler(handleDeleteBannedWord))

	fmt.Println("Server starting on :8080")
	fmt.Println("Available endpoints:")
	fmt.Println("  GET /login - Login page")
	fmt.Println("  GET /dashboard - Dashboard")
	fmt.Println("  GET /static/ - Static files (CSS/JS public, others protected)")
	fmt.Println("  GET /api/getEffects - Get all effects (authenticated)")
	fmt.Println("  GET /api/getItems - Get all items (authenticated)")
	fmt.Println("  POST /api/createItem - Create/update item (authenticated)")
	fmt.Println("  POST /api/toggleApproveItem - Toggle item approval (authenticated)")
	fmt.Println("  GET /api/getPerks - Get perks and effects (authenticated)")
	fmt.Println("  GET /api/getEnemies - Get enemies (temporarily read-only)")
	fmt.Println("  NOTE: createEnemy endpoint disabled during refactor")

	log.Fatal(http.ListenAndServe(":8080", nil))
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

	serveFile(w, "../tool/login.html")
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
	serveFile(w, "../tool/index.html")
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	urlPath := strings.TrimPrefix(r.URL.Path, "/static/")
	filePath := filepath.Join("../tool", urlPath)

	// Allow CSS and JS files without authentication
	ext := filepath.Ext(urlPath)
	if ext == ".css" || ext == ".js" {
		log.Printf("SERVING PUBLIC STATIC: %s", urlPath)
		serveFile(w, filePath)
		return
	}

	// For other files (images, etc.), require authentication
	if !isAuthenticated(r) {
		log.Printf("AUTH DENIED - Protected static file: %s", urlPath)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("SERVING PROTECTED STATIC: %s", urlPath)
	serveFile(w, filePath)
}

func verifyToken(tokenString string) (string, bool) {
	// Parse the token
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
