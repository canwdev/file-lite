package middlewares

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
)

func newAuthTestServer() *echo.Echo {
	e := echo.New()
	private := func(c echo.Context) error { return c.String(http.StatusOK, "ok") }
	e.GET("/private", private, AuthMiddleware)
	e.POST("/private", private, AuthMiddleware)
	e.GET("/read", private, BrowserReadAuthMiddleware)
	e.HEAD("/read", private, BrowserReadAuthMiddleware)
	e.POST("/read", private, BrowserReadAuthMiddleware)
	e.GET("/read-fail", func(c echo.Context) error { return c.NoContent(http.StatusNotFound) }, BrowserReadAuthMiddleware)
	e.POST("/refresh", func(c echo.Context) error { return c.NoContent(http.StatusNoContent) }, RefreshAuthMiddleware)
	return e
}

func authCall(e *echo.Echo, method, path, token, session string, csrf bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = "10.0.0.1:1111"
	if token != "" {
		req.AddCookie(&http.Cookie{Name: AuthCookieName(), Value: token})
	}
	if session != "" {
		req.AddCookie(&http.Cookie{Name: SessionCookieName(), Value: session})
	}
	if csrf {
		req.Header.Set(CSRFTokenHeader, session)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func findSetCookie(rec *httptest.ResponseRecorder, name string) (string, bool) {
	for _, line := range rec.Header().Values("Set-Cookie") {
		if strings.HasPrefix(line, name+"=") {
			return line, true
		}
	}
	return "", false
}

func cookieValue(line, name string) string {
	first := strings.SplitN(line, ";", 2)[0]
	return strings.TrimPrefix(first, name+"=")
}

func TestAuthMiddlewareRenewsNearExpiry(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()
	now := time.Now()

	// Eleven minutes into a fifteen-minute token: four minutes left, inside the
	// five-minute renewal threshold.
	token, err := config.NewAuthTokenAt(now.Add(-11*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/private", token, "sess", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}

	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok {
		t.Fatalf("近过期请求没有换发 auth cookie：%v", rec.Header().Values("Set-Cookie"))
	}
	renewed := cookieValue(line, AuthCookieName())
	if renewed == token {
		t.Fatal("换发后的 cookie 与原值相同")
	}
	info, ok := config.ParseAuthToken(renewed)
	if !ok {
		t.Fatal("换发的 token 无法解析")
	}
	if !info.AccessValid(now.Add(10 * time.Minute)) {
		t.Error("换发的 token 没有重新获得完整的 access 窗口")
	}
	if _, ok := findSetCookie(rec, SessionCookieName()); ok {
		t.Error("续期不应该重写 session cookie")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("换发 cookie 的响应不能进共享缓存：Cache-Control = %q", cc)
	}
}

func TestAuthMiddlewareDoesNotRenewBearer(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-11*time.Minute), false)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("bearer status = %d，期望 200", rec.Code)
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Errorf("bearer 请求不应设置 cookie：%v", rec.Header().Values("Set-Cookie"))
	}
}

func TestAuthMiddlewareKeepsRenewableCookieOn401(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	// Access expired one minute ago, renewal window still live.
	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/private", token, "sess", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d，期望 401", rec.Code)
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("可续期的 401 不应清 cookie：%v", rec.Header().Values("Set-Cookie"))
	}
}

func TestAuthMiddlewareClearsDeadCookie(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-40*24*time.Hour), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/private", token, "sess", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d，期望 401", rec.Code)
	}
	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok {
		t.Fatalf("失效凭据应当被清掉：%v", rec.Header().Values("Set-Cookie"))
	}
	if cookieValue(line, AuthCookieName()) != "" || !strings.Contains(line, "Max-Age=0") {
		t.Errorf("清 cookie 的响应不对：%q", line)
	}
}

func TestRefreshAuthMiddleware(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	// Access expired, renewal still live: this is exactly the case the endpoint
	// exists for.
	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}

	ok := authCall(e, http.MethodPost, "/refresh", token, "sess", true)
	if ok.Code != http.StatusNoContent {
		t.Fatalf("refresh status = %d，期望 204：%s", ok.Code, ok.Body.String())
	}

	missingCSRF := authCall(e, http.MethodPost, "/refresh", token, "sess", false)
	if missingCSRF.Code != http.StatusForbidden {
		t.Fatalf("缺少 CSRF = %d，期望 403", missingCSRF.Code)
	}

	missingSession := authCall(e, http.MethodPost, "/refresh", token, "", false)
	if missingSession.Code != http.StatusUnauthorized {
		t.Fatalf("缺少 session cookie = %d，期望 401", missingSession.Code)
	}

	// A bearer token must not be able to renew itself, even when the cookies
	// are also present.
	req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.Header.Set("Authorization", token)
	req.AddCookie(&http.Cookie{Name: AuthCookieName(), Value: token})
	req.AddCookie(&http.Cookie{Name: SessionCookieName(), Value: "sess"})
	req.Header.Set(CSRFTokenHeader, "sess")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer refresh = %d，期望 401", rec.Code)
	}

	dead, err := config.NewAuthTokenAt(time.Now().Add(-40*24*time.Hour), true)
	if err != nil {
		t.Fatal(err)
	}
	deadRes := authCall(e, http.MethodPost, "/refresh", dead, "sess", true)
	if deadRes.Code != http.StatusUnauthorized {
		t.Fatalf("失效 token 的 refresh = %d，期望 401", deadRes.Code)
	}
}

func TestAuthMiddlewareDoesNotRenewFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	// Issued 14 minutes ago for the 15-minute tier: one minute left, well
	// inside the renewal threshold, but CanRenew is false.
	token, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-14*time.Minute),
		true,
		config.PolicyForTicketTier(config.TicketTier15m),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/private", token, "sess", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("a fixed tier must not be renewed: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestAuthMiddlewareClearsExpiredFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-16*time.Minute),
		true,
		config.PolicyForTicketTier(config.TicketTier15m),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/private", token, "sess", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok || !strings.Contains(line, "Max-Age=0") {
		t.Fatalf("an expired fixed token must be cleared: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestRefreshAuthMiddlewareAcceptsValidFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	valid, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	// The middleware lets a valid fixed token reach the handler; the handler
	// itself answers 204 without setting a cookie (covered in routes tests).
	rec := authCall(e, http.MethodPost, "/refresh", valid, "sess", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("valid fixed refresh = %d, want 204: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("valid fixed refresh must not set cookies: %v", rec.Header().Values("Set-Cookie"))
	}

	expired, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-2*time.Hour),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	dead := authCall(e, http.MethodPost, "/refresh", expired, "sess", true)
	if dead.Code != http.StatusUnauthorized {
		t.Fatalf("expired fixed refresh = %d, want 401", dead.Code)
	}
}

func TestSetAuthCookiesCapsFixedTierAtTokenExpiry(t *testing.T) {
	e := echo.New()
	token, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := SetAuthCookies(c, token, true); err != nil {
		t.Fatal(err)
	}
	cookies := rec.Result().Cookies()
	var authCookie *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == AuthCookieName() {
			authCookie = cookie
		}
	}
	if authCookie == nil {
		t.Fatal("auth cookie was not set")
	}
	// The one-hour token must not leave the 365-day remember cookie behind.
	if authCookie.MaxAge < 3000 || authCookie.MaxAge > 3601 {
		t.Fatalf("fixed-tier auth cookie MaxAge = %d, want about 3600", authCookie.MaxAge)
	}
}

func TestHasUsableSession(t *testing.T) {
	e := echo.New()
	now := time.Now()
	fixedValid, err := config.NewAuthTokenAtForPolicy(now, true, config.PolicyForTicketTier(config.TicketTier1h))
	if err != nil {
		t.Fatal(err)
	}
	fixedExpired, err := config.NewAuthTokenAtForPolicy(now.Add(-2*time.Hour), true, config.PolicyForTicketTier(config.TicketTier1h))
	if err != nil {
		t.Fatal(err)
	}
	renewable, err := config.NewAuthTokenAt(now.Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	dead, err := config.NewAuthTokenAt(now.Add(-40*24*time.Hour), true)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name    string
		token   string
		session string
		want    bool
	}{
		{"fixed valid", fixedValid, "sess", true},
		{"fixed expired", fixedExpired, "sess", false},
		{"renewable access expired", renewable, "sess", true},
		{"dead", dead, "sess", false},
		{"no session cookie", fixedValid, "", false},
		{"no auth cookie", "", "sess", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.token != "" {
				req.AddCookie(&http.Cookie{Name: AuthCookieName(), Value: tc.token})
			}
			if tc.session != "" {
				req.AddCookie(&http.Cookie{Name: SessionCookieName(), Value: tc.session})
			}
			c := e.NewContext(req, httptest.NewRecorder())
			if got := HasUsableSession(c); got != tc.want {
				t.Fatalf("HasUsableSession = %v, want %v", got, tc.want)
			}
		})
	}
}

// The cookie name is part of the scheme: a Secure cookie from an earlier HTTPS
// run must not collide with the HTTP one, because Chrome refuses to overwrite
// (or delete) a Secure cookie from a non-secure origin.
func TestAuthCookieNamesAreSchemeScoped(t *testing.T) {
	cases := []struct {
		https   bool
		auth    string
		session string
	}{
		{true, "file_lite_auth_token_https", "file_lite_session_https"},
		{false, "file_lite_auth_token_http", "file_lite_session_http"},
	}
	for _, tc := range cases {
		if got := authCookieNameFor(tc.https); got != tc.auth {
			t.Errorf("authCookieNameFor(%v) = %q, want %q", tc.https, got, tc.auth)
		}
		if got := sessionCookieNameFor(tc.https); got != tc.session {
			t.Errorf("sessionCookieNameFor(%v) = %q, want %q", tc.https, got, tc.session)
		}
	}
	if authCookieNameFor(true) == authCookieNameFor(false) {
		t.Fatal("the two schemes must not share an auth cookie name")
	}
	if sessionCookieNameFor(true) == sessionCookieNameFor(false) {
		t.Fatal("the two schemes must not share a session cookie name")
	}
}

