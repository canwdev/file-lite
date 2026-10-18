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

// Password failures one IP may make before it is banned. Generous on purpose:
// a few slips should not lock a legitimate user out for the whole 15 minutes.
const authMaxAttempts = 15

func newIPLimiter() *ipLimiter {
	banDuration := 15 * time.Minute
	return &ipLimiter{
		failures:      map[string]failureRecord{},
		banned:        map[string]time.Time{},
		maxAttempts:   authMaxAttempts,
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

// Cookie and header names.
//
// The auth and session cookies are named per scheme. A Secure cookie created
// over HTTPS cannot be overwritten — or even deleted — by a non-secure origin,
// and it is never sent over HTTP either. With one name for both schemes, a
// browser that once visited https://host:port keeps a live Secure token after
// the server switches back to HTTP: every HTTP Set-Cookie is rejected and the
// stale cookie is not sent, so the app answers "not signed in" with no visible
// cause. Encoding the scheme in the name gives the two jars different names;
// the legacy unsuffixed names below are no longer read or written, which signs
// every existing session out once.
const (
	CSRFTokenHeader = "X-File-Lite-CSRF"

	authCookieNameHTTPS    = "file_lite_auth_token_https"
	sessionCookieNameHTTPS = "file_lite_session_https"
	authCookieNameHTTP     = "file_lite_auth_token_http"
	sessionCookieNameHTTP  = "file_lite_session_http"

	// Pre-scheme names, kept only so ClearAuthCookies can expire them.
	legacyAuthCookieName    = "file_lite_auth_token"
	legacySessionCookieName = "file_lite_session"
)

// authCookieNameFor is the pure naming rule, kept separate from
// config.IsHTTPS() so the scheme split is testable without a TLS config.
func authCookieNameFor(https bool) string {
	if https {
		return authCookieNameHTTPS
	}
	return authCookieNameHTTP
}

func sessionCookieNameFor(https bool) string {
	if https {
		return sessionCookieNameHTTPS
	}
	return sessionCookieNameHTTP
}

// AuthCookieName carries the JWT and is HttpOnly, so JavaScript can never read
// or exfiltrate it. It is named for the scheme the server is serving.
func AuthCookieName() string { return authCookieNameFor(config.IsHTTPS()) }

// SessionCookieName is readable on purpose: the frontend echoes it in
// CSRFTokenHeader for the double-submit check and uses it as a synchronous
// "logged in" hint. It is named for the scheme the server is serving.
func SessionCookieName() string { return sessionCookieNameFor(config.IsHTTPS()) }

// otherSchemeCookieNames returns the pair that belongs to the scheme the
// server is not serving.
func otherSchemeCookieNames() (auth string, session string) {
	other := !config.IsHTTPS()
	return authCookieNameFor(other), sessionCookieNameFor(other)
}

// clearCookie expires one cookie. A Secure cookie can only be removed by a
// response served over HTTPS; when that is not the case the Set-Cookie is
// ignored by the browser, which is harmless for the other-scheme pair.
func clearCookie(c echo.Context, name string, httpOnly bool) {
	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		HttpOnly: httpOnly,
		Secure:   config.IsHTTPS(),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

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

// authCookieMaxAgeForToken caps a persistent cookie at the token's own expiry
// for the fixed ticket tiers. A 15-minute share must not leave a one-year cookie
// behind; renewable tokens keep the normal remember policy.
func authCookieMaxAgeForToken(token string, remember bool) int {
	maxAge := authCookieMaxAge(remember)
	if !remember {
		return 0
	}
	info, ok := config.ParseAuthToken(token)
	if !ok || info.CanRenew {
		return maxAge
	}
	remaining := int(time.Until(info.ExpiresAt).Seconds())
	if remaining < 1 {
		remaining = 1
	}
	return remaining
}

// SetAuthCookies issues the HttpOnly auth token together with the readable
// session value. remember picks a persistent cookie over a session cookie.
//
// The pair for the other scheme and the legacy unsuffixed names are expired
// here: after a login only the current scheme's two cookies remain, so the
// frontend cannot pick a stale value for the CSRF header.
func SetAuthCookies(c echo.Context, token string, remember bool) error {
	session, err := newSessionID()
	if err != nil {
		return err
	}
	maxAge := authCookieMaxAgeForToken(token, remember)
	secure := config.IsHTTPS()

	c.SetCookie(&http.Cookie{
		Name:     AuthCookieName(),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
	c.SetCookie(&http.Cookie{
		Name:     SessionCookieName(),
		Value:    session,
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
	expireOtherSchemeCookies(c)
	return nil
}

// expireOtherSchemeCookies removes the pair that does not belong to the
// current scheme, plus the legacy names. Over HTTP a Secure cookie cannot be
// removed, which is harmless: the browser never sends or exposes it on an HTTP
// page.
func expireOtherSchemeCookies(c echo.Context) {
	otherAuth, otherSession := otherSchemeCookieNames()
	clearCookie(c, otherAuth, true)
	clearCookie(c, otherSession, false)
	clearCookie(c, legacyAuthCookieName, true)
	clearCookie(c, legacySessionCookieName, false)
}

// RenewAuthCookie replaces only the HttpOnly auth token. The readable session
// cookie is deliberately untouched: it is the CSRF value echoed by requests
// that are already in flight, and rotating it would turn those into 403s.
func RenewAuthCookie(c echo.Context, token string, remember bool) {
	c.SetCookie(&http.Cookie{
		Name:     AuthCookieName(),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   config.IsHTTPS(),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   authCookieMaxAgeForToken(token, remember),
	})
}

// AuthTokenInfoFromContext returns the credential AuthMiddleware or
// RefreshAuthMiddleware validated for this request.
func AuthTokenInfoFromContext(c echo.Context) (config.AuthTokenInfo, bool) {
	info, ok := c.Get(authTokenInfoKey).(config.AuthTokenInfo)
	return info, ok
}

// HasUsableSession reports whether the request already carries a complete,
// usable cookie pair: a live access token or a renewable token whose access
// window is over. Ticket links call it to avoid replacing a signed-in session.
func HasUsableSession(c echo.Context) bool {
	authCookie, err := c.Cookie(AuthCookieName())
	if err != nil || authCookie.Value == "" {
		return false
	}
	session, err := c.Cookie(SessionCookieName())
	if err != nil || session.Value == "" {
		return false
	}
	info, ok := config.ParseAuthToken(authCookie.Value)
	if !ok {
		return false
	}
	now := time.Now()
	return info.AccessValid(now) || info.Renewable(now)
}

// ClearAuthCookies expires every name the auth pair has used, including the
// other scheme and the legacy names (best effort: a Secure cookie cannot be
// removed from an HTTP response). The HttpOnly token can only be removed by
// the server, which is why logout has to be an endpoint.
func ClearAuthCookies(c echo.Context) {
	otherAuth, otherSession := otherSchemeCookieNames()
	for _, cookie := range []struct {
		name     string
		httpOnly bool
	}{
		{AuthCookieName(), true},
		{SessionCookieName(), false},
		{otherAuth, true},
		{otherSession, false},
		{legacyAuthCookieName, true},
		{legacySessionCookieName, false},
	} {
		clearCookie(c, cookie.name, cookie.httpOnly)
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

// AuthMiddleware protects the JSON API. The access deadline is strict here: an
// expired token is exchanged at POST /api/session/refresh, where the caller can
// wait for the new cookie before the request it belongs to is sent.
func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return authMiddleware(next, false)
}

// BrowserReadAuthMiddleware protects reads the browser makes on its own: a
// <video>/<audio> Range request, an <img> thumbnail, or a direct download.
// Those requests cannot run the JavaScript refresh dance and cannot replay
// themselves after a 401, so an expired access token is renewed in place when
// the complete cookie pair and the renewal window are still live. This is the
// same trust decision ieEnsureSession makes for the classic /ie surface; it is
// not a way to skip authentication.
func BrowserReadAuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return authMiddleware(next, true)
}

func authMiddleware(next echo.HandlerFunc, renewIdleRead bool) echo.HandlerFunc {
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
			if authCookie, err := c.Cookie(AuthCookieName()); err == nil && authCookie.Value != "" {
				if session, err := c.Cookie(SessionCookieName()); err == nil && session.Value != "" {
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
				session, err := c.Cookie(SessionCookieName())
				if err != nil || session.Value == "" || c.Request().Header.Get(CSRFTokenHeader) != session.Value {
					return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
				}
			}
			// Only a cookie-authenticated request renews: a bearer token belongs
			// to a script, and setting a browser cookie on its response would be
			// surprising. The request is already authorized, so renewing here is
			// invisible to the caller.
			if fromHeader == "" && info.NeedsRenewal(now) {
				// The handler (GET /api/session) must report the renewed
				// deadline, not the one from the cookie we just replaced.
				if freshInfo, renewed := renewTokenCookie(c, info); renewed {
					info = freshInfo
				}
			}
			c.Set(authTokenInfoKey, info)
			authLimiter.recordSuccess(ip)
			return next(c)
		}

		// The access window is over but the renewal window is not. A
		// browser-driven read may renew in place: refusing it would break a
		// stream the user agent cannot retry, which is exactly what happens to a
		// paused video after the access token expires. Everything else keeps the
		// cookie pair for POST /api/session/refresh.
		if fromHeader == "" && tokenOK && info.Renewable(now) {
			if renewIdleRead && isReadMethod(c.Request().Method) {
				if freshInfo, renewed := renewTokenCookie(c, info); renewed {
					c.Set(authTokenInfoKey, freshInfo)
					authLimiter.recordSuccess(ip)
					return next(c)
				}
			}
			return apierr.Write(c, apierr.UnauthorizedReason("session needs renewal"))
		}

		// A dead credential is dropped so the browser stops replaying it. Token
		// failures deliberately do not feed authLimiter: that ban exists for
		// password guessing, and several parallel 401s after an idle period
		// would otherwise lock the user out.
		if fromHeader == "" {
			ClearAuthCookies(c)
		}
		switch {
		case fromHeader != "":
			return apierr.Write(c, apierr.UnauthorizedReason("access token is invalid or expired"))
		case token == "":
			return apierr.Write(c, apierr.UnauthorizedReason("not signed in"))
		default:
			return apierr.Write(c, apierr.UnauthorizedReason("session is invalid or expired"))
		}
	}
}

// renewTokenCookie exchanges a live renewal window for a fresh access token and
// writes it to the response. The caller has already checked the cookie pair and
// the renewal window.
//
// The response is marked unshareable: a handler that fails after this point
// answers with an error that carries Set-Cookie, and a cached Set-Cookie could
// hand the fresh token to another client. A success handler that has a better
// private cache policy (the file and thumbnail reads do) overwrites it.
func renewTokenCookie(c echo.Context, info config.AuthTokenInfo) (config.AuthTokenInfo, bool) {
	fresh, err := config.RenewAuthToken(info)
	if err != nil {
		return info, false
	}
	RenewAuthCookie(c, fresh, info.Remember)
	c.Response().Header().Set(echo.HeaderCacheControl, "private, no-store")
	if freshInfo, ok := config.ParseAuthToken(fresh); ok {
		info = freshInfo
	}
	return info, true
}

// isReadMethod is the set BrowserReadAuthMiddleware may renew for. OPTIONS is
// deliberately excluded: it has no route here and carries no credential.
func isReadMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead
}

// RefreshAuthMiddleware protects POST /api/session/refresh. It does not use
// AuthMiddleware on purpose: the access window may already be over. A renewal
// is authorized by the renewal window, the cookie pair and the CSRF header,
// which means a leaked bearer token cannot extend itself.
func RefreshAuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if c.Request().Header.Get("Authorization") != "" {
			return apierr.Write(c, apierr.UnauthorizedReason("renewal requires the session cookies"))
		}
		authCookie, err := c.Cookie(AuthCookieName())
		if err != nil || authCookie.Value == "" {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.UnauthorizedReason("not signed in"))
		}
		session, err := c.Cookie(SessionCookieName())
		if err != nil || session.Value == "" {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.UnauthorizedReason("session cookie is missing"))
		}
		if !config.IsExplicitDevMode() && c.Request().Header.Get(CSRFTokenHeader) != session.Value {
			return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
		}
		info, ok := config.ParseAuthToken(authCookie.Value)
		now := time.Now()
		// A fixed tier may still be valid even though it can never be renewed;
		// let the handler answer 204 for it. Only a token that is neither usable
		// now nor renewable is dead at this point.
		if !ok || (!info.AccessValid(now) && !info.Renewable(now)) {
			ClearAuthCookies(c)
			return apierr.Write(c, apierr.UnauthorizedReason("session is invalid or expired"))
		}
		c.Set(authTokenInfoKey, info)
		return next(c)
	}
}
