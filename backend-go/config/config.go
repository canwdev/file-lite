package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt"
)

const authJWTSubject = "file-lite-user"
const authJWTType = "access"
const authTicketTTL = 2 * time.Minute
const authTicketChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const authTicketLength = 8

type Cfg struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	Password    string `json:"password"`
	JWTToken    string `json:"jwtToken"`
	SafeBaseDir string `json:"safeBaseDir"`
	EnableLog   bool   `json:"enableLog"`
	SSLKey      string `json:"sslKey"`
	SSLCert     string `json:"sslCert"`
}

const PkgName = "file-lite-go"
const Version = "1.4.2"

var cfg Cfg
var dataBaseDir string
var safeBaseDir string
var authToken string
var jwtToken string
var configInitialized bool
var configFilePath string
var authTicketMu sync.Mutex
var currentAuthTicket *authTicket

type authTicket struct {
	value     string
	expiresAt time.Time
}

type AuthTicketInfo struct {
	Value     string
	ExpiresAt time.Time
}

func normalizePath(p string) string {
	s := strings.ReplaceAll(p, "\\", "/")
	s = strings.ReplaceAll(s, "//", "/")
	return s
}

func DataBaseDir() string     { return dataBaseDir }
func SafeBaseDir() string     { return safeBaseDir }
func AuthToken() string       { return authToken }
func JWTToken() string        { return jwtToken }
func Config() Cfg             { return cfg }
func ConfigInitialized() bool { return configInitialized }
func ConfigFilePath() string  { return configFilePath }
func FrontendStorageFilePath() string {
	return filepath.Join(dataBaseDir, "frontend-storage.json")
}
func IsExplicitDevMode() bool {
	return os.Getenv("FILE_LITE_DEV_MODE") == "true" || os.Getenv("NODE_ENV") == "development"
}

func LoadConfig(allowCreate bool) error {
	fmt.Printf("%s version: %s\n\n", PkgName, Version)
	base := os.Getenv("FILE_LITE_DATA_BASE_DIR")
	if base == "" {
		wd, _ := os.Getwd()
		base = filepath.Join(wd, "file-lite")
	}
	dataBaseDir = base
	fmt.Printf("DATA_BASE_DIR: %s\n", dataBaseDir)

	if allowCreate {
		_ = os.MkdirAll(dataBaseDir, fs.ModePerm)
	}

	def := Cfg{
		Host:        "",
		Port:        "",
		Password:    "",
		JWTToken:    "",
		SafeBaseDir: "./",
		EnableLog:   true,
		SSLKey:      "",
		SSLCert:     "",
	}
	fp := filepath.Join(dataBaseDir, "config.json")
	configFilePath = fp

	configFileExists := false
	if _, err := os.Stat(fp); err != nil {
		cfg = def
	} else {
		configFileExists = true
		b, err := os.ReadFile(fp)
		if err != nil {
			return fmt.Errorf("read config file %s: %w", fp, err)
		}
		if err := json.Unmarshal(b, &cfg); err != nil {
			return fmt.Errorf("read config file %s: %w", fp, err)
		}
	}

	dirty := false
	if cfg.Password == "" {
		password, err := generatePassword()
		if err != nil {
			return err
		}
		cfg.Password = password
		dirty = true
	}
	if cfg.JWTToken == "" {
		secret, err := generateJWTSecret()
		if err != nil {
			return err
		}
		cfg.JWTToken = secret
		dirty = true
	}

	// Persist when file already exists (backfill) or explicitly creating config.
	// Ephemeral mode (!allowCreate && !configFileExists): secrets stay in memory only.
	if dirty && (configFileExists || allowCreate) {
		b, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal config: %w", err)
		}
		if err := os.WriteFile(fp, b, 0644); err != nil {
			return fmt.Errorf("write config file %s: %w", fp, err)
		}
	}
	if _, err := os.Stat(fp); err == nil {
		configInitialized = true
	} else {
		configInitialized = false
	}

	if cfg.SafeBaseDir != "" {
		wd, _ := os.Getwd()
		abs := normalizePath(filepath.Clean(filepath.Join(wd, cfg.SafeBaseDir)))
		if filepath.IsAbs(cfg.SafeBaseDir) {
			abs = normalizePath(filepath.Clean(cfg.SafeBaseDir))
		}
		safeBaseDir = abs
		if safeBaseDir != "" {
			if allowCreate {
				if _, err := os.Stat(safeBaseDir); err != nil {
					_ = os.MkdirAll(safeBaseDir, fs.ModePerm)
				}
			}
			fmt.Printf("safeBaseDir: %s\n", safeBaseDir)
		}
	} else {
		safeBaseDir = ""
	}

	jwtToken = cfg.JWTToken
	signedToken, err := NewAuthToken()
	if err != nil {
		return err
	}
	authToken = signedToken
	if configInitialized {
		fmt.Println("password: please check config file")
	} else {
		fmt.Println("ephemeral mode: no config.json (use Ticket to sign in)")
	}
	return nil
}

