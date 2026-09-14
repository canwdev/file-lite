//go:build !windows

package fileops

import (
	"errors"
	"syscall"
)

// crossDeviceErrno：rename(2) 跨文件系统时返回 EXDEV。
const crossDeviceErrno syscall.Errno = syscall.EXDEV

// isCrossDeviceError 见 crossdev_windows.go：只有「源和目标不在同一个卷上」
// 才允许回退到复制 + 删除。
func isCrossDeviceError(err error) bool {
	return errors.Is(err, crossDeviceErrno)
}
