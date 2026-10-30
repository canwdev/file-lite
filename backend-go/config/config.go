package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

const (
	// authAccessTTL is how long an issued JWT can authenticate API requests. It
	// is short on purpose: a leaked bearer token, or a token copied out of a log,
	// must not stay usable for a year.
	authAccessTTL = 15 * time.Minute
	// authRenewWindow is how long after its last use a session may be renewed.
	// It slides forward on every renewal.
	authRenewWindow = 30 * 24 * time.Hour
	// authRenewBefore is the point at which an authenticated request replaces
	// the cookie. It matches the frontend heartbeat, so an idle tab is covered
	// by its own timer while an active one renews on use.
	authRenewBefore = 5 * time.Minute
	// authMaxSession caps a session that is renewed continuously. Zero disables
	// the cap, which keeps the previous "stay signed in while you use it"
	// behaviour while the access token itself stays short.
	authMaxSession = 0
	// authTokenVer rejects tokens minted before the access/renewal split.
	authTokenVer = 2
)

// TicketTier is the lifetime of a session created by exchanging a login ticket.
type TicketTier string

const (
	TicketTier15m        TicketTier = "15m"
	TicketTier1h         TicketTier = "1h"
	TicketTier8h         TicketTier = "8h"
	TicketTier24h        TicketTier = "24h"
	TicketTierPersistent TicketTier = "persistent"
)

// DefaultTicketTier keeps the terminal banner and requests without a tier on
// the behaviour that existed before tiers: a renewable session.
const DefaultTicketTier = TicketTierPersistent

// SessionPolicy is the lifetime rule encoded into a token.
type SessionPolicy struct {
	Renewable bool
	TTL       time.Duration
}

var ticketTierPolicies = map[TicketTier]SessionPolicy{
	TicketTier15m:        {Renewable: false, TTL: 15 * time.Minute},
	TicketTier1h:         {Renewable: false, TTL: time.Hour},
	TicketTier8h:         {Renewable: false, TTL: 8 * time.Hour},
	TicketTier24h:        {Renewable: false, TTL: 24 * time.Hour},
	TicketTierPersistent: {Renewable: true},
}

// ParseTicketTier validates a requested tier. Empty means the persistent tier,
// which keeps old clients and the terminal path working unchanged.
func ParseTicketTier(raw string) (TicketTier, bool) {
	if raw == "" {
		return TicketTierPersistent, true
	}
	tier := TicketTier(raw)
	_, ok := ticketTierPolicies[tier]
	return tier, ok
}

// PolicyForTicketTier returns the issue policy for a tier. Unknown values fall
// back to persistent; callers that accept user input must validate with
// ParseTicketTier first.
func PolicyForTicketTier(tier TicketTier) SessionPolicy {
	if policy, ok := ticketTierPolicies[tier]; ok {
		return policy
	}
	return ticketTierPolicies[TicketTierPersistent]
}

const authTicketTTL = 5 * time.Minute

// Tickets are typed by hand (the login page has a ticket field), so the
// alphabet is lowercase-only to avoid case mistakes; ten characters of 36
// symbols still carry about 51 bits.
const authTicketChars = "0123456789abcdefghijklmnopqrstuvwxyz"
const authTicketLength = 10

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
const Version = "1.6.0"

var cfg Cfg
var dataBaseDir string
var jwtToken string
var configInitialized bool
var configFilePath string
var authTicketMu sync.Mutex

// authTickets is the current batch: one single-use ticket per address the
// server prints. Redeeming one address's ticket must not burn the others (the
// loopback link and the LAN link a phone is about to open are alternatives),
// while a mint replaces the whole batch so an earlier printed URL stops
// working, exactly like the old single-ticket store.
var authTickets = map[string]authTicket{}

type authTicket struct {
	value     string
	expiresAt time.Time
	policy    SessionPolicy
}

