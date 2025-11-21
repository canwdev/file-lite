package utils

import (
	"fmt"
	"net"
	"os/exec"
	"runtime"
)

func GetAvailableIPs(host string) []string {
	var ips []string
	if host == "0.0.0.0" {
		addrs, _ := net.InterfaceAddrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
				ips = append(ips, ipnet.IP.String())
			}
		}
	}
	return ips
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

		fmt.Printf("Available on:\n%s//%s:%d%s\n", protocol, ips[0], port, authSuffix)
		for i := 1; i < len(ips); i++ {
			fmt.Printf("%s//%s:%d%s\n", protocol, ips[i], port, authSuffix)
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
