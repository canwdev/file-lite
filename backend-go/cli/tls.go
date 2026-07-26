package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	tlsKeyFile  = "key.pem"
	tlsCertFile = "cert.pem"
)

// EnsureSelfSignedTLS runs system openssl (no probe). Skips if both files exist.
func EnsureSelfSignedTLS(dataDir string) (key, cert string, generated bool, err error) {
	keyPath := filepath.Join(dataDir, tlsKeyFile)
	certPath := filepath.Join(dataDir, tlsCertFile)

	if _, err1 := os.Stat(keyPath); err1 == nil {
		if _, err2 := os.Stat(certPath); err2 == nil {
			return tlsKeyFile, tlsCertFile, false, nil
		}
	}

	cmd := exec.Command("openssl",
		"req", "-x509", "-newkey", "rsa:2048", "-nodes",
		"-keyout", keyPath,
		"-out", certPath,
		"-days", "365",
		"-subj", "/CN=file-lite",
		"-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
	)
	out, runErr := cmd.CombinedOutput()
	if runErr != nil {
		return "", "", false, fmt.Errorf("openssl failed (install openssl and ensure it is in PATH)\n%s", string(out))
	}
	return tlsKeyFile, tlsCertFile, true, nil
}