// ApplyListenOverrides sets listen port/host after LoadConfig (CLI > config > env).
func ApplyListenOverrides(port, host string) {
	if port != "" {
		cfg.Port = port
	}
	if host != "" {
		cfg.Host = host
	}
}

// SetSSLAndPersist updates ssl paths in config.json (relative to data dir).
func SetSSLAndPersist(key, cert string) error {
	cfg.SSLKey = key
	cfg.SSLCert = cert
	if configFilePath == "" {
		return fmt.Errorf("config file path is empty")
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(configFilePath, b, 0644); err != nil {
		return fmt.Errorf("write config file %s: %w", configFilePath, err)
	}
	return nil
}

func generateJWTSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate jwtToken: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func generatePassword() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate password: %w", err)
	}
	return fmt.Sprintf("%x", b), nil
}

func NewAuthToken() (string, error) {
	return createAuthJWT(jwtToken)
}

func NewAuthTicket() (AuthTicketInfo, error) {
	ticket, err := generateAuthTicket()
	if err != nil {
		return AuthTicketInfo{}, err
	}
	expiresAt := time.Now().Add(authTicketTTL)
	authTicketMu.Lock()
	currentAuthTicket = &authTicket{
		value:     ticket,
		expiresAt: expiresAt,
	}
	authTicketMu.Unlock()
	return AuthTicketInfo{Value: ticket, ExpiresAt: expiresAt}, nil
}

func generateAuthTicket() (string, error) {
	for {
		b := make([]byte, authTicketLength)
		for i := range b {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(authTicketChars))))
			if err != nil {
				return "", fmt.Errorf("generate auth ticket: %w", err)
			}
			b[i] = authTicketChars[n.Int64()]
		}
		ticket := string(b)
		if !isWeakAuthTicket(ticket) {
			return ticket, nil
		}
	}
}

func isWeakAuthTicket(ticket string) bool {
	counts := map[rune]int{}
	maxCount := 0
	var last rune
	repeatRun := 0
	for i, char := range ticket {
		counts[char]++
		if counts[char] > maxCount {
			maxCount = counts[char]
		}
		if i == 0 || char != last {
			repeatRun = 1
		} else {
			repeatRun++
			if repeatRun >= 3 {
				return true
			}
		}
		last = char
	}
	return len(counts) < 4 || maxCount > 3
}

func ConsumeAuthTicket(ticket string) (string, bool) {
	authTicketMu.Lock()
	storedTicket := currentAuthTicket
	authTicketMu.Unlock()
	if storedTicket == nil || storedTicket.value != ticket || storedTicket.expiresAt.Before(time.Now()) {
		return "", false
	}
	token, err := NewAuthToken()
	if err != nil {
		return "", false
	}
	return token, true
}

func createAuthJWT(secret string) (string, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": authJWTSubject,
		"typ": authJWTType,
		"iat": now.Unix(),
		"exp": now.AddDate(1, 0, 0).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign auth token: %w", err)
	}
	return signed, nil
}

func VerifyAuthJWT(tokenString string) bool {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(jwtToken), nil
	})
	if err != nil || token == nil || !token.Valid {
		return false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}
	sub, subOk := claims["sub"].(string)
	typ, typOk := claims["typ"].(string)
	return subOk && typOk && sub == authJWTSubject && typ == authJWTType
}

func Port() int {
	env := os.Getenv("PORT")
	p := cfg.Port
	if p == "" {
		p = env
	}
	if p == "" {
		p = "3100"
	}
	i, _ := strconv.Atoi(p)
	return i
}

// FrontendPort 仅用于打印 dev 前端端口（不影响服务器监听）
func FrontendPort() int {
	if v := os.Getenv("FILE_LITE_FE_PORT"); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i > 0 {
			return i
		}
	}
	return Port()
}

func Host() string {
	env := os.Getenv("HOST")
	h := cfg.Host
	if h == "" {
		h = env
	}
	if h == "" {
		h = "0.0.0.0"
	}
	return h
}

func IsHTTPS() bool { return cfg.SSLKey != "" && cfg.SSLCert != "" }
