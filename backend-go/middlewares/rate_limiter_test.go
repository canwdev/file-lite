package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

func loginStatus(t *testing.T, ban *ipLimiter, limiter *requestLimiter, fail *bool, remoteAddr string) int {
	t.Helper()
	e := echo.New()
	e.Use(loginGuard(ban, limiter))
	e.POST("/login", func(c echo.Context) error {
		if *fail {
			return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		}
		return c.JSON(http.StatusOK, map[string]string{"token": "x"})
	})

	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func TestLoginGuardBansAfterFailures(t *testing.T) {
	ban := newIPLimiter()
	limiter := newRequestLimiter(1000, time.Minute)
	fail := true

	for i := 0; i < 5; i++ {
		if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusUnauthorized {
			t.Fatalf("attempt %d = %d, want 401", i+1, got)
		}
	}
	if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusTooManyRequests {
		t.Fatalf("after 5 failures = %d, want 429", got)
	}
	// 其他 IP 不受影响
	if got := loginStatus(t, ban, limiter, &fail, "10.0.0.2:1111"); got != http.StatusUnauthorized {
		t.Errorf("other IP = %d, want 401", got)
	}
}

func TestLoginGuardSuccessResetsFailures(t *testing.T) {
	ban := newIPLimiter()
	limiter := newRequestLimiter(1000, time.Minute)
	fail := true

	for i := 0; i < 4; i++ {
		loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111")
	}
	fail = false
	if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusOK {
		t.Fatalf("successful login = %d, want 200", got)
	}

	// 成功后失败计数清零：接下来 5 次失败都应放行（第 5 次触发封禁）
	fail = true
	for i := 0; i < 5; i++ {
		if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusUnauthorized {
			t.Fatalf("post-reset attempt %d = %d, want 401", i+1, got)
		}
	}
	if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusTooManyRequests {
		t.Fatalf("after reset cycle = %d, want 429", got)
	}
}

func TestLoginGuardRequestCap(t *testing.T) {
	ban := newIPLimiter()
	limiter := newRequestLimiter(2, time.Minute)
	fail := false

	for i := 0; i < 2; i++ {
		if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusOK {
			t.Fatalf("request %d = %d, want 200", i+1, got)
		}
	}
	if got := loginStatus(t, ban, limiter, &fail, "10.0.0.1:1111"); got != http.StatusTooManyRequests {
		t.Fatalf("third request = %d, want 429", got)
	}
}

func TestRequestLimiterAllow(t *testing.T) {
	l := newRequestLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !l.allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if l.allow("1.2.3.4") {
		t.Error("4th request should be limited")
	}
	if !l.allow("5.6.7.8") {
		t.Error("another IP should not be affected")
	}
}

func TestClientIP(t *testing.T) {
	e := echo.New()
	cases := map[string]string{
		"192.168.1.5:1234":          "192.168.1.5",
		"[::1]:1234":                "::1",
		"[::ffff:192.168.1.5]:1234": "192.168.1.5",
	}
	for remote, want := range cases {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = remote
		if got := clientIP(e.NewContext(req, httptest.NewRecorder())); got != want {
			t.Errorf("clientIP(%q) = %q, want %q", remote, got, want)
		}
	}
}
