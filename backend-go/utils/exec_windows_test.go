//go:build windows

package utils

import (
	"os/exec"
	"syscall"
	"testing"
)

func TestHideConsoleWindow(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "echo", "hi")
	HideConsoleWindow(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr must be set")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CREATE_NO_WINDOW missing: flags = %#x", cmd.SysProcAttr.CreationFlags)
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow must be set")
	}
}

// 调用方可能已经设过自己的创建标志（updater 的分离重启就是这样），不能覆盖掉。
func TestHideConsoleWindowKeepsCallerFlags(t *testing.T) {
	const createNewProcessGroup = 0x00000200
	cmd := exec.Command("cmd")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}

	HideConsoleWindow(cmd)

	if cmd.SysProcAttr.CreationFlags&createNewProcessGroup == 0 {
		t.Fatalf("caller flags lost: %#x", cmd.SysProcAttr.CreationFlags)
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("CREATE_NO_WINDOW missing: %#x", cmd.SysProcAttr.CreationFlags)
	}
}
