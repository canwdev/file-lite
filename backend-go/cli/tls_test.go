package cli

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func hasDNS(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

func hasIP(ips []net.IP, want string) bool {
	wantIP := net.ParseIP(want)
	for _, ip := range ips {
		if ip.Equal(wantIP) {
			return true
		}
	}
	return false
}

func hasHost(hosts []string, want string) bool {
	for _, h := range hosts {
		if h == want {
			return true
		}
	}
	return false
}

func TestBuildSANIncludesLocalIPs(t *testing.T) {
	dns, ips, err := buildSAN(nil)
	if err != nil {
		t.Fatalf("buildSAN: %v", err)
	}
	if !hasDNS(dns, "localhost") {
		t.Errorf("localhost missing from DNS names: %v", dns)
	}
	if !hasIP(ips, "127.0.0.1") || !hasIP(ips, "::1") {
		t.Errorf("loopback missing from IPs: %v", ips)
	}
	for _, ip := range ips {
		if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			t.Errorf("link-local address leaked into SAN: %v", ip)
		}
	}
}

func TestBuildSANExtraHostsSkipLocalScan(t *testing.T) {
	dns, ips, err := buildSAN([]string{"Example.COM.", "192.168.1.10", "[::1]", "*.app.local"})
	if err != nil {
		t.Fatalf("buildSAN: %v", err)
	}
	for _, want := range []string{"localhost", "example.com", "*.app.local"} {
		if !hasDNS(dns, want) {
			t.Errorf("DNS name %q missing: %v", want, dns)
		}
	}
	for _, want := range []string{"127.0.0.1", "::1", "192.168.1.10"} {
		if !hasIP(ips, want) {
			t.Errorf("IP %q missing: %v", want, ips)
		}
	}
	// 显式指定 host 时不再扫描本机网卡，IP 只应有两个回环 + 一个显式 IP
	if len(ips) != 3 {
		t.Errorf("explicit hosts must skip the local IP scan, got %d IPs: %v", len(ips), ips)
	}
}

func TestBuildSANDeduplicates(t *testing.T) {
	dns, ips, err := buildSAN([]string{"localhost", "LOCALHOST", "127.0.0.1"})
	if err != nil {
		t.Fatalf("buildSAN: %v", err)
	}
	dnsCount, ipCount := 0, 0
	for _, n := range dns {
		if n == "localhost" {
			dnsCount++
		}
	}
	for _, ip := range ips {
		if ip.Equal(net.IPv4(127, 0, 0, 1)) {
			ipCount++
		}
	}
	if dnsCount != 1 {
		t.Errorf("localhost should appear once, got %d (%v)", dnsCount, dns)
	}
	if ipCount != 1 {
		t.Errorf("127.0.0.1 should appear once, got %d (%v)", ipCount, ips)
	}
}

func TestBuildSANRejectsInvalidHosts(t *testing.T) {
	for _, host := range []string{"", "example.com:3100", "https://example.com", "0.0.0.0", "a b"} {
		if _, _, err := buildSAN([]string{host}); err == nil {
			t.Errorf("expected error for --tls-host %q", host)
		}
	}
}

func TestEnsureSelfSignedTLS(t *testing.T) {
	dir := t.TempDir()
	res, err := EnsureSelfSignedTLS(dir, []string{"example.com", "192.168.1.10"})
	if err != nil {
		t.Fatalf("EnsureSelfSignedTLS: %v", err)
	}
	if !res.Generated {
		t.Fatal("expected a freshly generated certificate")
	}

	if _, err := tls.LoadX509KeyPair(filepath.Join(dir, res.Cert), filepath.Join(dir, res.Key)); err != nil {
		t.Fatalf("generated pair does not load: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, res.Cert))
	if err != nil {
		t.Fatalf("read cert: %v", err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		t.Fatal("cert is not valid PEM")
	}
	parsed, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("parse cert: %v", err)
	}
	for _, host := range []string{"localhost", "example.com", "127.0.0.1", "192.168.1.10"} {
		if err := parsed.VerifyHostname(host); err != nil {
			t.Errorf("VerifyHostname(%q) failed: %v", host, err)
		}
	}

	hosts := res.Hosts()
	for _, want := range []string{"localhost", "example.com", "127.0.0.1", "192.168.1.10"} {
		if !hasHost(hosts, want) {
			t.Errorf("TLSResult.Hosts() missing %q: %v", want, hosts)
		}
	}
	if res.Subject != "CN=file-lite" {
		t.Errorf("subject = %q, want CN=file-lite", res.Subject)
	}
	if res.PublicKey != "RSA 2048-bit" {
		t.Errorf("public key = %q, want RSA 2048-bit", res.PublicKey)
	}
	if res.SignatureAlg == "" || res.SerialNumber == "" || res.SHA256 == "" {
		t.Errorf("incomplete metadata: sig=%q serial=%q sha256=%q", res.SignatureAlg, res.SerialNumber, res.SHA256)
	}
	if !res.NotAfter.After(res.NotBefore) {
		t.Errorf("invalid validity: %v ~ %v", res.NotBefore, res.NotAfter)
	}

	// 已存在时复用，但仍要能报出证书覆盖的 host 与元数据
	reused, err := EnsureSelfSignedTLS(dir, nil)
	if err != nil {
		t.Fatalf("EnsureSelfSignedTLS (second): %v", err)
	}
	if reused.Generated {
		t.Error("expected existing certificate to be reused")
	}
	if !hasHost(reused.Hosts(), "example.com") {
		t.Errorf("reused cert hosts missing example.com: %v", reused.Hosts())
	}
	if reused.Subject == "" || reused.SHA256 == "" {
		t.Errorf("reused cert metadata not parsed: %+v", reused)
	}
}

func TestTLSResultMissingHosts(t *testing.T) {
	dir := t.TempDir()
	res, err := EnsureSelfSignedTLS(dir, []string{"example.com", "192.168.1.10"})
	if err != nil {
		t.Fatalf("EnsureSelfSignedTLS: %v", err)
	}

	missing := res.MissingHosts([]string{"Example.COM", "192.168.1.10", "other.local", "10.0.0.9"})
	want := map[string]bool{"other.local": true, "10.0.0.9": true}
	if len(missing) != len(want) {
		t.Fatalf("missing = %v, want %v", missing, want)
	}
	for _, m := range missing {
		if !want[m] {
			t.Errorf("unexpected missing host %q", m)
		}
	}
}
