package fileops

import (
	"errors"
	"strings"
)

// 本文件定义 VFS 路径的 canonical 规则。设计依据见
// docs/design/vfs-abstraction-design.md §4。
//
// 总则：VFS 路径只做字符串语义，不做文件系统语义。全链路只用 '/'，
// 内部只用 path / strings，绝不用 filepath 的 Join/Clean/Dir/Abs/Rel——
// 实测 filepath.Clean 会吃掉 scheme，path.Clean 会吃掉 UNC 前导 "//" 与根尾斜杠：
//
//	filepath.Clean("//server/share") = "/server/share"  (Linux 上塌掉)
//	path.Clean("//server/share/docs") = "/server/share/docs"
//	path.Clean("C:/")                = "C:"            (成了相对路径)
//
// 本文件目前只有纯函数与测试，尚未接入任何调用点（阶段 1：零行为变更）。

var (
	// ErrPathNotAbsolute 表示路径不是绝对路径（相对路径不参与 VFS 解析）。
	ErrPathNotAbsolute = errors.New("path is not absolute")
	// ErrPathMalformed 表示路径形态不合法（UNC 主机名/共享名缺失）。
	ErrPathMalformed = errors.New("path is malformed")
	// ErrPathEscapesRoot 表示折叠 "." / ".." 之后路径越出了所在根。
	ErrPathEscapesRoot = errors.New("path escapes its root")
)

