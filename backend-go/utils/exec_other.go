//go:build !windows

package utils

import "os/exec"

// HideConsoleWindow 在 Windows 之外是空操作：这些系统没有「子进程弹出控制台窗口」这回事。
func HideConsoleWindow(*exec.Cmd) {}
