package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func TestSharedWSAuthInfoCarriesTier(t *testing.T) {
	e := echo.New()
	fixed, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier15m),
	)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/ws", nil)
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName, Value: fixed})
	info, ok := sharedWSAuthInfo(e.NewContext(req, httptest.NewRecorder()))
	if !ok {
		t.Fatal("a valid fixed token should authorize the handshake")
	}
	if info.CanRenew {
		t.Fatal("a fixed token must report CanRenew=false so the handler arms the close timer")
	}

	expired, err := config.NewAuthTokenAtForPolicy(
		time.Now().Add(-2*time.Hour),
		true,
		config.PolicyForTicketTier(config.TicketTier15m),
	)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/ws", nil)
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName, Value: expired})
	if _, ok := sharedWSAuthInfo(e.NewContext(req, httptest.NewRecorder())); ok {
		t.Fatal("an expired fixed token must not authorize the handshake")
	}
}
