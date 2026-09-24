//go:build windows

package sevenzip

import (
	"os"
	"path/filepath"
)

// extraCandidates covers the default 7-Zip installer locations. The installer
// does not add itself to PATH, unlike a typical ffmpeg layout.
func extraCandidates() []string {
	var out []string
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		root := os.Getenv(env)
		if root == "" {
			continue
		}
		out = append(out, filepath.Join(root, "7-Zip", "7z.exe"))
	}
	out = append(out,
		`C:\Program Files\7-Zip\7z.exe`,
		`C:\Program Files (x86)\7-Zip\7z.exe`,
	)
	return out
}
