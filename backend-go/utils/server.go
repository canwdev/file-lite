package utils

import (
	"fmt"
	"net"
	"strings"
	"time"

	"file-lite-go/config"
)

func formatHostForURL(ip string) string {
	if strings.Contains(ip, ":") {
		return "[" + ip + "]"
	}
	return ip
}

// GetInterfaceIPs returns the IPv4 (then IPv6) addresses of every enabled
// network interface, loopback included. It is the raw enumeration shared by
// URL printing and self-signed TLS SAN building.
func GetInterfaceIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	var ipv4s []string
	var ipv6s []string

	for _, iface := range ifaces {
		// 与 Node.js os.networkInterfaces() 一致：仅枚举已启用的网卡
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}

			if v4 := ipnet.IP.To4(); v4 != nil {
				ipv4s = append(ipv4s, v4.String())
				continue
			}

			if ipnet.IP.To16() != nil {
				ipv6s = append(ipv6s, ipnet.IP.String())
			}
		}
	}

	return append(ipv4s, ipv6s...)
}

func GetAvailableIPs(host string) []string {
	if host != "0.0.0.0" {
		return nil
	}
	return GetInterfaceIPs()
}

// AddressesForHost returns the addresses a client can use to reach the server:
// every enabled interface for the wildcard host, otherwise the configured host.
func AddressesForHost(host string) []string {
	ips := GetAvailableIPs(host)
	if len(ips) == 0 && host != "" && host != "0.0.0.0" && host != "::" {
		// Bound to one concrete address: GetAvailableIPs only enumerates
		// interfaces for the wildcard host, so fall back to that address.
		ips = []string{host}
	}
	if len(ips) == 0 {
		ips = []string{"127.0.0.1"}
	}
	return ips
}

// BuildConnectionURLsForTickets returns one access URL per address, each
// carrying its own optional ticket. Callers pass exactly one ticket per
// address; the two lists come from AddressesForHost and NewAuthTickets, so they
// always line up. It is the single place that formats a host for a URL (IPv6
// needs brackets), shared by the startup banner and the IP chooser API.
func BuildConnectionURLsForTickets(protocol string, ips []string, port int, tickets []string) []string {
	if len(ips) != len(tickets) {
		return nil
	}
	urls := make([]string, 0, len(ips))
	for i, ip := range ips {
		suffix := ""
		if tickets[i] != "" {
			suffix = "?ticket=" + tickets[i]
		}
		urls = append(urls, fmt.Sprintf("%s//%s:%d%s", protocol, formatHostForURL(ip), port, suffix))
	}
	return urls
}

// LoginLinks is one ready-to-open login URL per local address. Each URL has its
// own single-use ticket, so redeeming one does not invalidate the rest.
type LoginLinks struct {
	URLs           []string
	LoopbackTicket string
	ExpiresAt      time.Time
}

// BuildLoginLinks mints one single-use ticket per address and formats the URL
// for it. The loopback ticket is the one printed as "Ticket:" and embedded in
// the IP selector URL: it belongs to the machine the banner is printed on.
func BuildLoginLinks(protocol string, host string, port int, tier config.TicketTier) (LoginLinks, error) {
	ips := AddressesForHost(host)
	tickets, err := config.NewAuthTickets(tier, len(ips))
	if err != nil {
		return LoginLinks{}, err
	}
	values := make([]string, len(tickets))
	for i, ticket := range tickets {
		values[i] = ticket.Value
	}

	loopback := values[0]
	for i, ip := range ips {
		if ip == "127.0.0.1" || ip == "::1" {
			loopback = values[i]
			break
		}
	}

	return LoginLinks{
		URLs:           BuildConnectionURLsForTickets(protocol, ips, port, values),
		LoopbackTicket: loopback,
		ExpiresAt:      tickets[0].ExpiresAt,
	}, nil
}

// PrintUrls prints the listening address, the loopback login URL and every
// address the server is reachable on. Each line carries its own ticket because
// the addresses are alternatives, not aliases for one credential.
func PrintUrls(protocol string, host string, port int, loopbackTicket string, urls []string) {
	localhost := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)
	if loopbackTicket != "" {
		localhost += "?ticket=" + loopbackTicket
	}
	fmt.Printf("Listening on: %s:%d\n%s\n", host, port, localhost)
	if len(urls) > 0 {
		fmt.Printf("Available on:\n%s\n", strings.Join(urls, "\n"))
	}
}
