package routes

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func TestRootTicketIgnoredWhenLoggedIn(t *testing.T) {
	e := withAPIErrorHandler(echo.New())
	RegisterTicketLogin(e)
	e.Any("/", func(c echo.Context) error { return c.String(http.StatusOK, "spa") })

	ticket, err := config.NewAuthTicket(config.DefaultTicketTier)
	if err != nil {
		t.Fatal(err)
	}
	target := "/?ticket=" + url.QueryEscape(ticket.Value)
	sessionToken, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName(), Value: sessionToken})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName(), Value: "sess"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("logged-in ticket = %d %q, want 302 /", rec.Code, rec.Header().Get("Location"))
	}
	if len(rec.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("logged-in ticket must not replace cookies: %v", rec.Header().Values("Set-Cookie"))
	}

	// The ticket was ignored, not burned: a signed-out device can still use it.
	fresh := httptest.NewRequest(http.MethodGet, target, nil)
	freshRec := httptest.NewRecorder()
	e.ServeHTTP(freshRec, fresh)
	if freshRec.Code != http.StatusFound || freshRec.Header().Get("Location") != "/" {
		t.Fatalf("fresh ticket = %d %q, want 302 /", freshRec.Code, freshRec.Header().Get("Location"))
	}
	if !strings.Contains(strings.Join(freshRec.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName()) {
		t.Fatal("the ignored ticket should still be redeemable")
	}
}

func TestIETicketIgnoredWhenLoggedIn(t *testing.T) {
	e := newIEServer()
	ticket, err := config.NewAuthTicket(config.DefaultTicketTier)
	if err != nil {
		t.Fatal(err)
	}
	link := "/ie/login?ticket=" + url.QueryEscape(ticket.Value)

	loggedIn := ieCall(t, e, http.MethodGet, link, "", true)
	if loggedIn.Code != http.StatusFound || loggedIn.Header().Get("Location") != "/ie" {
		t.Fatalf("logged-in ticket = %d %q, want 302 /ie", loggedIn.Code, loggedIn.Header().Get("Location"))
	}
	if strings.Contains(strings.Join(loggedIn.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName()) {
		t.Fatalf("logged-in ticket must not replace cookies: %v", loggedIn.Header().Values("Set-Cookie"))
	}

	fresh := ieCall(t, e, http.MethodGet, "/ie?ticket="+url.QueryEscape(ticket.Value), "", false)
	if fresh.Code != http.StatusFound || fresh.Header().Get("Location") != "/ie" {
		t.Fatalf("fresh ticket = %d %q, want 302 /ie", fresh.Code, fresh.Header().Get("Location"))
	}
	if !strings.Contains(strings.Join(fresh.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName()) {
		t.Fatal("the ignored ticket should still be redeemable")
	}
}