// Login expires the other scheme's pair and the legacy names, so the frontend
// cannot read a stale value for the CSRF header.
func TestSetAuthCookiesExpiresOtherScheme(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	token, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}
	if err := SetAuthCookies(c, token, true); err != nil {
		t.Fatal(err)
	}

	// The test runs in HTTP mode, so the HTTPS pair and the legacy names are
	// the ones that must be expired.
	for _, name := range []string{
		"file_lite_auth_token_https",
		"file_lite_session_https",
		"file_lite_auth_token",
		"file_lite_session",
	} {
		line, ok := findSetCookie(rec, name)
		if !ok {
			t.Fatalf("no Set-Cookie for %s", name)
		}
		if !strings.Contains(line, "Max-Age=0") {
			t.Fatalf("%s was not expired: %q", name, line)
		}
	}
}

// A browser-driven read is the one place an expired access token is renewed in
// place: the browser issues the request and cannot run the JavaScript refresh
// dance (or replay a 401) itself.
func TestBrowserReadAuthRenewsExpiredRead(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()
	now := time.Now()

	// Access expired one minute ago, renewal window still live.
	token, err := config.NewAuthTokenAt(now.Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		rec := authCall(e, method, "/read", token, "sess", false)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200: %s", method, rec.Code, rec.Body.String())
		}
		line, ok := findSetCookie(rec, AuthCookieName())
		if !ok {
			t.Fatalf("%s did not set a renewed auth cookie: %v", method, rec.Header().Values("Set-Cookie"))
		}
		renewed := cookieValue(line, AuthCookieName())
		if renewed == token {
			t.Fatalf("%s renewed cookie is the old value", method)
		}
		info, ok := config.ParseAuthToken(renewed)
		if !ok {
			t.Fatalf("%s renewed token does not parse", method)
		}
		if !info.AccessValid(now.Add(10 * time.Minute)) {
			t.Errorf("%s renewed token has no full access window", method)
		}
		if !info.Remember {
			t.Errorf("%s dropped the remember flag", method)
		}
		if _, ok := findSetCookie(rec, SessionCookieName()); ok {
			t.Errorf("%s must not rewrite the session cookie", method)
		}
		// The response carries Set-Cookie, so no shared cache may keep it even
		// before the handler gets to set its own private policy.
		if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
			t.Errorf("%s Cache-Control = %q, want private, no-store", method, cc)
		}
	}
}

func TestBrowserReadAuthRenewalIsUncacheableOnError(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read-fail", token, "sess", false)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("Cache-Control = %q, want private, no-store: a cookie-carrying error must not be cached", cc)
	}
	if _, ok := findSetCookie(rec, AuthCookieName()); !ok {
		t.Fatalf("the renewal must still happen on an error response: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestBrowserReadAuthKeepsSessionCookie(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), false)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read", token, "sess", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok {
		t.Fatalf("no renewed cookie: %v", rec.Header().Values("Set-Cookie"))
	}
	if strings.Contains(line, "Max-Age") {
		t.Errorf("a renew of a non-remembered session must stay a session cookie: %q", line)
	}
}

func TestBrowserReadAuthLeavesFreshTokenAlone(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now(), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read", token, "sess", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("a fresh token must not be rotated: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestBrowserReadAuthDoesNotRelaxWrites(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodPost, "/read", token, "sess", true)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("a renewable 401 must keep the cookie pair: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestBrowserReadAuthDoesNotRenewBearer(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/read", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer status = %d, want 401", rec.Code)
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Errorf("bearer read must not set a cookie: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestBrowserReadAuthRequiresCookiePair(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read", token, "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing session cookie status = %d, want 401", rec.Code)
	}
}

func TestBrowserReadAuthRejectsExpiredFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-16*time.Minute),
		true,
		config.PolicyForTicketTier(config.TicketTier15m),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read", token, "sess", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired fixed tier status = %d, want 401", rec.Code)
	}
	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok || !strings.Contains(line, "Max-Age=0") {
		t.Fatalf("an expired fixed token must be cleared: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestBrowserReadAuthRejectsDeadRenewal(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newAuthTestServer()

	token, err := config.NewAuthTokenAt(time.Now().Add(-40*24*time.Hour), true)
	if err != nil {
		t.Fatal(err)
	}
	rec := authCall(e, http.MethodGet, "/read", token, "sess", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("dead renewal status = %d, want 401", rec.Code)
	}
	line, ok := findSetCookie(rec, AuthCookieName())
	if !ok || !strings.Contains(line, "Max-Age=0") {
		t.Fatalf("a dead renewal window must clear the cookies: %v", rec.Header().Values("Set-Cookie"))
	}
}
