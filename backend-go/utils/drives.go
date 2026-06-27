package utils

import (
	"file-lite-go/types"
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sort"
	"syscall"
	"unsafe"
)

var (
	modkernel32             = syscall.NewLazyDLL("kernel32.dll")
	procGetDiskFreeSpaceExW = modkernel32.NewProc("GetDiskFreeSpaceExW")
	procGetVolumeInformationW = modkernel32.NewProc("GetVolumeInformationW")
	procGetLogicalDriveStringsW = modkernel32.NewProc("GetLogicalDriveStringsW")
)

func GetWindowsDrives() []types.Drive {
	if runtime.GOOS != "windows" {
		return []types.Drive{}
	}

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
		letter := path[:1]                  // 提取 "C"
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
		var freeBytes, totalBytes, availBytes int64
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

		list = append(list, types.Drive{Label: label, Path: path, Free: pFree, Total: pTotal})
	}

	// 4. 排序 (C, D, E...)
	sort.Slice(list, func(i, j int) bool {
		return list[i].Path < list[j].Path
	})

	return list
}

func GetUnixMounts() []string {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return []string{"/"}
	}
	defer f.Close()
	var mounts []string
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) >= 2 {
			m := parts[1]
			if strings.HasPrefix(m, "/") {
				mounts = append(mounts, m)
			}
		}
	}
	if len(mounts) == 0 {
		mounts = []string{"/"}
	}
	return mounts
}
