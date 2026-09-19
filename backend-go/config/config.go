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

// 日志等级（logLevel 字段取值）。等级是打印阈值：
// verbose 输出全部事件日志，warn 只输出警告与错误，error 只输出错误，
// none 关闭全部事件日志。启动提示不属于任何等级，始终打印。
const (
	LogLevelVerbose = "verbose"
	LogLevelWarn    = "warn"
	LogLevelError   = "error"
	LogLevelNone    = "none"
)

type Cfg struct {
	Host         string   `json:"host"`
	Port         string   `json:"port"`
	Password     string   `json:"password"`
	JWTToken     string   `json:"jwtToken"`
	LogLevel     string   `json:"logLevel"`
	SSLKey       string   `json:"sslKey"`
	SSLCert      string   `json:"sslCert"`
	AllowedCIDRs []string `json:"allowedCIDRs"`

	// AllowSelfUpdate 允许通过 API 替换自己的二进制并重启（POST /api/update），
	// 以及直接结束进程（POST /api/update/exit）。两者都是高危操作，默认关闭：
	// 关闭时这两条路由根本不注册，请求得到的是 404。
	AllowSelfUpdate bool `json:"allowSelfUpdate"`

	// AllowedRoots 把文件访问范围限制在若干棵子树内；空（默认）表示不限制。
	//
	// 这是纵深防御，不是沙箱：进程仍以服务账户的权限运行，任何绕过路径解析层的
	// 操作都不受它约束。它拦的是「认证之后的横向移动」——签名有效期长、cookie
	// 持久化，一个泄露的 token 否则等于整台机器。
	//
	// 多条是**并集**：落在任意一条之内都放行。嵌套的（`/srv` 与 `/srv/files`）会被
	// 折叠成外层那一条——内层不会让任何新路径变得可访问。
	//
	// 每一项都必须是绝对路径的 canonical 形态（C:/Users/me、//server/share、/home/me）。
	// 启动时校验（见 main.go 的 applyAllowedRoots）：形态非法、不存在、不是目录，
	// 都直接启动失败——配错一个路径会让所有请求 403，而用户在界面上看不出原因。
	//
	// 注意这个字段由**启动路径**读取并生效，不在本包里：fileops 依赖 utils、
	// utils 依赖 config，config 再引用 fileops 就成环了。
	AllowedRoots []string `json:"allowedRoots"`
}

const PkgName = "file-lite-go"
const Version = "1.5.0"

var cfg Cfg
var dataBaseDir string
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

// normalizeLogLevel 把配置里的等级归一化为四个合法值之一。空串或未知值回落到
// warn，避免一个笔误把日志（尤其是安全告警）全部关掉。
func normalizeLogLevel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case LogLevelVerbose:
		return LogLevelVerbose
	case LogLevelWarn:
		return LogLevelWarn
	case LogLevelError:
		return LogLevelError
	case LogLevelNone:
		return LogLevelNone
	default:
		return LogLevelWarn
	}
}

func DataBaseDir() string     { return dataBaseDir }
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
	// 访问范围在读完 config.json 之后由启动路径打印（见 main.go 的 applyAllowedRoots）。

	if allowCreate {
		_ = os.MkdirAll(dataBaseDir, fs.ModePerm)
	}

	def := Cfg{
		Host:        "",
		Port:        "",
		Password:    "",
		JWTToken:    "",
		LogLevel:    LogLevelWarn,
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
	if normalizedLevel := normalizeLogLevel(cfg.LogLevel); normalizedLevel != cfg.LogLevel {
		if cfg.LogLevel != "" {
			fmt.Printf("unknown logLevel %q, falling back to %s\n", cfg.LogLevel, normalizedLevel)
		}
		cfg.LogLevel = normalizedLevel
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

	jwtToken = cfg.JWTToken
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
