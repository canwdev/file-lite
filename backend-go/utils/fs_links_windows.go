//go:build windows

package utils

import (
	"os"

	"golang.org/x/sys/windows"
)

// HardLinkCount 返回路径条目的硬链接数（NTFS 上由 NumberOfLinks 给出）。
// os.FileInfo 无法直接取得该值，故在 Windows 上需额外打开句柄查询。
// 注意：目录的 nlink 会随子目录数量增多，调用方应自行排除目录。
func HardLinkCount(_ os.FileInfo, path string) uint64 {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 1
	}
	h, err := windows.CreateFile(
		p,
		windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		return 1
	}
	defer windows.CloseHandle(h)

	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &info); err != nil {
		return 1
	}
	return uint64(info.NumberOfLinks)
}
