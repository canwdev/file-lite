package middlewares

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
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

// Cookie and header names. AuthCookieName carries the JWT and is HttpOnly, so
// JavaScript can never read or exfiltrate it. SessionCookieName is readable on
// purpose: the frontend echoes it in CSRFTokenHeader for the double-submit
// check and uses it as a synchronous "logged in" hint.
const (
	AuthCookieName    = "file_lite_auth_token"
	SessionCookieName = "file_lite_session"
	CSRFTokenHeader   = "X-File-Lite-CSRF"
)

const authSessionCookieMaxAge = 365 * 24 * 60 * 60

// SetAuthCookies issues the HttpOnly auth token together with the readable
// session value. remember picks a persistent cookie over a session cookie.
func SetAuthCookies(c echo.Context, token string, remember bool) error {
	session, err := newSessionID()
	if err != nil {
		return err
	}
	maxAge := 0
	if remember {
		maxAge = authSessionCookieMaxAge
	}
	secure := config.IsHTTPS()

	c.SetCookie(&http.Cookie{
		Name:     AuthCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
	c.SetCookie(&http.Cookie{
		Name:     SessionCookieName,
		Value:    session,
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
	return nil
}

// ClearAuthCookies expires both cookies. The HttpOnly token can only be removed
// by the server, which is why logout has to be an endpoint.
func ClearAuthCookies(c echo.Context) {
	secure := config.IsHTTPS()
	for _, name := range []string{AuthCookieName, SessionCookieName} {
		c.SetCookie(&http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: name == AuthCookieName,
			Secure:   secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		})
	}
}

func newSessionID() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate session id: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

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

// ClientIP 暴露给路由层用于记录登录失败来源，语义与内部 clientIP 完全相同：
// 只看直连 TCP peer，不信任任何转发头。
func ClientIP(c echo.Context) string { return clientIP(c) }

func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		ip := clientIP(c)
		banned, _ := authLimiter.check(ip)
		if banned {
			return c.JSON(http.StatusForbidden, map[string]any{"message": "Forbidden"})
		}
		fromHeader := c.Request().Header.Get("Authorization")
		token := fromHeader
		if token == "" {
			if ck, err := c.Cookie(AuthCookieName); err == nil {
				token = ck.Value
			}
		}
		if token != "" && config.VerifyAuthJWT(token) {
			// Cookie-authenticated writes must pass the double-submit check; an
			// explicit bearer token (curl / scripts) is exempt because a browser
			// cannot be tricked into sending one.
			if !config.IsExplicitDevMode() && fromHeader == "" && !isSafeMethod(c.Request().Method) {
				session, err := c.Cookie(SessionCookieName)
				if err != nil || session.Value == "" || c.Request().Header.Get(CSRFTokenHeader) != session.Value {
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
