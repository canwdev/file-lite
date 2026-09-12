//go:build windows

package utils

import (
	"os"
	"syscall"
	"time"
)

// BirthTime 返回条目的创建时间，单位毫秒。Windows 由 Win32 文件属性给出。
func BirthTime(_ string, info os.FileInfo) (int64, bool) {
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	if !ok {
		return 0, false
	}
	return data.CreationTime.Nanoseconds() / int64(time.Millisecond), true
}