type AuthTicketInfo struct {
	Value     string
	ExpiresAt time.Time
	Tier      TicketTier
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
func Config() Cfg             { return cfg }
func ConfigInitialized() bool { return configInitialized }
func ConfigFilePath() string  { return configFilePath }
func FrontendStorageFilePath() string {
	return filepath.Join(dataBaseDir, "frontend-storage.json")
}

// IsExplicitDevMode reports whether the operator asked for development mode on
// purpose. It gates the CSRF double-submit exemption in middlewares.AuthMiddleware,
// so only the explicit, file-lite-specific variable counts: NODE_ENV is set by
// unrelated container tooling and image defaults, and honoring it would silently
// drop the check on every cookie-authenticated write.
func IsExplicitDevMode() bool {
	return os.Getenv("FILE_LITE_DEV_MODE") == "true"
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
		_ = os.MkdirAll(dataBaseDir, 0o700)
	}

	def := Cfg{
		Host:     "",
		Port:     "",
		Password: "",
		JWTToken: "",
		LogLevel: LogLevelWarn,
		SSLKey:   "",
		SSLCert:  "",
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
		if err := os.WriteFile(fp, b, 0o600); err != nil {
			return fmt.Errorf("write config file %s: %w", fp, err)
		}
		hardenSecretFile(fp)
	}
	if _, err := os.Stat(fp); err == nil {
		configInitialized = true
		// Fix installs created before the mode was restricted: os.WriteFile keeps
		// an existing file's mode, so this cannot wait for the next write.
		hardenSecretFile(fp)
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
	if err := os.WriteFile(configFilePath, b, 0o600); err != nil {
		return fmt.Errorf("write config file %s: %w", configFilePath, err)
	}
	hardenSecretFile(configFilePath)
	return nil
}

// hardenSecretFile limits config.json to its owner. It holds the plaintext
// password and the JWT signing key, so it must not be world-readable; both
// would let any local user sign in and mint valid tokens.
func hardenSecretFile(path string) {
	if err := os.Chmod(path, 0o600); err != nil {
		fmt.Printf("warning: could not restrict permissions on %s: %v\n", path, err)
	}
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

// authClaims is the JWT payload. exp is the short access deadline; rexp is the
// sliding renewal deadline. liat records the login time so an absolute session
// cap can be enabled later without changing the token format again. norenew is
// set for fixed-lifetime ticket tiers and is absent for renewable sessions,
// which also makes 1.5.1 tokens (before this field existed) renewable.
type authClaims struct {
	Subject   string `json:"sub"`
	Type      string `json:"typ"`
	Version   int    `json:"ver"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	RenewAt   int64  `json:"rexp"`
	LoginAt   int64  `json:"liat"`
	Remember  bool   `json:"rem"`
	NoRenew   bool   `json:"norenew,omitempty"`
}

// Valid exists to satisfy jwt.Claims. Time windows are checked by the callers:
// the renewal endpoint deliberately accepts a token whose access window is over.
func (authClaims) Valid() error { return nil }

// AuthTokenInfo is the decoded, signature-checked view of a token.
type AuthTokenInfo struct {
	ExpiresAt  time.Time
	RenewUntil time.Time
	LoginAt    time.Time
	Remember   bool
	// CanRenew is false for the fixed ticket tiers. It is signed into the token,
	// so every server-side renewal check can rely on it.
	CanRenew bool
}

// AccessValid reports whether the token may authenticate an API request now.
func (i AuthTokenInfo) AccessValid(now time.Time) bool { return now.Before(i.ExpiresAt) }

// Renewable reports whether the token may still be exchanged for a fresh one.
func (i AuthTokenInfo) Renewable(now time.Time) bool {
	return i.CanRenew && now.Before(i.RenewUntil)
}

// NeedsRenewal reports whether the access window is close enough to the end
// that an authenticated request should replace the cookie now.
func (i AuthTokenInfo) NeedsRenewal(now time.Time) bool {
	return i.CanRenew && !now.Add(authRenewBefore).Before(i.ExpiresAt)
}

// NewAuthToken issues the renewable token written into the auth cookie by the
// password login and the persistent ticket tier.
func NewAuthToken(remember bool) (string, error) {
	now := time.Now()
	return issueAuthJWT(jwtToken, now, now, remember, PolicyForTicketTier(TicketTierPersistent))
}

// NewAuthTokenForPolicy issues a token for one ticket tier.
func NewAuthTokenForPolicy(remember bool, policy SessionPolicy) (string, error) {
	now := time.Now()
	return issueAuthJWT(jwtToken, now, now, remember, policy)
}

// NewAuthTokenAt mints a token as if it had been issued at issuedAt. Tests use
// it to create near-expiry and expired tokens without waiting; production code
// uses NewAuthToken.
func NewAuthTokenAt(issuedAt time.Time, remember bool) (string, error) {
	return issueAuthJWT(jwtToken, issuedAt, issuedAt, remember, PolicyForTicketTier(TicketTierPersistent))
}

// NewAuthTokenAtForPolicy is the fixed-tier counterpart of NewAuthTokenAt.
func NewAuthTokenAtForPolicy(issuedAt time.Time, remember bool, policy SessionPolicy) (string, error) {
	return issueAuthJWT(jwtToken, issuedAt, issuedAt, remember, policy)
}

// RenewAuthToken issues a fresh access token for a live renewal window. It
// preserves the original login time and the remember flag, so the optional
// absolute cap and the cookie's persistence stay stable across renewals.
// Fixed-lifetime tokens fail here because info.Renewable is false for them.
func RenewAuthToken(info AuthTokenInfo) (string, error) {
	now := time.Now()
	if !info.Renewable(now) {
		return "", fmt.Errorf("auth token renewal window has expired")
	}
	return issueAuthJWT(jwtToken, now, info.LoginAt, info.Remember, PolicyForTicketTier(TicketTierPersistent))
}

func issueAuthJWT(secret string, now, loginAt time.Time, remember bool, policy SessionPolicy) (string, error) {
	expiresAt := now.Add(authAccessTTL)
	renewAt := now.Add(authRenewWindow)
	noRenew := !policy.Renewable

	if noRenew {
		ttl := policy.TTL
		if ttl <= 0 {
			ttl = authAccessTTL
		}
		expiresAt = now.Add(ttl)
		// The renewal deadline is set as well so the claim shape stays stable;
		// CanRenew (norenew) is what actually forbids the exchange.
		renewAt = expiresAt
	} else if authMaxSession > 0 {
		if max := loginAt.Add(authMaxSession); max.Before(renewAt) {
			renewAt = max
		}
	}
	if !renewAt.After(now) {
		return "", fmt.Errorf("auth session has reached its maximum lifetime")
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, authClaims{
		Subject:   authJWTSubject,
		Type:      authJWTType,
		Version:   authTokenVer,
		IssuedAt:  now.Unix(),
		ExpiresAt: expiresAt.Unix(),
		RenewAt:   renewAt.Unix(),
		LoginAt:   loginAt.Unix(),
		Remember:  remember,
		NoRenew:   noRenew,
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign auth token: %w", err)
	}
	return signed, nil
}

// ParseAuthToken verifies the signature and shape without enforcing the access
// deadline, so the renewal endpoint can accept a token whose access window is
// over but whose renewal window is not.
func ParseAuthToken(tokenString string) (AuthTokenInfo, bool) {
	parser := jwt.Parser{
		ValidMethods:         []string{jwt.SigningMethodHS256.Alg()},
		SkipClaimsValidation: true,
	}
	token, err := parser.ParseWithClaims(tokenString, &authClaims{}, func(*jwt.Token) (interface{}, error) {
		return []byte(jwtToken), nil
	})
	if err != nil || token == nil || !token.Valid {
		return AuthTokenInfo{}, false
	}
	claims, ok := token.Claims.(*authClaims)
	if !ok || claims.Version != authTokenVer ||
		claims.Subject != authJWTSubject || claims.Type != authJWTType ||
		claims.IssuedAt == 0 || claims.ExpiresAt == 0 || claims.RenewAt == 0 || claims.LoginAt == 0 {
		return AuthTokenInfo{}, false
	}
	return AuthTokenInfo{
		ExpiresAt:  time.Unix(claims.ExpiresAt, 0),
		RenewUntil: time.Unix(claims.RenewAt, 0),
		LoginAt:    time.Unix(claims.LoginAt, 0),
		Remember:   claims.Remember,
		CanRenew:   !claims.NoRenew,
	}, true
}

// VerifyAuthJWT reports whether the token may authenticate an API request now.
// The WebSocket handshake and the classic HTML surface only need a yes/no
// answer; the API middleware uses ParseAuthToken so it can also renew.
func VerifyAuthJWT(tokenString string) bool {
	info, ok := ParseAuthToken(tokenString)
	return ok && info.AccessValid(time.Now())
}

// NewAuthTicket mints one single-use login ticket bound to a tier. The tier is
// stored server-side, so the device that redeems the ticket cannot choose a
// longer lifetime. Minting replaces the previous batch of printed tickets.
func NewAuthTicket(tier TicketTier) (AuthTicketInfo, error) {
	tickets, err := NewAuthTickets(tier, 1)
	if err != nil {
		return AuthTicketInfo{}, err
	}
	return tickets[0], nil
}

// NewAuthTickets mints count independent single-use tickets bound to one tier.
// The caller hands one to every address a login URL is printed for: the
// addresses are alternatives, so redeeming the loopback link must leave the LAN
// link usable, while every ticket itself is accepted exactly once.
//
// The batch replaces any tickets from an earlier mint. That keeps the original
// "a fresh mint invalidates the URLs a previous call returned" behaviour, so a
// stale QR code cannot be redeemed, and bounds the store to one batch.
func NewAuthTickets(tier TicketTier, count int) ([]AuthTicketInfo, error) {
	if count < 1 {
		count = 1
	}
	policy := PolicyForTicketTier(tier)
	expiresAt := time.Now().Add(authTicketTTL)

	values := make([]string, 0, count)
	seen := make(map[string]struct{}, count)
	for len(values) < count {
		value, err := generateAuthTicket()
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[value]; duplicate {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}

	authTicketMu.Lock()
	authTickets = make(map[string]authTicket, len(values))
	for _, value := range values {
		authTickets[value] = authTicket{
			value:     value,
			expiresAt: expiresAt,
			policy:    policy,
		}
	}
	authTicketMu.Unlock()

	infos := make([]AuthTicketInfo, len(values))
	for i, value := range values {
		infos[i] = AuthTicketInfo{Value: value, ExpiresAt: expiresAt, Tier: tier}
	}
	return infos, nil
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

// ConsumeAuthTicket exchanges a one-time ticket for a fresh auth token.
//
// Validation and invalidation of that one ticket happen under the same lock: a
// ticket is a single-use credential, so splitting the check from the delete
// would let it be redeemed twice — concurrently or by anyone who saw the
// printed link before it expired. Burning the ticket before the token is minted
// is deliberate: if signing somehow fails, the credential is gone rather than
// left live.
//
// Only the redeemed value is removed: the other addresses a mint printed are
// different tickets and stay usable.
func ConsumeAuthTicket(ticket string, remember bool) (string, bool) {
	now := time.Now()
	authTicketMu.Lock()
	storedTicket, ok := authTickets[ticket]
	if !ok || !storedTicket.expiresAt.After(now) {
		delete(authTickets, ticket)
		authTicketMu.Unlock()
		return "", false
	}
	delete(authTickets, ticket)
	authTicketMu.Unlock()

	// Minted outside the lock: NewAuthTokenForPolicy only reads the JWT secret.
	token, err := NewAuthTokenForPolicy(remember, storedTicket.policy)
	if err != nil {
		return "", false
	}
	return token, true
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
