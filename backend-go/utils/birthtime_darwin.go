//go:build darwin

package utils

import (
	"os"
	"syscall"
	"time"
)

// BirthTime 返回条目的创建时间，单位毫秒。macOS 由 Stat_t.Birthtimespec 提供；
// 文件系统没有记录创建时间时 ok 为 false。
func BirthTime(_ string, info os.FileInfo) (int64, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Birthtimespec.Sec == 0 {
		return 0, false
	}
	return time.Unix(st.Birthtimespec.Sec, st.Birthtimespec.Nsec).UnixMilli(), true
}
