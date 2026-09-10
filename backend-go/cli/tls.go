package cli

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"file-lite-go/utils"
)

const (
	tlsKeyFile  = "key.pem"
	tlsCertFile = "cert.pem"

	tlsCommonName     = "file-lite"
	tlsValidityDays   = 365
	tlsRSAKeyBits     = 2048
	tlsSerialNumberHi = 128
)

// TLSResult describes the certificate EnsureSelfSignedTLS produced or reused.
type TLSResult struct {
	Key       string
	Cert      string
	Generated bool

	DNSNames []string
	IPs      []net.IP

	Subject      string
	PublicKey    string
	SignatureAlg string
	SerialNumber string
	NotBefore    time.Time
	NotAfter     time.Time
	SHA256       string
}

// Hosts returns every DNS name and IP that the certificate SAN covers.
func (r TLSResult) Hosts() []string {
	hosts := make([]string, 0, len(r.DNSNames)+len(r.IPs))
	hosts = append(hosts, r.DNSNames...)
	for _, ip := range r.IPs {
		hosts = append(hosts, ip.String())
	}
	return hosts
}

// MissingHosts reports which of the requested extra hosts the certificate does
// not cover yet (only relevant when an existing certificate is reused).
func (r TLSResult) MissingHosts(extraHosts []string) []string {
	var missing []string
	for _, raw := range extraHosts {
		name, ip, err := parseTLSHost(raw)
		if err != nil {
			missing = append(missing, raw)
			continue
		}
		if ip != nil {
			found := false
			for _, have := range r.IPs {
				if have.Equal(ip) {
					found = true
					break
				}
			}
			if !found {
				missing = append(missing, raw)
			}
			continue
		}
		found := false
		for _, have := range r.DNSNames {
			if strings.EqualFold(have, name) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, raw)
		}
	}
	return missing
}

// EnsureSelfSignedTLS generates a self-signed certificate in dataDir using only
// the Go standard library (no external openssl). localhost and the loopback
// addresses are always in the SAN; detected local IPs are added only when no
// extraHosts are given, so an explicit --tls-host fully controls the SAN. It
// skips generation when both key.pem and cert.pem already exist.
func EnsureSelfSignedTLS(dataDir string, extraHosts []string) (TLSResult, error) {
	keyPath := filepath.Join(dataDir, tlsKeyFile)
	certPath := filepath.Join(dataDir, tlsCertFile)

	if _, err1 := os.Stat(keyPath); err1 == nil {
		if _, err2 := os.Stat(certPath); err2 == nil {
			if cert, err := readCert(certPath); err == nil {
				return newTLSResult(tlsKeyFile, tlsCertFile, false, cert), nil
			}
			return TLSResult{Key: tlsKeyFile, Cert: tlsCertFile, Generated: false}, nil
		}
	}

	dnsNames, ipAddresses, err := buildSAN(extraHosts)
	if err != nil {
		return TLSResult{}, err
	}
	der, err := generateSelfSignedCert(keyPath, certPath, dnsNames, ipAddresses)
	if err != nil {
		return TLSResult{}, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return TLSResult{}, fmt.Errorf("parse generated certificate: %w", err)
	}
	return newTLSResult(tlsKeyFile, tlsCertFile, true, cert), nil
}

func newTLSResult(key, certFile string, generated bool, cert *x509.Certificate) TLSResult {
	return TLSResult{
		Key:          key,
		Cert:         certFile,
		Generated:    generated,
		DNSNames:     cert.DNSNames,
		IPs:          cert.IPAddresses,
		Subject:      cert.Subject.String(),
		PublicKey:    certPublicKey(cert),
		SignatureAlg: cert.SignatureAlgorithm.String(),
		SerialNumber: cert.SerialNumber.String(),
		NotBefore:    cert.NotBefore,
		NotAfter:     cert.NotAfter,
		SHA256:       certSHA256(cert),
	}
}

