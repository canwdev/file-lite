package middlewares

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
)

type failureRecord struct {
	attempts  int
	expiresAt time.Time
}

type ipLimiter struct {
	mu            sync.Mutex
	failures      map[string]failureRecord
	banned        map[string]time.Time
	maxAttempts   int
	banDuration   time.Duration
	failureWindow time.Duration
	lastCleanupAt time.Time
}

func newIPLimiter() *ipLimiter {
	banDuration := 15 * time.Minute
	return &ipLimiter{
		failures:      map[string]failureRecord{},
		banned:        map[string]time.Time{},
		maxAttempts:   5,
		banDuration:   banDuration,
		failureWindow: banDuration,
	}
}

func (l *ipLimiter) check(ip string) (bool, int) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cleanupExpired(now)

	if t, ok := l.banned[ip]; ok {
		left := int(t.Sub(now).Minutes() + 0.5)
		return true, left
	}
	return false, 0
}

func (l *ipLimiter) recordFailure(ip string) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cleanupExpired(now)

	record, ok := l.failures[ip]
	if !ok || !record.expiresAt.After(now) {
		record = failureRecord{expiresAt: now.Add(l.failureWindow)}
	}
	record.attempts++
	l.failures[ip] = record

	if record.attempts >= l.maxAttempts {
		l.ban(ip, now)
	}
}

func (l *ipLimiter) recordSuccess(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.failures, ip)
}

func (l *ipLimiter) ban(ip string, now time.Time) {
	l.banned[ip] = now.Add(l.banDuration)
	delete(l.failures, ip)
}

func (l *ipLimiter) cleanupExpired(now time.Time) {
	if !l.lastCleanupAt.IsZero() && now.Sub(l.lastCleanupAt) < time.Minute {
		return
	}
	l.lastCleanupAt = now

	for ip, record := range l.failures {
		if !record.expiresAt.After(now) {
			delete(l.failures, ip)
		}
	}

	for ip, unbanTime := range l.banned {
		if !unbanTime.After(now) {
			delete(l.banned, ip)
		}
	}
}

var authLimiter = newIPLimiter()

// authTokenCookieName must match frontend AUTH_TOKEN_COOKIE_KEY.
const authTokenCookieName = "file_lite_auth_token"
const csrfHeaderName = "X-File-Lite-CSRF"

func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// clientIP returns the direct TCP peer host, without the port or any
// IPv4-mapped prefix. Forwarded headers are deliberately ignored: they are
// client-controlled, so trusting them would let an attacker rotate identities
// and dodge the failure ban.
func clientIP(c echo.Context) string {
	addr := c.Request().RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	return strings.TrimPrefix(addr, "::ffff:")
}

func isLocalRequest(c echo.Context) bool {
	ip := net.ParseIP(clientIP(c))
	return ip != nil && ip.IsLoopback()
}

func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		ip := clientIP(c)
		banned, _ := authLimiter.check(ip)
		if banned {
			return c.JSON(http.StatusForbidden, map[string]any{"message": "Forbidden"})
		}
		fromHeader := c.Request().Header.Get("Authorization")
		fromCookie := ""
		token := fromHeader
		if token == "" {
			if ck, err := c.Cookie(authTokenCookieName); err == nil {
				fromCookie = ck.Value
				token = ck.Value
			}
		}
		if token != "" && config.VerifyAuthJWT(token) {
			if !config.IsExplicitDevMode() && fromHeader == "" && !isSafeMethod(c.Request().Method) {
				if csrfToken := c.Request().Header.Get(csrfHeaderName); csrfToken == "" || csrfToken != fromCookie {
					return c.JSON(http.StatusForbidden, map[string]string{"message": "Forbidden"})
				}
			}
			authLimiter.recordSuccess(ip)
			return next(c)
		}
		authLimiter.recordFailure(ip)
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
	}
}
