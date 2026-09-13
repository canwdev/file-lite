//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

const (
	// DETACHED_PROCESS：新进程不继承父进程的控制台。
	detachedProcess = 0x00000008
	// CREATE_NEW_PROCESS_GROUP：父进程退出 / 收到 Ctrl+C 不会波及新进程。
	createNewProcessGroup = 0x00000200
)

// restartProcess 启动一个分离的新进程再让调用方退出：Windows 没有 exec，
// 不能原地替换进程镜像。
func restartProcess() error {
	args := exeArgs
	if len(args) > 0 {
		args = args[1:]
	}
	cmd := exec.Command(exePath, args...)
	// 数据目录默认是相对 cwd 的，工作目录换了就等于换了配置。
	cmd.Dir = exeCwd
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGroup,
		HideWindow:    true,
	}
	// 三个标准流都不设置：父进程一退出，继承来的控制台就没了，Go 会把它们接到空设备。
	// 这是开发功能，起不来时开发者自己上机器看，不留日志文件。
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", exePath, err)
	}
	return nil
}
