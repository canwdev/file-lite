package utils

import (
	"fmt"
	"net"
	"strings"
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

// BuildConnectionURLs returns one access URL per local address, loopback
// included, optionally carrying a ticket. It is the single place that formats a
// host for a URL (IPv6 needs brackets), shared by the startup banner and the IP
// chooser API.
func BuildConnectionURLs(protocol string, host string, port int, ticket string) []string {
	ips := GetAvailableIPs(host)
	if len(ips) == 0 && host != "" && host != "0.0.0.0" && host != "::" {
		// Bound to one concrete address: GetAvailableIPs only enumerates
		// interfaces for the wildcard host, so fall back to that address.
		ips = []string{host}
	}

	suffix := ""
	if ticket != "" {
		suffix = "?ticket=" + ticket
	}

	urls := make([]string, 0, len(ips))
	for _, ip := range ips {
		urls = append(urls, fmt.Sprintf("%s//%s:%d%s", protocol, formatHostForURL(ip), port, suffix))
	}
	return urls
}

func PrintUrls(protocol string, host string, port int, authParam string) []string {
	localhost := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)
	fmt.Printf("Listening on: %s:%d\n%s%s\n", host, port, localhost, func() string {
		if authParam == "" {
			return ""
		}
		return "?" + authParam
	}())

	ips := GetAvailableIPs(host)
	urls := BuildConnectionURLs(protocol, host, port, strings.TrimPrefix(authParam, "ticket="))
	if len(urls) > 0 {
		fmt.Printf("Available on:\n%s\n", strings.Join(urls, "\n"))
	}
	return ips
}
