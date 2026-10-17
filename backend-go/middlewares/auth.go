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

	"file-lite-go/apierr"
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

// authTokenInfoKey stores the credential RefreshAuthMiddleware validated, so
// the handler does not have to parse the cookie a second time.
const authTokenInfoKey = "file_lite.auth_token_info"

const authSessionCookieMaxAge = 365 * 24 * 60 * 60

func authCookieMaxAge(remember bool) int {
	if remember {
		return authSessionCookieMaxAge
	}
	return 0
}

// SetAuthCookies issues the HttpOnly auth token together with the readable
// session value. remember picks a persistent cookie over a session cookie.
func SetAuthCookies(c echo.Context, token string, remember bool) error {
	session, err := newSessionID()
	if err != nil {
		return err
	}
	maxAge := authCookieMaxAge(remember)
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

// RenewAuthCookie replaces only the HttpOnly auth token. The readable session
// cookie is deliberately untouched: it is the CSRF value echoed by requests
// that are already in flight, and rotating it would turn those into 403s.
func RenewAuthCookie(c echo.Context, token string, remember bool) {
	c.SetCookie(&http.Cookie{
		Name:     AuthCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   config.IsHTTPS(),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   authCookieMaxAge(remember),
	})
}

// AuthTokenInfoFromContext returns the credential that RefreshAuthMiddleware
// validated for this request.
func AuthTokenInfoFromContext(c echo.Context) (config.AuthTokenInfo, bool) {
	info, ok := c.Get(authTokenInfoKey).(config.AuthTokenInfo)
	return info, ok
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
			return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
		}
		fromHeader := c.Request().Header.Get("Authorization")
		token := fromHeader
		if token == "" {
			// The auth and session cookies are issued and cleared as a pair, so an
			// auth cookie without its session partner is a leftover (an older
			// version, or a deleted cookie). Reject it: accepting it would allow
			// reads while every write fails the CSRF check.
			if authCookie, err := c.Cookie(AuthCookieName); err == nil && authCookie.Value != "" {
				if session, err := c.Cookie(SessionCookieName); err == nil && session.Value != "" {
					token = authCookie.Value
				}
			}
		}

		info, tokenOK := config.ParseAuthToken(token)
		now := time.Now()
		if tokenOK && info.AccessValid(now) {
			// Cookie-authenticated writes must pass the double-submit check; an
			// explicit bearer token (curl / scripts) is exempt because a browser
			// cannot be tricked into sending one.
			if !config.IsExplicitDevMode() && fromHeader == "" && !isSafeMethod(c.Request().Method) {
				session, err := c.Cookie(SessionCookieName)
				if err != nil || session.Value == "" || c.Request().Header.Get(CSRFTokenHeader) != session.Value {
					return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
				}
			}
			// Only a cookie-authenticated request renews: a bearer token belongs
			// to a script, and setting a browser cookie on its response would be
			// surprising. The request is already authorized, so renewing here is
			// invisible to the caller.
			if fromHeader == "" && info.NeedsRenewal(now) {
				if fresh, err := config.RenewAuthToken(info); err == nil {
					RenewAuthCookie(c, fresh, info.Remember)
				}
			}
			authLimiter.recordSuccess(ip)
			return next(c)
		}

		// The access window is over but the renewal window is not: keep the
		// cookie pair so the client can exchange it at POST /api/session/refresh.
		// Clearing it here would destroy the only credential that can recover
		// the session.
		if fromHeader == "" && tokenOK && info.Renewable(now) {
			return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
		}

		// A dead credential is dropped so the browser stops replaying it. Token
		// failures deliberately do not feed authLimiter: that ban exists for
		// password guessing, and several parallel 401s after an idle period
		// would otherwise lock the user out.
		if fromHeader == "" {
			ClearAuthCookies(c)
		}
		return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
	}
}

// RefreshAuthMiddleware protects POST /api/session/refresh. It does not use
// AuthMiddleware on purpose: the access window may already be over. A renewal
// is authorized by the renewal window, the cookie pair and the CSRF header,
// which means a leaked bearer token cannot extend itself.
func RefreshAuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if c.Request().Header.Get("Authorization") != "" {
			return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
		}
		authCookie, err := c.Cookie(AuthCookieName)
		if err != nil || authCookie.Value == "" {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
		}
		session, err := c.Cookie(SessionCookieName)
		if err != nil || session.Value == "" {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
		}
		if !config.IsExplicitDevMode() && c.Request().Header.Get(CSRFTokenHeader) != session.Value {
			return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
		}
		info, ok := config.ParseAuthToken(authCookie.Value)
		now := time.Now()
		if !ok || !info.Renewable(now) {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
		}
		c.Set(authTokenInfoKey, info)
		return next(c)
	}
}
