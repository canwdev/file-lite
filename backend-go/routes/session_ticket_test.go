package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
	"file-lite-go/utils"
)

func newSessionTicketTestServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	e.POST("/api/session/tickets", createLoginTicket, middlewares.AuthMiddleware)
	e.GET("/api/session", sessionInfo, middlewares.AuthMiddleware)
	return e
}

func sessionTicketCall(e *echo.Echo, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/session/tickets", strings.NewReader(body))
	req.RemoteAddr = "10.0.0.1:1111"
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName(), Value: token})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName(), Value: "sess"})
	req.Header.Set(middlewares.CSRFTokenHeader, "sess")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func sessionInfoCall(e *echo.Echo, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName(), Value: token})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName(), Value: "sess"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestCreateLoginTicketTiers(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionTicketTestServer()
	persistent, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		tier      config.TicketTier
		body      string
		wantRenew bool
		wantTTL   time.Duration
	}{
		{config.TicketTier15m, `{"tier":"15m"}`, false, 15 * time.Minute},
		{config.TicketTier1h, `{"tier":"1h"}`, false, time.Hour},
		{config.TicketTier8h, `{"tier":"8h"}`, false, 8 * time.Hour},
		{config.TicketTier24h, `{"tier":"24h"}`, false, 24 * time.Hour},
		{config.TicketTierPersistent, `{"tier":"persistent"}`, true, 15 * time.Minute},
	}
	for _, tc := range cases {
		t.Run(string(tc.tier), func(t *testing.T) {
			rec := sessionTicketCall(e, persistent, tc.body)
			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
			}
			var response struct {
				Value string `json:"value"`
				Tier  string `json:"tier"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Tier != string(tc.tier) || response.Value == "" {
				t.Fatalf("response = %+v, want tier %q", response, tc.tier)
			}
			token, ok := config.ConsumeAuthTicket(response.Value, true)
			if !ok {
				t.Fatal("the returned ticket could not be consumed")
			}
			info, ok := config.ParseAuthToken(token)
			if !ok {
				t.Fatal("the consumed token did not parse")
			}
			if info.CanRenew != tc.wantRenew {
				t.Fatalf("CanRenew = %v, want %v", info.CanRenew, tc.wantRenew)
			}
			remaining := time.Until(info.ExpiresAt)
			if remaining < tc.wantTTL-5*time.Second || remaining > tc.wantTTL+5*time.Second {
				t.Fatalf("token lifetime = %v, want about %v", remaining, tc.wantTTL)
			}
		})
	}
}

// The returned URLs are alternatives for the same login, so each one carries
// its own single-use ticket: redeeming the terminal link must not make the LAN
// link answer "ticket is invalid or already used".
func TestCreateLoginTicketURLsAreIndependent(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionTicketTestServer()
	persistent, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}

	rec := sessionTicketCall(e, persistent, `{"tier":"persistent"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("ticket status = %d: %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Value string   `json:"value"`
		URLs  []string `json:"urls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if want := len(utils.AddressesForHost(config.Host())); len(response.URLs) != want {
		t.Fatalf("got %d URLs, want one per address (%d)", len(response.URLs), want)
	}

	tickets := make([]string, 0, len(response.URLs))
	seen := map[string]struct{}{}
	for _, raw := range response.URLs {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("URL %q: %v", raw, err)
		}
		ticket := parsed.Query().Get("ticket")
		if ticket == "" {
			t.Fatalf("URL %q has no ticket", raw)
		}
		if _, duplicate := seen[ticket]; duplicate {
			t.Fatalf("two URLs share the ticket %q", ticket)
		}
		seen[ticket] = struct{}{}
		tickets = append(tickets, ticket)
	}
	if _, ok := seen[response.Value]; !ok {
		t.Fatalf("value %q is not one of the returned URLs", response.Value)
	}

	for i, ticket := range tickets {
		if _, ok := config.ConsumeAuthTicket(ticket, true); !ok {
			t.Fatalf("URL %d was burned by redeeming an earlier one", i)
		}
		if _, ok := config.ConsumeAuthTicket(ticket, true); ok {
			t.Fatalf("URL %d was accepted twice", i)
		}
	}
}

func TestCreateLoginTicketDefaultsAndValidation(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionTicketTestServer()
	persistent, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}

	// An empty body is the legacy caller: it must still get a persistent ticket.
	legacy := sessionTicketCall(e, persistent, "")
	if legacy.Code != http.StatusCreated {
		t.Fatalf("legacy ticket status = %d: %s", legacy.Code, legacy.Body.String())
	}
	var legacyResponse struct {
		Tier string `json:"tier"`
	}
	if err := json.Unmarshal(legacy.Body.Bytes(), &legacyResponse); err != nil {
		t.Fatal(err)
	}
	if legacyResponse.Tier != string(config.TicketTierPersistent) {
		t.Fatalf("legacy tier = %q, want persistent", legacyResponse.Tier)
	}

	bad := sessionTicketCall(e, persistent, `{"tier":"5m"}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("unknown tier = %d, want 400", bad.Code)
	}
	malformed := sessionTicketCall(e, persistent, `{`)
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("malformed body = %d, want 400", malformed.Code)
	}
}

func TestCreateLoginTicketForbiddenForFixedSession(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionTicketTestServer()
	fixed, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	// Even requesting the persistent tier is refused: the restriction is on the
	// session, not the requested output.
	rec := sessionTicketCall(e, fixed, `{"tier":"persistent"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("fixed session ticket = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

func TestSessionInfoReportsExpiryAndRenewability(t *testing.T) {
	t.Setenv("FILE_LITE_DEV_MODE", "false")
	e := newSessionTicketTestServer()

	fixed, err := config.NewAuthTokenAtForPolicy(
		time.Now(),
		true,
		config.PolicyForTicketTier(config.TicketTier1h),
	)
	if err != nil {
		t.Fatal(err)
	}
	rec := sessionInfoCall(e, fixed)
	if rec.Code != http.StatusOK {
		t.Fatalf("fixed session info = %d: %s", rec.Code, rec.Body.String())
	}
	var fixedPayload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fixedPayload); err != nil {
		t.Fatal(err)
	}
	if fixedPayload["renewable"] != false {
		t.Fatalf("fixed renewable = %v, want false", fixedPayload["renewable"])
	}
	expiresIn, ok := fixedPayload["expiresIn"].(float64)
	if !ok || expiresIn < 3500 || expiresIn > 3600 {
		t.Fatalf("fixed expiresIn = %v, want about 3600", fixedPayload["expiresIn"])
	}
	if fixedPayload["expiresAt"] == nil {
		t.Fatal("fixed expiresAt missing")
	}

	persistent, err := config.NewAuthToken(true)
	if err != nil {
		t.Fatal(err)
	}
	rec = sessionInfoCall(e, persistent)
	if rec.Code != http.StatusOK {
		t.Fatalf("persistent session info = %d: %s", rec.Code, rec.Body.String())
	}
	var persistentPayload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &persistentPayload); err != nil {
		t.Fatal(err)
	}
	if persistentPayload["renewable"] != true {
		t.Fatalf("persistent renewable = %v, want true", persistentPayload["renewable"])
	}
}
