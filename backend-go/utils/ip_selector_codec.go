package utils

import (
	"encoding/base64"
	"fmt"
	"net"
	"strings"
)

const ipSelectorTicketLength = 8

type IpSelectorParams struct {
	IPs      []string
	Port     int
	Protocol string
	Ticket   string
}

func EncodeIpSelectorParams(data IpSelectorParams) (string, error) {
	var out []byte

	if data.Protocol == "https:" {
		out = append(out, 1)
	} else {
		out = append(out, 0)
	}

	out = append(out, byte(data.Port>>8), byte(data.Port&0xFF))

	ticket := data.Ticket
	if len(ticket) > ipSelectorTicketLength {
		ticket = ticket[:ipSelectorTicketLength]
	}
	out = append(out, []byte(fmt.Sprintf("%-*s", ipSelectorTicketLength, ticket))...)

	if len(data.IPs) > 255 {
		return "", fmt.Errorf("too many IPs")
	}
	out = append(out, byte(len(data.IPs)))

	for _, ip := range data.IPs {
		ip = strings.Split(ip, "%")[0]
		parsed := net.ParseIP(ip)
		if parsed == nil {
			return "", fmt.Errorf("invalid IP: %s", ip)
		}

		if strings.Contains(ip, ":") {
			out = append(out, 6)
			out = append(out, parsed.To16()...)
		} else {
			out = append(out, 4)
			out = append(out, parsed.To4()...)
		}
	}

	return base64URLEncode(out), nil
}

func base64URLEncode(data []byte) string {
	encoded := base64.StdEncoding.EncodeToString(data)
	encoded = strings.ReplaceAll(encoded, "+", "-")
	encoded = strings.ReplaceAll(encoded, "/", "_")
	return strings.TrimRight(encoded, "=")
}
