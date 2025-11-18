package utils

import (
    "fmt"
    "net"
)

func PrintUrls(protocol string, host string, port int, authParam string) {
    localhost := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)
    fmt.Printf("Listening on: %s:%d\n%s%s\n", host, port, localhost, func() string { if authParam=="" { return "" } ; return "?"+authParam }())
    if host == "0.0.0.0" {
        addrs, _ := net.InterfaceAddrs()
        var urls []string
        for _, a := range addrs {
            if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
                urls = append(urls, fmt.Sprintf("%s//%s:%d%s", protocol, ipnet.IP.String(), port, func() string { if authParam=="" { return "" } ; return "?"+authParam }()))
            }
        }
        if len(urls) > 0 {
            fmt.Printf("Available on:\n%s\n", fmt.Sprintf("%s", urls[0]))
            for i:=1;i<len(urls);i++{ fmt.Println(urls[i]) }
        }
    }
}