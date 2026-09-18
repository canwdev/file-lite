//go:build windows

package utils

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf16"

	"file-lite-go/types"
)

// 本文件读 Windows「此电脑」里用户手动添加的网络位置
// （资源管理器 → 右键「添加一个网络位置」/ 映射前的那个入口）。
//
// 它们**不是映射盘符**，所以 GetLogicalDriveStringsW 完全看不到，`HKCU\Network`
// 也是空的。实际形态是每个位置一个 shell 文件夹：//
//	%APPDATA%\Microsoft\Windows\Network Shortcuts\<显示名>\
//	    desktop.ini   CLSID2={0AFACED1-E828-11D1-9187-B532F1E9575D}
//	    target.lnk    指向 \\host\share 的快捷方式
//
// 所以：读目录 → 认 CLSID → 从 target.lnk 里取出 UNC 目标。
//
// **绝不做可达性预检**。实测（本机，2026-09）：可达共享 `stat` 约 11ms，
// 共享不存在约 29ms，而**主机不可达要 1.3–2.5 秒**。枚举时逐个 stat 会让侧边栏
// 加载卡住好几秒——这正是设计文档 §8.4 要求避免的事。拿不准就交给路径本身：
// 点进去会得到一个可读的错误（503）。
const networkShortcutCLSID = "{0AFACED1-E828-11D1-9187-B532F1E9575D}"

// networkLocationDrives 枚举用户手动添加的网络位置。
func networkLocationDrives() []types.Drive {
	root := networkShortcutsDir()
	if root == "" {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		// 没有这个目录（或服务账户读不到）：不是错误。
		return nil
	}

	out := make([]types.Drive, 0, len(entries))
	seen := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		if !isNetworkShortcut(dir) {
			// 这个目录下只该有网络位置，但桌面偶尔会放别的东西；
			// CLSID 对不上就当普通目录跳过，绝不猜。
			continue
		}
		target := readShortcutTarget(filepath.Join(dir, "target.lnk"))
		if target == "" {
			continue
		}
		if seen[target] {
			continue
		}
		seen[target] = true

		out = append(out, types.Drive{
			Label: networkLocationLabel(e.Name(), target),
			Path:  target,
			Kind:  types.DriveKindNetwork,
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// networkShortcutsDir 返回当前用户网络位置的目录；拿不到时返回空串。
//
// 用 os.UserConfigDir() 而不是读 APPDATA 环境变量：前者是 Go 里取
// `%APPDATA%` 的标准方式，也能在变量缺失时给出正确答案。
func networkShortcutsDir() string {
	cfg, err := os.UserConfigDir()
	if err != nil || cfg == "" {
		return ""
	}
	return filepath.Join(cfg, "Microsoft", "Windows", "Network Shortcuts")
}

// isNetworkShortcut 判断目录是不是一个「网络位置」shell 文件夹。
//
// 判据是 desktop.ini 里的 CLSID2。没有它就不是这类条目——那就不该按网络位置
// 处理（宁可漏掉，也不要把用户放在这里的普通目录当成共享）。
func isNetworkShortcut(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "desktop.ini"))
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToUpper(string(b)), networkShortcutCLSID)
}

// readShortcutTarget 从 target.lnk 里取出 UNC 目标，转成 canonical 形态。
//
// 不去实现完整的 MS-SHLLINK 解析：这条链路只需要一个 `\\host\share` 字符串，
// 而该文件里它出现在 LinkInfo 的 UTF-16 段（权威、保留原始大小写）。
// 扫不到就返回空串让调用方跳过——宁可少一个侧边栏入口，也不要猜出一个错路径。
func readShortcutTarget(lnkPath string) string {
	raw, err := os.ReadFile(lnkPath)
	if err != nil {
		return ""
	}
	// 先认一下标准 .lnk 头（4C 00 00 00）：形态不对就说明这不是我们理解的格式。
	if len(raw) < 4 || raw[0] != 0x4C || raw[1] != 0x00 {
		return ""
	}

	unc := firstUNCText(raw)
	if unc == "" {
		return ""
	}
	// `\\host\share` → canonical `//host/share`（无尾斜杠）。
	// 内部的分隔符也必须换掉：canonical 规则全链路只用 "/"，
	// 留一个 "\" 会让挂载点匹配与前端的面包屑都切错。
	body := strings.ReplaceAll(strings.Trim(unc, `/\`), `\`, "/")
	if body == "" {
		return ""
	}
	return "//" + body
}

// firstUNCText 在文件字节里找第一个 UNC 路径。
//
// 只按 UTF-16LE 解码一次：如果文件里存在 ANSI 段，把它按 UTF-16 解出来会得到
// 带 \x00 的乱码，而 `\\`（0x5C 0x5C）在 UTF-16 解里要求后一字节是 0x5C——
// ANSI 段满足不了这个条件，所以不会误命中。
func firstUNCText(raw []byte) string {
	n := len(raw) / 2
	if n == 0 {
		return ""
	}
	u := make([]uint16, n)
	for i := 0; i < n; i++ {
		u[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8
	}
	s := string(utf16.Decode(u))

	for i := 0; i+1 < len(s); i++ {
		if s[i] != '\\' || s[i+1] != '\\' {
			continue
		}
		end := i
		for end < len(s) && s[end] >= 0x20 && s[end] < 0x7F {
			end++
		}
		candidate := s[i:end]
		// 至少要 `\\host\share`：两段非空，且不含空白（主机名里不可能有空格）
		parts := strings.Split(strings.Trim(candidate, `\`), `\`)
		if len(parts) >= 2 && parts[0] != "" && parts[1] != "" && !strings.ContainsAny(candidate, " \t") {
			return strings.TrimRight(candidate, `\`)
		}
	}
	return ""
}

// networkLocationLabel 给侧边栏一个可读名字。
//
// 目录名就是资源管理器里显示的那个（如 "shared (DESKTOP-ROGZ16)"），优先用它；
// 它在某些语言/版本下可能是空的或就是个路径，所以再退回从目标算一个。
func networkLocationLabel(dirName, target string) string {
	name := strings.TrimSpace(dirName)
	if name != "" && name != target {
		return name
	}
	parts := strings.Split(strings.Trim(target, "/"), "/")
	if len(parts) >= 2 {
		return parts[len(parts)-1] + " (" + parts[0] + ")"
	}
	return target
}
