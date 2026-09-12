//go:build linux

package utils

import (
	"os"
	"time"

	"golang.org/x/sys/unix"
)

// BirthTime 返回条目的创建（birth）时间，单位毫秒。
// Linux 上由 statx 的 STATX_BTIME 提供；内核或文件系统不支持时 ok 为 false，
// 调用方应回落到修改时间。
func BirthTime(path string, _ os.FileInfo) (int64, bool) {
	var stx unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, 0, unix.STATX_BTIME, &stx); err != nil {
		return 0, false
	}
	if stx.Mask&unix.STATX_BTIME == 0 {
		return 0, false
	}
	return time.Unix(stx.Btime.Sec, int64(stx.Btime.Nsec)).UnixMilli(), true
}
