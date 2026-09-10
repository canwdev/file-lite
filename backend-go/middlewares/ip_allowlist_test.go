package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func statusFor(t *testing.T, allowedCIDRs []string, remoteAddr string) int {
	t.Helper()
	a, err := NewIPAllowlist(allowedCIDRs)
	if err != nil {
		t.Fatalf("NewIPAllowlist(%v): %v", allowedCIDRs, err)
	}
	e := echo.New()
	e.Use(a.Middleware())
	e.GET("/", func(c echo.Context) error { return c.NoContent(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func TestIPAllowlistDisabled(t *testing.T) {
	a, err := NewIPAllowlist(nil)
	if err != nil {
		t.Fatalf("NewIPAllowlist(nil): %v", err)
	}
	if a.Enabled() {
		t.Error("nil list should be disabled")
	}
	if got := a.Describe(); got != "off" {
		t.Errorf("Describe() = %q, want off", got)
	}
	if got := statusFor(t, nil, "203.0.113.5:1234"); got != http.StatusOK {
		t.Errorf("nil list should allow all, got %d", got)
	}
}

func TestIPAllowlistEmptyDeniesAll(t *testing.T) {
	a, err := NewIPAllowlist([]string{})
	if err != nil {
		t.Fatalf("NewIPAllowlist(empty): %v", err)
	}
	if !a.Enabled() {
		t.Error("explicitly empty list should be enabled")
	}
	if got := a.Describe(); got != "deny all (allowedCIDRs is empty)" {
		t.Errorf("Describe() = %q", got)
	}
	for _, addr := range []string{"127.0.0.1:1", "192.168.1.5:1", "[::1]:1"} {
		if got := statusFor(t, []string{}, addr); got != http.StatusForbidden {
			t.Errorf("empty list should deny %s, got %d", addr, got)
		}
	}
}

func TestIPAllowlistMatchesCIDR(t *testing.T) {
	cidrs := []string{"192.168.0.0/16", "10.0.0.0/8", "::1/128"}
	for _, addr := range []string{"192.168.1.5:1", "10.1.2.3:1", "[::1]:1"} {
		if got := statusFor(t, cidrs, addr); got != http.StatusOK {
			t.Errorf("%s should be allowed, got %d", addr, got)
		}
	}
	for _, addr := range []string{"203.0.113.5:1", "172.16.0.1:1", "[2001:db8::1]:1"} {
		if got := statusFor(t, cidrs, addr); got != http.StatusForbidden {
			t.Errorf("%s should be denied, got %d", addr, got)
		}
	}
}

func TestIPAllowlistUnmapsIPv4Mapped(t *testing.T) {
	if got := statusFor(t, []string{"192.168.0.0/16"}, "[::ffff:192.168.1.5]:1234"); got != http.StatusOK {
		t.Errorf("IPv4-mapped client should match the IPv4 CIDR, got %d", got)
	}
}

func TestIPAllowlistBareIP(t *testing.T) {
	if got := statusFor(t, []string{"192.168.1.10"}, "192.168.1.10:1234"); got != http.StatusOK {
		t.Errorf("bare IP should match itself, got %d", got)
	}
	if got := statusFor(t, []string{"192.168.1.10"}, "192.168.1.11:1234"); got != http.StatusForbidden {
		t.Errorf("bare IP should not match another host, got %d", got)
	}
}

func TestIPAllowlistInvalidEntry(t *testing.T) {
	for _, entry := range []string{"", "not-an-ip", "192.168.1.0/33"} {
		if _, err := NewIPAllowlist([]string{entry}); err == nil {
			t.Errorf("expected an error for %q", entry)
		}
	}
}

func TestIPAllowlistDescribe(t *testing.T) {
	a, err := NewIPAllowlist([]string{"192.168.1.10", "10.0.0.0/8"})
	if err != nil {
		t.Fatalf("NewIPAllowlist: %v", err)
	}
	if got := a.Describe(); got != "allow 192.168.1.10/32, 10.0.0.0/8" {
		t.Errorf("Describe() = %q", got)
	}
}
