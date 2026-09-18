//go:build windows

package utils

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"

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

// bitLockerLockedErrno 是「卷被 BitLocker 锁住」时 Win32 调用返回的错误码
// （STATUS_FVE_LOCKED_VOLUME = 0x80310000）。
//
// 它不是 Win32 错误码，syscall 里没有常量，只能写字面值。
// GetVolumeInformationW / GetDiskFreeSpaceExW / os.Stat / os.ReadDir 在这个卷上
// 都会返回它（见 utils 的 TestProbeBitLocker 实测）。
const bitLockerLockedErrno = syscall.Errno(0x80310000)

// isBitLockerLocked 判断一次 Win32 调用失败是不是因为卷被 BitLocker 锁住了。
func isBitLockerLocked(err error) bool {
	return err != nil && errors.Is(err, bitLockerLockedErrno)
}

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
		vr, _, vErr := procGetVolumeInformationW.Call(
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

		kind := driveKind(letter, path)
		// BitLocker 未解锁的卷：读不到卷标也读不到容量，两个调用都返回
		// STATUS_FVE_LOCKED_VOLUME。标成 locked，前端据此显示锁图标——
		// 否则它就是一个「有盘符、没容量、点进去报错」的普通本地盘，用户看不出原因。
		if vr == 0 && isBitLockerLocked(vErr) {
			kind = types.DriveKindLocked
			label = fmt.Sprintf("BitLocker (%s:)", letter)
		}

		// 映射的网络盘符容量来自服务器，拿得到就显示；拿不到就是空。
		// Path 用 canonical 形态（"C:"，无尾斜杠）——挂载表与前端都在这个形态上工作。
		letterOnly := letter + ":"
		list = append(list, types.Drive{
			Label: label,
			Path:  letterOnly,
			Kind:  kind,
			Free:  pFree,
			Total: pTotal,
		})
	}

	// 4. WSL 发行版：本机卷枚举不到它们，但用户完全可能想直接进 Debian。
	list = append(list, wslDistroDrives()...)

	// 5. 用户手动添加的网络位置（不是映射盘符，盘符枚举看不到）。
	list = append(list, networkLocationDrives()...)

	// 6. 排序：盘符在前 (C, D, E...)，网络位置（WSL、网络共享）在后。
	//
	// 不能只按 Path 排：`//wsl.localhost/...` 的 "/" (0x2F) 排在 "C" (0x43) 之前，
	// 于是 WSL 会挤在本地盘上面。分组排序让侧边栏先给"这台机器有什么盘"，
	// 再给"还有哪些网络位置"。
	sort.SliceStable(list, func(i, j int) bool {
		ni, nj := list[i].Kind == types.DriveKindNetwork, list[j].Kind == types.DriveKindNetwork
		if ni != nj {
			return !ni
		}
		return list[i].Path < list[j].Path
	})

	return list
}

// lxssRegistryPath 是 WSL 发行版的注册位置。
//
// 这里只读**注册表**，不调 `wsl.exe -l`：子进程会拉起 WSL 服务、有可见延迟，
// 而侧边栏加载不该等它。实测读这个键约 1ms。
const lxssRegistryPath = `Software\Microsoft\Windows\CurrentVersion\Lxss`

// wslDistroDrives 枚举已安装的 WSL 发行版，每个产出 `//wsl.localhost/<发行版>`。
//
// 为什么要列它们：`\\wsl.localhost\Debian` 早就可用，但没有任何地方告诉用户它存在——
// 用户得先知道 WSL 的 UNC 命名规则才会去地址栏输。列出来就把「藏起来的功能」变成了
// 侧边栏里可点的入口。
//
// 为什么这不算「网络发现」：读的是本机注册表，离线、毫秒级、不涉及凭据与网络往返，
// 与设计文档 §8.4 排除掉的「网络邻居枚举」（COM 外壳命名空间）完全是两回事。
//
// 得到的路径属于 `kind=network`：WSL 的 9p 共享要走网络栈，并发档位、错误映射、
// 图标都该按网络位置处理——这与 GetUnixMounts 把 Linux 下的 9p 标成 network 同源。
func wslDistroDrives() []types.Drive {
	k, err := registry.OpenKey(registry.CURRENT_USER, lxssRegistryPath, registry.READ)
	if err != nil {
		// 没装 WSL、或服务账户读不到 HKCU：静默返回空，这不是错误。
		return nil
	}
	defer k.Close()

	names, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return nil
	}

	out := make([]types.Drive, 0, len(names))
	seen := map[string]bool{}
	for _, sub := range names {
		sk, err := registry.OpenKey(k, sub, registry.READ)
		if err != nil {
			continue
		}
		distro, _, err := sk.GetStringValue("DistributionName")
		sk.Close()
		if err != nil || distro == "" || seen[distro] {
			continue
		}
		// 发行版名会进入路径，必须挡掉分隔符：注册表是可信来源，但路径规则
		// 不允许一个「段」里出现 `/` 或 `\`，宁可跳过也不构造畸形路径。
		if strings.ContainsAny(distro, `/\`) || distro == "." || distro == ".." {
			continue
		}
		seen[distro] = true
		out = append(out, types.Drive{
			Label: fmt.Sprintf("%s (WSL)", distro),
			// canonical 形态，无尾斜杠；挂载表与前端的解析都基于它。
			Path: "//wsl.localhost/" + distro,
			Kind: types.DriveKindNetwork,
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func GetUnixMounts() []types.Drive {
	return []types.Drive{{Label: "/", Path: "/", Kind: types.DriveKindVolume}}
}
