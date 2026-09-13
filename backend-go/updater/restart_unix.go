//go:build !windows

package updater

import (
	"fmt"
	"os"
	"syscall"
)

// restartProcess 用原来的 argv / 环境变量原地替换进程镜像。
//
// Unix 有真正的 exec：PID 不变、终端不变（TUI 能接着用），而且 Go 创建的监听 socket
// 都是 CLOEXEC，exec 的瞬间端口就释放了，新进程可以立刻 bind。成功时这个函数不返回。
func restartProcess() error {
	argv := exeArgs
	if len(argv) == 0 {
		argv = []string{exePath}
	}
	err := syscall.Exec(exePath, argv, os.Environ())
	return fmt.Errorf("exec %s: %w", exePath, err)
}
