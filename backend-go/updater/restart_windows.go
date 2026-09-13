//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"file-lite-go/config"
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
	// 父进程一退出，继承来的控制台 / 管道就没了。新进程的输出写进日志文件，
	// 出问题时还能看；打不开就退化成丢弃，至少让服务先起来。
	logFile, err := openUpdateLog()
	if err != nil {
		logFile, err = os.OpenFile(os.DevNull, os.O_WRONLY, 0)
		if err != nil {
			return err
		}
	}
	defer logFile.Close()
	cmd.Stdout, cmd.Stderr = logFile, logFile
	cmd.Stdin = nil

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", exePath, err)
	}
	return nil
}

// openUpdateLog 把新进程的输出落到数据目录，方便排查「更新之后没起来」。
func openUpdateLog() (*os.File, error) {
	dir := config.DataBaseDir()
	if dir == "" {
		return nil, fmt.Errorf("data directory is unknown")
	}
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	return os.OpenFile(filepath.Join(dir, "update.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
}
