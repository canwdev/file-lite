package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func fixedRefreshCall(t *testing.T, token string) *httptest.ResponseRecorder {
	t.Helper()
	e := newSessionRefreshServer()
	req := httptest.NewRequest(http.MethodPost, "/api/session/refresh", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName(), Value: token})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName(), Value: "sess"})
	req.Header.Set(middlewares.CSRFTokenHeader, "sess")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestRefreshSessionIsNoOpForValidFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	token, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := fixedRefreshCall(t, token)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("fixed refresh = %d, want 204: %s", rec.Code, rec.Body.String())
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("fixed refresh must not rotate the token: %v", rec.Header().Values("Set-Cookie"))
	}
}

func TestRefreshSessionRejectsExpiredFixedTier(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	token, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-2*time.Hour),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := fixedRefreshCall(t, token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired fixed refresh = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	joined := strings.Join(rec.Header().Values("Set-Cookie"), "\n")
	if !strings.Contains(joined, middlewares.AuthCookieName()) || !strings.Contains(joined, "Max-Age=0") {
		t.Fatalf("expired fixed refresh should clear cookies: %v", rec.Header().Values("Set-Cookie"))
	}
}
