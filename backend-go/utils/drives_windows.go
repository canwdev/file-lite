//go:build windows

package utils

import (
	"fmt"
	"os"
	"sort"
	"syscall"
	"unsafe"

	"file-lite-go/types"
)

var (
	modkernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procGetDiskFreeSpaceExW     = modkernel32.NewProc("GetDiskFreeSpaceExW")
	procGetVolumeInformationW   = modkernel32.NewProc("GetVolumeInformationW")
	procGetLogicalDriveStringsW = modkernel32.NewProc("GetLogicalDriveStringsW")
	procGetDriveTypeW           = modkernel32.NewProc("GetDriveTypeW")
)

// GetDriveTypeW 的返回值（winbase.h）。
const driveRemote = 4

// driveKind 判断一个盘符该归类成什么。
//
// 两条判定路径缺一不可：
//   - GetDriveType 报 DRIVE_REMOTE：真正的映射网络驱动器；
//   - 盘符根是个指向 UNC 的链接：`mklink /D Z: \\server\share` 得到的目录链接，
//     GetDriveType 看到的是固定盘，只有解析链接才知道它要走网络。
//
// 第二类必须一起归类：它的并发档位会退化成 64，而它恰恰是最容易被打爆的位置。
func driveKind(letter, rootPath string) string {
	t, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(rootPath))))
	if int(t) == driveRemote {
		return types.DriveKindNetwork
	}
	if isUNCVolumeLink(letter) {
		return types.DriveKindNetwork
	}
	return types.DriveKindVolume
}

// isUNCVolumeLink 判断盘符根是否是指向 UNC 的符号链接 / 目录链接。
//
// 用 Go 的 Lstat + Readlink 而不是自己去解 reparse point：链接的判定与目标读取
// 在 os 包里已经处理了各种 reparse tag 的差异，自己解析反而更容易漏。
func isUNCVolumeLink(letter string) bool {
	root := letter + `:\`
	li, err := os.Lstat(root)
	if err != nil || li.Mode()&os.ModeSymlink == 0 {
		return false
	}
	target, err := os.Readlink(root)
	if err != nil {
		return false
	}
	return len(target) >= 2 && (target[0] == '\\' || target[0] == '/') && (target[1] == '\\' || target[1] == '/')
}

func GetWindowsDrives() []types.Drive {
	// 1. 获取所有盘符字符串 (返回类似 "C:\\0D:\\0")
	buf := make([]uint16, 254)
	r1, _, _ := procGetLogicalDriveStringsW.Call(uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])))
	if r1 == 0 {
		return []types.Drive{}
	}

	var list []types.Drive
	// 解析并切分连续的 null 结尾字符串
	for i := 0; i < int(r1); {
		if buf[i] == 0 {
			break
		}
		pathW := buf[i:]
		path := syscall.UTF16ToString(pathW) // 例如 "C:\"
		letter := path[:1]                   // 提取 "C"
		i += len(path) + 1

		// 2. 获取卷标 (FileSystemLabel)
		labelBuf := make([]uint16, 260)
		procGetVolumeInformationW.Call(
			uintptr(unsafe.Pointer(&syscall.StringToUTF16(path)[0])),
			uintptr(unsafe.Pointer(&labelBuf[0])), uintptr(len(labelBuf)),
			0, 0, 0, 0, 0,
		)
		labelName := syscall.UTF16ToString(labelBuf)
		if labelName == "" {
			labelName = "Local Disk"
		}
		label := fmt.Sprintf("%s (%s:)", labelName, letter)

		// 3. 获取容量信息
		// GetDiskFreeSpaceExW(lpDirectoryName, lpFreeBytesAvailableToCaller,
		//                     lpTotalNumberOfBytes, lpTotalNumberOfFreeBytes)
		var availBytes, totalBytes, freeBytes int64
		r2, _, _ := procGetDiskFreeSpaceExW.Call(
			uintptr(unsafe.Pointer(&syscall.StringToUTF16(path)[0])),
			uintptr(unsafe.Pointer(&availBytes)),
			uintptr(unsafe.Pointer(&totalBytes)),
			uintptr(unsafe.Pointer(&freeBytes)),
		)

		var pFree, pTotal *int64
		if r2 != 0 {
			pFree, pTotal = &availBytes, &totalBytes
		}

		// 映射的网络盘符容量来自服务器，拿得到就显示；拿不到就是空。
		// Path 用 canonical 形态（"C:"，无尾斜杠）——挂载表与前端都在这个形态上工作。
		letterOnly := letter + ":"
		list = append(list, types.Drive{
			Label: label,
			Path:  letterOnly,
			Kind:  driveKind(letter, path),
			Free:  pFree,
			Total: pTotal,
		})
	}

	// 4. 排序 (C, D, E...)
	sort.Slice(list, func(i, j int) bool {
		return list[i].Path < list[j].Path
	})

	return list
}

func GetUnixMounts() []types.Drive {
	return []types.Drive{{Label: "/", Path: "/", Kind: types.DriveKindVolume}}
}
