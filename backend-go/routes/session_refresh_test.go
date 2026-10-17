package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func newSessionRefreshServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	e.POST("/api/session/refresh", refreshSession, middlewares.RefreshAuthMiddleware)
	return e
}

func TestRefreshSessionEndpoint(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionRefreshServer()

	// Expired access window, live renewal window.
	oldToken, err := config.NewAuthTokenAt(time.Now().Add(-16*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/session/refresh", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName, Value: oldToken})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName, Value: "sess"})
	req.Header.Set(middlewares.CSRFTokenHeader, "sess")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("refresh status = %d，期望 204：%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("refresh 响应应当是 no-store，得到 %q", rec.Header().Get("Cache-Control"))
	}

	var renewed string
	for _, line := range rec.Header().Values("Set-Cookie") {
		if !strings.HasPrefix(line, middlewares.AuthCookieName+"=") {
			continue
		}
		renewed = strings.TrimPrefix(strings.SplitN(line, ";", 2)[0], middlewares.AuthCookieName+"=")
	}
	if renewed == "" {
		t.Fatalf("refresh 没有设置新的 auth cookie：%v", rec.Header().Values("Set-Cookie"))
	}
	info, ok := config.ParseAuthToken(renewed)
	if !ok {
		t.Fatal("换发的 token 无法解析")
	}
	if !info.AccessValid(time.Now()) {
		t.Error("换发的 token 不能用于 API")
	}
	if !info.Remember {
		t.Error("换发丢掉了 remember")
	}
}
