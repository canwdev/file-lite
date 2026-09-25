//go:build !windows

package utils

import (
	"os/exec"
	"runtime"
)

// Opener opens a URL or path with the system default handler. Neither open nor
// xdg-open goes through a shell, so the target is passed as a single argument.
func Opener(target string) error {
	cmd := "xdg-open"
	if runtime.GOOS == "darwin" {
		cmd = "open"
	}
	return exec.Command(cmd, target).Start()
}
