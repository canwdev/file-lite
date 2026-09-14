//go:build !windows

package utils

import (
	"os/exec"
	"testing"
)

// 非 Windows 上必须是空操作，也不能干扰命令本身的执行。
func TestHideConsoleWindowIsNoop(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no sh on this machine")
	}

	cmd := exec.Command(sh, "-c", "printf ok")
	HideConsoleWindow(cmd)

	if cmd.SysProcAttr != nil {
		t.Fatalf("SysProcAttr must stay nil on this platform: %+v", cmd.SysProcAttr)
	}
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("command failed after HideConsoleWindow: %v", err)
	}
	if string(out) != "ok" {
		t.Fatalf("unexpected output %q", out)
	}
}
