//go:build windows

package fileops

import (
	"errors"
	"syscall"

	"golang.org/x/sys/windows"
)

// crossDeviceErrno 是「rename 的源和目标不在同一个卷上」时系统返回的错误码。
//
// Windows 的 MoveFileEx 返回 ERROR_NOT_SAME_DEVICE(17)，而 syscall.EXDEV 在这
// 里只是 Go 杜撰出来的 errno（APPLICATION_ERROR+iota，值为 536871040），系统
// 永远不会返回它——只判 EXDEV 的话，跨盘移动会直接失败并上报
// "The system cannot move the file to a different disk drive"，
// 而不是回退到复制 + 删除。
const crossDeviceErrno syscall.Errno = windows.ERROR_NOT_SAME_DEVICE

// isCrossDeviceError 判断 rename 失败是否仅仅因为源和目标不在同一个卷上。
// 只有这种失败才可以安全地退化成「复制 + 删除源」：权限不足、文件被占用、
// 目标已存在之类的失败必须原样上报，否则会先把文件复制过去、再删不掉源。
func isCrossDeviceError(err error) bool {
	return errors.Is(err, crossDeviceErrno)
}
