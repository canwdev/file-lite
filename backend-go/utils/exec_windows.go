//go:build windows

package utils

import (
	"os/exec"
	"syscall"
)

// createNoWindow 是 CreateProcess 的 CREATE_NO_WINDOW：不为子进程分配控制台。
const createNoWindow = 0x08000000

// HideConsoleWindow 让外部命令在 Windows 上不弹控制台黑窗。
//
// 服务自己带控制台时（从终端启动）子进程会继承它，本来就看不见窗口；但自更新重启用的是
// DETACHED_PROCESS（见 updater/restart_windows.go），那之后进程没有控制台，Windows 就会
// 为每个控制台程序新建一个黑窗口——抽视频封面、打开浏览器、跑 --version 都会闪一下。
// CREATE_NO_WINDOW 干脆不给子进程分配控制台，HideWindow 再兜一层
// （窗口是建出来再隐藏，只设它会有一帧闪烁）。
//
// 只影响窗口，不影响调用方设置的 stdout / stderr 管道。
func HideConsoleWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
	cmd.SysProcAttr.HideWindow = true
}
