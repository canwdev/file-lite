package middlewares

import (
	"fmt"
	"net/http"
	"net/netip"
	"strings"

	"github.com/labstack/echo/v4"
)

// IPAllowlist restricts requests to the CIDRs configured in config.json's
// `allowedCIDRs`.
//
// A nil CIDR list means "not configured" and allows every client. An explicitly
// empty (non-nil) list denies every client, so a config mistake fails closed
// instead of silently exposing the server.
type IPAllowlist struct {
	enabled  bool
	denyAll  bool
	prefixes []netip.Prefix
	entries  []string
}

// NewIPAllowlist compiles allowedCIDRs. nil means "not configured" (allow all);
// an empty non-nil slice means "allow none". Bare IPs are accepted and treated
// as /32 or /128.
func NewIPAllowlist(allowedCIDRs []string) (*IPAllowlist, error) {
	a := &IPAllowlist{}
	if allowedCIDRs == nil {
		return a, nil
	}
	a.enabled = true
	if len(allowedCIDRs) == 0 {
		a.denyAll = true
		return a, nil
	}

	seen := make(map[netip.Prefix]bool, len(allowedCIDRs))
	for _, entry := range allowedCIDRs {
		prefix, err := parseCIDROrIP(entry)
		if err != nil {
			return nil, fmt.Errorf("invalid allowedCIDRs entry %q: %w", entry, err)
		}
		if seen[prefix] {
			continue
		}
		seen[prefix] = true
		a.prefixes = append(a.prefixes, prefix)
		a.entries = append(a.entries, prefix.String())
	}
	return a, nil
}

func parseCIDROrIP(entry string) (netip.Prefix, error) {
	s := strings.TrimSpace(entry)
	if s == "" {
		return netip.Prefix{}, fmt.Errorf("value is empty")
	}
	if prefix, err := netip.ParsePrefix(s); err == nil {
		// 接受 ::ffff:192.168.0.0/112 这类 IPv4-mapped 写法，归一成 IPv4 前缀
		if prefix.Addr().Is4In6() && prefix.Bits() >= 96 {
			return netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96).Masked(), nil
		}
		return prefix.Masked(), nil
	}
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Prefix{}, fmt.Errorf("expected an IP or CIDR")
	}
	return netip.PrefixFrom(addr, addr.BitLen()), nil
}

// Enabled reports whether filtering is active.
func (a *IPAllowlist) Enabled() bool { return a.enabled }

// Describe renders the active policy for the startup log.
func (a *IPAllowlist) Describe() string {
	switch {
	case !a.enabled:
		return "off"
	case a.denyAll:
		return "deny all (allowedCIDRs is empty)"
	default:
		return "allow " + strings.Join(a.entries, ", ")
	}
}

// Middleware rejects clients outside the allowlist with 403 Forbidden.
func (a *IPAllowlist) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !a.enabled {
				return next(c)
			}
			ip, ok := remoteIP(c)
			if !ok || !a.allows(ip) {
				return c.JSON(http.StatusForbidden, map[string]string{"message": "Forbidden"})
			}
			return next(c)
		}
	}
}

func (a *IPAllowlist) allows(ip netip.Addr) bool {
	if !a.enabled {
		return true
	}
	if a.denyAll {
		return false
	}
	for _, prefix := range a.prefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

// remoteIP returns the real TCP peer address. Forwarded headers are deliberately
// ignored: X-Forwarded-For / X-Real-IP are client-controlled and would let
// anyone spoof their way past the allowlist.
func remoteIP(c echo.Context) (netip.Addr, bool) {
	addrPort, err := netip.ParseAddrPort(c.Request().RemoteAddr)
	if err != nil {
		return netip.Addr{}, false
	}
	return addrPort.Addr().Unmap(), true
}