func generateSelfSignedCert(keyPath, certPath string, dnsNames []string, ipAddresses []net.IP) ([]byte, error) {
	priv, err := rsa.GenerateKey(rand.Reader, tlsRSAKeyBits)
	if err != nil {
		return nil, fmt.Errorf("generate rsa key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), tlsSerialNumberHi))
	if err != nil {
		return nil, fmt.Errorf("generate certificate serial number: %w", err)
	}

	now := time.Now()
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: tlsCommonName,
		},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.AddDate(0, 0, tlsValidityDays),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		DNSNames:              dnsNames,
		IPAddresses:           ipAddresses,
	}

	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		return nil, fmt.Errorf("create self-signed certificate: %w", err)
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("marshal private key: %w", err)
	}

	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return nil, fmt.Errorf("write key file %s: %w", keyPath, err)
	}
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return nil, fmt.Errorf("write cert file %s: %w", certPath, err)
	}
	return der, nil
}

func readCert(certPath string) (*x509.Certificate, error) {
	raw, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("no PEM block in %s", certPath)
	}
	return x509.ParseCertificate(block.Bytes)
}

func certPublicKey(cert *x509.Certificate) string {
	if key, ok := cert.PublicKey.(*rsa.PublicKey); ok {
		return fmt.Sprintf("RSA %d-bit", key.N.BitLen())
	}
	return cert.PublicKeyAlgorithm.String()
}

func certSHA256(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

// buildSAN returns the deduplicated DNS names and IP addresses for the cert.
// localhost and the loopback addresses are always present. When extraHosts is
// empty the machine's local IPs are detected and added; when the caller names
// hosts explicitly, detection is skipped so the SAN stays predictable.
func buildSAN(extraHosts []string) (dnsNames []string, ipAddresses []net.IP, err error) {
	dnsSeen := make(map[string]bool)
	ipSeen := make(map[string]bool)

	addDNS := func(name string) {
		name = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".")
		if name == "" || dnsSeen[name] {
			return
		}
		dnsSeen[name] = true
		dnsNames = append(dnsNames, name)
	}
	addIP := func(ip net.IP) {
		if ip == nil || ip.IsUnspecified() {
			return
		}
		key := ip.String()
		if ipSeen[key] {
			return
		}
		ipSeen[key] = true
		ipAddresses = append(ipAddresses, ip)
	}

	addDNS("localhost")
	addIP(net.IPv4(127, 0, 0, 1))
	addIP(net.IPv6loopback)

	if len(extraHosts) == 0 {
		for _, raw := range utils.GetInterfaceIPs() {
			ip := net.ParseIP(raw)
			// 链路本地地址无法直接用于访问，跳过以免污染 SAN
			if ip == nil || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}
			addIP(ip)
		}
	}

	for _, raw := range extraHosts {
		name, ip, err := parseTLSHost(raw)
		if err != nil {
			return nil, nil, err
		}
		if ip != nil {
			addIP(ip)
			continue
		}
		addDNS(name)
	}

	return dnsNames, ipAddresses, nil
}

// parseTLSHost classifies a --tls-host value as either an IP or a DNS name.
func parseTLSHost(raw string) (dnsName string, ip net.IP, err error) {
	host := strings.TrimSpace(raw)
	if host == "" {
		return "", nil, fmt.Errorf("invalid --tls-host: value is empty")
	}
	// 允许写 [::1] 这种带方括号的 IPv6
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = host[1 : len(host)-1]
	}
	if parsed := net.ParseIP(host); parsed != nil {
		if parsed.IsUnspecified() {
			return "", nil, fmt.Errorf("invalid --tls-host %q: unspecified address", raw)
		}
		return "", parsed, nil
	}
	if strings.ContainsAny(host, " :/\\") {
		return "", nil, fmt.Errorf("invalid --tls-host %q: pass a bare domain name or IP", raw)
	}
	return host, nil, nil
}
