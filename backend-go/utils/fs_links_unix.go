//go:build unix

package utils

import (
	"os"
	"syscall"
)

// HardLinkCount 返回路径条目的硬链接数（inode 上有多个名字时 >1）。
// 注意：目录的 nlink 会随子目录数量增多，调用方应自行排除目录。
func HardLinkCount(info os.FileInfo, _ string) uint64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Nlink)
	}
	return 1
}
