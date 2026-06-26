package utils

import (
	"fmt"
	"net"
	"os/exec"
	"runtime"
	"strings"
)

func formatHostForURL(ip string) string {
	if strings.Contains(ip, ":") {
		return "[" + ip + "]"
	}
	return ip
}

func GetAvailableIPs(host string) []string {
	if host != "0.0.0.0" {
		return nil
	}

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

func PrintUrls(protocol string, host string, port int, authParam string) []string {
	localhost := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)
	fmt.Printf("Listening on: %s:%d\n%s%s\n", host, port, localhost, func() string {
		if authParam == "" {
			return ""
		}
		return "?" + authParam
	}())

	ips := GetAvailableIPs(host)

	if len(ips) > 0 {
		authSuffix := func() string {
			if authParam == "" {
				return ""
			}
			return "?" + authParam
		}()

		fmt.Printf("Available on:\n%s//%s:%d%s\n", protocol, formatHostForURL(ips[0]), port, authSuffix)
		for i := 1; i < len(ips); i++ {
			fmt.Printf("%s//%s:%d%s\n", protocol, formatHostForURL(ips[i]), port, authSuffix)
		}
	}
	return ips
}

func Opener(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default: // "linux", "freebsd", "openbsd", "netbsd"
		cmd = "xdg-open"
		args = []string{url}
	}
	return exec.Command(cmd, args...).Start()
}
