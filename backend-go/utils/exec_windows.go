//go:build windows

package utils

import (
	"os/exec"
	"syscall"
)

// createNoWindow 是 CreateProcess 的 CREATE_NO_WINDOW：不为子进程分配控制台。
const createNoWindow = 0x08000000

// HideConsoleWindow keeps an external command from flashing a console window on
// Windows.
//
// A process that has a console (started from a terminal, or restarted into a
// new console window) lends it to its children, so nothing flashes. A detached
// process has none, and Windows would create one for every console child that
// inherits them — extracting a video cover, opening the browser, running
// --version. CREATE_NO_WINDOW gives the child no console at all; HideWindow is
// a second layer (the window is created and then hidden, so it alone would
// flash for a frame).
//
// This only affects the window, not stdout / stderr pipes set by the caller.
func HideConsoleWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
	cmd.SysProcAttr.HideWindow = true
}
