// Package sevenzip runs the system 7-Zip binary. The program is probed like
// ffmpeg: a hit is cached for the life of the process, a miss for one minute,
// so installing 7-Zip does not require a restart.
package sevenzip

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const probeMissTTL = 60 * time.Second

// infoTimeout bounds `7z i` during probe. Format discovery is not on the
// request path after the first success.
const infoTimeout = 10 * time.Second

type probeState struct {
	mu         sync.Mutex
	resolved   string
	extractExt []string
	compress   []CompressFormat
	ok         bool
	checkedAt  time.Time
}

var probed probeState

// Binary returns the 7-Zip executable path.
func Binary() (string, bool) {
	path, _, ok := ensure()
	return path, ok
}

// Available reports whether archive actions can run.
func Available() bool {
	_, ok := Binary()
	return ok
}

// ExtractExtensions is every extension `7z i` lists, including containers such
// as xlsx. Empty when 7-Zip itself is missing.
func ExtractExtensions() []string {
	_, exts, ok := ensure()
	if !ok {
		return nil
	}
	out := make([]string, len(exts))
	copy(out, exts)
	return out
}

func ensure() (string, []string, bool) {
	probed.mu.Lock()
	if probed.ok {
		path, exts := probed.resolved, probed.extractExt
		probed.mu.Unlock()
		return path, exts, true
	}
	if !probed.checkedAt.IsZero() && time.Since(probed.checkedAt) < probeMissTTL {
		probed.mu.Unlock()
		return "", nil, false
	}
	probed.mu.Unlock()

	path, info, ok := locate()

	probed.mu.Lock()
	defer probed.mu.Unlock()
	// Another caller may have cached a hit while we were probing.
	if probed.ok {
		return probed.resolved, probed.extractExt, true
	}
	probed.checkedAt = time.Now()
	if !ok {
		probed.resolved = ""
		probed.extractExt = nil
		probed.compress = nil
		probed.ok = false
		return "", nil, false
	}
	probed.resolved = path
	probed.extractExt = info.Extract
	probed.compress = info.Compress
	probed.ok = true
	return path, info.Extract, true
}

// CompressFormats is the create-capable types reported by `7z i`.
func CompressFormats() []CompressFormat {
	ensure()
	probed.mu.Lock()
	defer probed.mu.Unlock()
	if !probed.ok {
		return nil
	}
	out := make([]CompressFormat, len(probed.compress))
	copy(out, probed.compress)
	return out
}

// ForceBinaryForTest caches a binary path without probing.
// Zip is registered so task tests can compress without parsing `7z i`.
func ForceBinaryForTest(path string) {
	exts := []string{".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz", ".xlsx"}
	compress := []CompressFormat{compressCatalog[0], compressCatalog[1]}
	probed.mu.Lock()
	probed.resolved = path
	probed.extractExt = exts
	probed.compress = compress
	probed.ok = path != ""
	probed.checkedAt = time.Now()
	probed.mu.Unlock()
}

func locate() (string, formatProbe, bool) {
	if path, err := exec.LookPath("7z"); err == nil {
		if info, ok := confirmBinary(path); ok {
			return path, info, true
		}
	}
	seen := map[string]struct{}{}
	for _, candidate := range extraCandidates() {
		if candidate == "" {
			continue
		}
		clean := filepath.Clean(candidate)
		if _, dup := seen[clean]; dup {
			continue
		}
		seen[clean] = struct{}{}
		st, err := os.Stat(clean)
		if err != nil || st.IsDir() {
			continue
		}
		if info, ok := confirmBinary(clean); ok {
			return clean, info, true
		}
	}
	return "", formatProbe{}, false
}

// confirmBinary runs `7z i` and keeps the extensions and create formats this
// build advertises. A binary that cannot answer is treated as missing.
func confirmBinary(path string) (formatProbe, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), infoTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "i")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		return formatProbe{}, false
	}
	info := parseFormatInfo(string(out))
	if len(info.Extract) == 0 {
		info.Extract = []string{".zip"}
	}
	if len(info.Compress) == 0 {
		info.Compress = []CompressFormat{compressCatalog[0]}
	}
	return info, true
}

// ResetProbeForTest clears the cached lookup.
func ResetProbeForTest() {
	probed.mu.Lock()
	probed.resolved = ""
	probed.extractExt = nil
	probed.compress = nil
	probed.ok = false
	probed.checkedAt = time.Time{}
	probed.mu.Unlock()
}

func hideWindow(cmd *exec.Cmd) {
	// Local wrapper so probe.go does not depend on the call shape of utils
	// changing; run.go uses utils.HideConsoleWindow directly.
	hideConsole(cmd)
}

// errorLine picks the reason out of 7-Zip's output. The copyright banner is
// not a reason: an encrypted archive with no password prints that banner and
// then "Enter password".
func errorLine(s string) string {
	var fallback string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" || isBannerLine(line) {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "error:") || strings.Contains(lower, "enter password") || strings.Contains(lower, "wrong password") {
			return clipLine(line)
		}
		if fallback == "" {
			fallback = line
		}
	}
	return clipLine(fallback)
}

func isBannerLine(line string) bool {
	lower := strings.ToLower(line)
	switch {
	case strings.HasPrefix(line, "7-Zip"):
		return true
	case strings.Contains(lower, "igor pavlov"):
		return true
	case strings.HasPrefix(lower, "64-bit locale"):
		return true
	case strings.HasPrefix(lower, "scanning the drive"):
		return true
	case strings.HasPrefix(lower, "extracting archive"):
		return true
	case strings.HasPrefix(lower, "listing archive"):
		return true
	case strings.HasPrefix(line, "Path ="):
		return true
	case strings.HasPrefix(line, "Type ="):
		return true
	case strings.HasPrefix(line, "Physical Size"):
		return true
	case strings.HasPrefix(lower, "break signaled"):
		return true
	case line == "--":
		return true
	default:
		return false
	}
}

func clipLine(line string) string {
	if len(line) > 300 {
		return line[:300]
	}
	return line
}