// isASCIIAlpha 判断字节是否 ASCII 字母（盘符只允许 A-Z/a-z）。
func isASCIIAlpha(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// driveLetter 判断 "{盘符}:" 形态（大小写不限），返回盘符。
func driveLetter(p string) (letter string, ok bool) {
	if len(p) < 2 || p[1] != ':' || !isASCIIAlpha(p[0]) {
		return "", false
	}
	return string(p[0]), true
}

// isDotSegment 判断一段是否是 "." 或 ".."。
func isDotSegment(s string) bool {
	return s == "." || s == ".."
}

// splitRoot 把任意形态的路径切成「canonical 根」与「相对根的部分」。
//
// 识别三种根，且都在统一转成 '/' 之后进行：
//
//	//host/share/   UNC（也接受 /// 写法）
//	C:/            盘符（C: 与 C:/ 等价）
//	/              Unix
//
// 非绝对路径返回 ErrPathNotAbsolute；形态不完整的 UNC 返回 ErrPathMalformed。
func splitRoot(p string) (root, rel string, err error) {
	p = strings.ReplaceAll(p, `\`, "/")

	switch {
	case strings.HasPrefix(p, "//"):
		// 先把分隔符折叠成单个，再取前两段：否则 "//server//share//docs" 里
		// 空的共享名段会让根切分错位。
		body := strings.Trim(p, "/")
		for strings.Contains(body, "//") {
			body = strings.ReplaceAll(body, "//", "/")
		}
		parts := strings.SplitN(body, "/", 3)
		if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
			return "", "", ErrPathMalformed
		}
		// 主机名与共享名本身不允许是 "." / ".."
		if isDotSegment(parts[0]) || isDotSegment(parts[1]) {
			return "", "", ErrPathMalformed
		}
		if len(parts) == 3 {
			rel = parts[2]
		}
		return "//" + parts[0] + "/" + parts[1] + "/", rel, nil

	default:
		// 盘符形态要先于 Unix 判定：Windows 路径经归一化后是 "C:/Users"，不以 '/' 开头。
		// "C:Users" 没有分隔符：那是驱动器相对路径（进程当前目录在该盘上），
		// 语义依赖进程状态、无法确定，因此拒绝而不是猜成 "C:/Users"。
		if _, ok := driveLetter(p); ok {
			if len(p) > 2 && p[2] != '/' {
				return "", "", ErrPathNotAbsolute
			}
			return string(p[0]) + ":/", strings.TrimPrefix(p[2:], "/"), nil
		}
		if !strings.HasPrefix(p, "/") {
			return "", "", ErrPathNotAbsolute
		}
		return "/", strings.TrimPrefix(p, "/"), nil
	}
}

// cleanSegments 折叠重复分隔符与 "."、解析 ".."。
//
// rel 是相对根的部分（不以 '/' 开头）。任何试图越过根的 ".." 都返回
// ErrPathEscapesRoot——绝不静默吸收，否则 "/data/../../etc" 会被悄悄放行。
func cleanSegments(rel string) (string, error) {
	var out []string
	for _, seg := range strings.Split(rel, "/") {
		switch seg {
		case "", ".":
			// 重复分隔符与当前目录：丢弃
		case "..":
			if len(out) == 0 {
				return "", ErrPathEscapesRoot
			}
			out = out[:len(out)-1]
		default:
			out = append(out, seg)
		}
	}
	return strings.Join(out, "/"), nil
}

// CanonicalizePath 把用户/传输层的路径归一化为 canonical 形式。
//
//	\  → /            分隔符统一（地址栏恒用正斜杠；\ 只出现在用户粘贴的输入里）
//	重复分隔符折叠
//	. / .. 折叠        越过根即报错，不静默吸收
//	//host/share       UNC 前导 // 保留，且视为根
//	C:/               盘符根保留尾斜杠；非根去掉尾斜杠
//
// 不做的事（重要）：
//   - 不改大小写（盘符/主机名的规范化只用于比较键，见 ComparisonKey）
//   - 不做 Unicode 归一化（NFC/NFD 会改变文件名，在 ext4 上直接找不到文件）
//   - 不解析符号链接（是否跟随由后端的 Stat/Open 决定）
func CanonicalizePath(p string) (string, error) {
	root, rel, err := splitRoot(p)
	if err != nil {
		return "", err
	}
	cleaned, err := cleanSegments(rel)
	if err != nil {
		return "", err
	}
	if cleaned == "" {
		return root, nil
	}
	return root + cleaned, nil
}

// ComparisonKey 返回仅用于“是否同一个位置”判断的比较键。
//
// 键永不当作路径使用：返回给 OS、显示给用户、写回前端的一律用 original。
//
//	盘符        → 大写：c: 与 C: 是同一个卷
//	UNC 主机名  → 小写（SMB 主机名不区分大小写）
//	UNC 共享名  → 原样保留（不同 SMB 服务器对共享名大小写的行为不一致，
//	              按敏感处理更安全；误判为不同只会多问一次，误判为相同会操作错位置）
//	其余部分    → 原样保留
//
// 路径部分的大小写是否等价由后端的 Caps.CaseSensitive 决定，不能靠这里判断。
func ComparisonKey(original string) string {
	p := strings.ReplaceAll(original, `\`, "/")

	switch {
	case strings.HasPrefix(p, "//"):
		parts := strings.SplitN(strings.Trim(p, "/"), "/", 3)
		if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
			p = "//" + strings.ToLower(parts[0]) + "/" + parts[1]
			if len(parts) == 3 {
				p += "/" + parts[2]
			}
		}
	default:
		if letter, ok := driveLetter(p); ok {
			p = strings.ToUpper(letter) + p[1:]
		}
	}

	// 统一去掉尾斜杠，让 "C:" 与 "C:/"、"//s/share" 与 "//s/share/" 同键。
	for len(p) > 1 && strings.HasSuffix(p, "/") && !strings.HasSuffix(p, "//") {
		p = strings.TrimSuffix(p, "/")
	}
	return p
}

// IsWithinRoot 判断 canonical 路径 p 是否位于 canonical 根 root 之内（含 root 自身）。
//
// 必须是**段边界**匹配：裸 strings.HasPrefix 会把 "/data2" 判成在 "/data" 之内。
func IsWithinRoot(p, root string) bool {
	if p == "" || root == "" {
		return false
	}
	if p == root {
		return true
	}
	r := root
	if !strings.HasSuffix(r, "/") {
		r += "/"
	}
	return strings.HasPrefix(p, r)
}
