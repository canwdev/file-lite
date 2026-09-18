//go:build !windows && !linux

package utils

import (
	"bufio"
	"os"
	"strings"

	"file-lite-go/types"
)

func GetWindowsDrives() []types.Drive {
	return []types.Drive{}
}

// GetUnixMounts 是 Linux 之外的 Unix（macOS / BSD / Solaris）的降级实现。
//
// 这里不枚举挂载表：/proc/mounts 是 Linux 专有的，而这些平台的挂载来源各不相同
// （macOS 要走 getfsstat、Solaris 走 mnttab）。宁可直接给出根，也不猜一个可能不准的列表。
//
// Linux 的完整实现（过滤伪文件系统 + statfs 容量）见 drives_linux.go。
func GetUnixMounts() []types.Drive {
	drives := []types.Drive{{Label: "/", Path: "/", Kind: types.DriveKindVolume}}

	// 有些平台把挂载表放在 /etc/mtab；读得到就用，读不到只给根。
	f, err := os.Open("/etc/mtab")
	if err != nil {
		return drives
	}
	defer f.Close()

	seen := map[string]bool{"/": true}
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) < 3 || !strings.HasPrefix(parts[1], "/") || seen[parts[1]] {
			continue
		}
		seen[parts[1]] = true
		drives = append(drives, types.Drive{Label: parts[1], Path: parts[1], Kind: types.DriveKindVolume})
	}
	return drives
}
