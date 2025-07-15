package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
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
	"github.com/google/uuid"
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
		DB_NAME = "game"
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
		}
	}
}

func main() {
	http.HandleFunc("/", corsHandler(handleRoot))
	http.HandleFunc("/login", corsHandler(handleLogin))
	http.HandleFunc("/dashboard", corsHandler(handleDashboard))
	http.HandleFunc("/static/", corsHandler(handleStatic))
	// Enemy designer endpoints (now in enemy.go)
	http.HandleFunc("/api/createEnemy", corsHandler(handleCreateEnemy))
	http.HandleFunc("/api/updateEnemy", corsHandler(handleUpdateEnemy))
	http.HandleFunc("/api/getEnemies", corsHandler(handleGetEnemies))
	http.HandleFunc("/api/getEffects", corsHandler(handleGetEffects))
	http.HandleFunc("/api/getEnemyAssets", corsHandler(handleGetEnemyAssets))
	http.HandleFunc("/api/getSignedUrl", corsHandler(handleGetSignedUrl))

	fmt.Println("Server starting on :8080")
	fmt.Println("Available endpoints:")
	fmt.Println("  GET /login - Login page")
	fmt.Println("  GET /dashboard - Dashboard")
	fmt.Println("  GET /static/ - Static files (CSS/JS public, others protected)")
	fmt.Println("  POST /api/createEnemy - Create new enemy (authenticated)")
	fmt.Println("  POST /api/updateEnemy - Update existing enemy (authenticated)")
	fmt.Println("  GET /api/getEnemies - Get enemies and effects (authenticated)")
	fmt.Println("  GET /api/getEffects - Get all effects (authenticated)")
	fmt.Println("  GET /api/getEnemyAssets - Get all enemy assets with signed URLs (authenticated)")
	fmt.Println("  POST /api/getSignedUrl - Get signed URL for S3 file (authenticated)")

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

// HELPERS
// Helper: Generate a signed URL for private S3 object access
func generateSignedURL(key string, expiration time.Duration) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized")
	}

	presignClient := s3.NewPresignClient(s3Client)
	request, err := presignClient.PresignGetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(S3_BUCKET_NAME),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiration
	})

	if err != nil {
		return "", fmt.Errorf("failed to generate signed URL: %v", err)
	}

	return request.URL, nil
}

// Helper: Upload image to S3
func uploadImageToS3(imageData, contentType string) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized - AWS credentials not configured. Check server startup logs for setup instructions")
	}

	log.Printf("S3 client is available, proceeding with upload...")

	// Decode base64 image data
	// Remove data URL prefix if present (data:image/png;base64,...)
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	imageBytes, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	// Generate unique filename
	filename := fmt.Sprintf("images/enemies/%s.png", uuid.New().String())

	// Create S3 upload input (private bucket)
	uploadInput := &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String("image/png"),
		// Remove ACL to keep bucket private
	}

	// Upload to S3
	_, err = s3Client.PutObject(context.TODO(), uploadInput)
	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Image uploaded to S3: %s", filename)
	return filename, nil // Return S3 key instead of signed URL
}

// uploadImageToS3WithCustomKey uploads an image to S3 with a specified key/filename
func uploadImageToS3WithCustomKey(imageData, contentType, customKey string) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("S3 client not initialized - AWS credentials not configured. Check server startup logs for setup instructions")
	}

	log.Printf("S3 client is available, proceeding with upload using custom key: %s", customKey)

	// Decode base64 image data
	// Remove data URL prefix if present (data:image/png;base64,...)
	if strings.Contains(imageData, ",") {
		parts := strings.Split(imageData, ",")
		if len(parts) == 2 {
			imageData = parts[1]
		}
	}

	imageBytes, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	// Use custom key with proper path structure and WebP extension
	filename := fmt.Sprintf("images/enemies/%s.webp", customKey)

	// Create S3 upload input (private bucket)
	uploadInput := &s3.PutObjectInput{
		Bucket:      aws.String(S3_BUCKET_NAME),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(imageBytes),
		ContentType: aws.String(contentType), // Use the provided content type (image/webp)
		// Remove ACL to keep bucket private
	}

	// Upload to S3
	_, err = s3Client.PutObject(context.TODO(), uploadInput)
	if err != nil {
		return "", fmt.Errorf("failed to upload to S3: %v", err)
	}

	log.Printf("Image uploaded to S3 with custom key: %s", filename)
	return filename, nil // Return S3 key instead of signed URL
}

func handleGetSignedUrl(w http.ResponseWriter, r *http.Request) {
	// Only allow POST requests
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// PREVENT ALL CACHING
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check authentication
	if !isAuthenticated(r) {
		log.Printf("GET SIGNED URL DENIED - no auth")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Parse JSON
	var requestData map[string]interface{}
	if err := json.Unmarshal(body, &requestData); err != nil {
		log.Printf("Error parsing JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	key, ok := requestData["key"].(string)
	if !ok || key == "" {
		log.Printf("Missing or invalid key in request")
		http.Error(w, "Missing key", http.StatusBadRequest)
		return
	}

	log.Printf("GET SIGNED URL REQUEST for key: %s", key)

	// Generate signed URL for S3 object
	presignResult, err := s3Presigner.PresignGetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(S3_BUCKET_NAME),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = time.Duration(15 * time.Minute) // URL expires in 15 minutes
	})

	if err != nil {
		log.Printf("Error generating signed URL: %v", err)
		http.Error(w, "Failed to generate signed URL", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success": true,
		"url":     presignResult.URL,
		"expires": time.Now().Add(15 * time.Minute).Unix(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Error encoding response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("GET SIGNED URL SUCCESS for key: %s", key)
}
