package fileops

import (
	"path/filepath"
	"strings"
	"sync"

	"file-lite-go/types"
)

// 挂载点是路径解析的边界：一个可导航的根（盘符、UNC 共享、Home…）。
//
// 设计依据见 docs/design/vfs-abstraction-design.md §3、§5.2。两条规则：
//
//  1. 最长前缀 + **段边界**匹配。"/data2" 不得匹配挂载点 "/data"，
//     "//server/share2" 不得匹配 "//server/share"。
//  2. 挂载点是路径解析的依据，**不是访问控制**。safeBaseDir 已删除，
//     解析不到任何挂载点的绝对路径仍然可用（见 Resolve）。
type Mount struct {
	// Root 是 canonical 形式且无尾斜杠："/"、"C:"、"//server/share"、"/home/me"。
	Root string
	// Label 是界面显示名（侧边栏用）。
	Label string
	// Kind 见 types.DriveKind*。
	Kind string
}

// IsRoot 判断 p 是否正好是该挂载点的根。
func (m Mount) IsRoot(p string) bool {
	return ComparisonKey(p) == ComparisonKey(m.Root)
}

var mountTable = struct {
	sync.RWMutex
	mounts []Mount
}{}

// SetMounts 用枚举结果重建挂载表。
//
// 由传输层在启动时调用一次；重复调用是安全的（整体替换）。挂载表只在启动时写、
// 之后被每次解析读，所以用 RWMutex：读路径不阻塞彼此，也不需要为解析加任何锁竞争。
func SetMounts(drives []types.Drive) {
	setMountsFrom(mountsFromDrives(drives))
}

// ClearMounts 清空挂载表。给「挂载表为空时仍要能解析本地路径」这类测试用。
func ClearMounts() { setMountsFrom(nil) }

// setMountsFrom 直接替换挂载表内容，供测试构造部分挂载表使用。
func setMountsFrom(mounts []Mount) {
	mountTable.Lock()
	mountTable.mounts = mounts
	mountTable.Unlock()
}

func mountsFromDrives(drives []types.Drive) []Mount {
	mounts := make([]Mount, 0, len(drives))
	seen := map[string]bool{}
	for _, d := range drives {
		m, ok := mountFromDrive(d)
		if !ok || seen[ComparisonKey(m.Root)] {
			continue
		}
		seen[ComparisonKey(m.Root)] = true
		mounts = append(mounts, m)
	}
	return mounts
}

// GetMounts 返回当前挂载表的副本。
func GetMounts() []Mount {
	mountTable.RLock()
	defer mountTable.RUnlock()
	out := make([]Mount, len(mountTable.mounts))
	copy(out, mountTable.mounts)
	return out
}

// mountFromDrive 把枚举出来的 Drive 归一化成挂载点。
//
// 枚举结果来自与本机平台绑定的代码（/proc/mounts、盘符…），可能带尾斜杠、
// 也可能是空路径，所以这里统一收敛成 canonical 形式；归一化失败的条目直接跳过。
//
// **注意**：挂载点不必是语法意义上的根。Linux 上 "/mnt/dev-drive" 就是普通路径，
// 但它确实是一个挂载点——边界由挂载表决定，不由路径语法决定。因此这里只要求
// 「是合法的绝对路径」，不要求「看起来像根」。
func mountFromDrive(d types.Drive) (Mount, bool) {
	if d.Path == "" {
		return Mount{}, false
	}
	root, err := CanonicalizePath(d.Path)
	if err != nil {
		return Mount{}, false
	}
	// 统一去掉尾斜杠，"/" 例外（它本身就是 "/"）。
	trimmed := strings.TrimSuffix(root, "/")
	if trimmed == "" {
		trimmed = "/"
	}
	kind := d.Kind
	if kind == "" {
		kind = types.DriveKindVolume
	}
	return Mount{Root: trimmed, Label: d.Label, Kind: kind}, true
}

// LongestMount 返回挂载表里匹配 p 的最长前缀挂载点。
//
// 纯函数、不读全局表，便于单测；匹配按段边界，且比较时用 ComparisonKey
// （盘符大小写无关、UNC 主机名大小写无关），但返回的 Mount.Root 保持原样大小写。
func LongestMount(p string, mounts []Mount) (Mount, bool) {
	var best Mount
	found := false
	key := ComparisonKey(p)
	for _, m := range mounts {
		if !isWithinRootKey(key, ComparisonKey(m.Root)) {
			continue
		}
		if !found || len(m.Root) > len(best.Root) {
			best, found = m, true
		}
	}
	return best, found
}

// isWithinRootKey 与 IsWithinRoot 同义，但接收的是已经算好的比较键。
// 键里可能带被小写化的主机名，所以不能直接复用 IsWithinRoot。
func isWithinRootKey(key, rootKey string) bool {
	if key == rootKey {
		return true
	}
	// UNC 的根自带 "//" 前导。根为 "/" 时，下面拼出来的前缀就是 "//"，
	// 于是 "//server/share" 会被判成落在 "/" 之内——它确实落在 Unix 根之下，
	// 但那不是我们要的答案：UNC 是**独立**的命名空间，必须优先匹配到 UNC 自己的根
	// （哪怕那个根还没被枚举进挂载表）。所以带 "//" 的路径不参与 "/" 的前缀匹配。
	if strings.HasPrefix(rootKey, "/") && !strings.HasPrefix(rootKey, "//") && strings.HasPrefix(key, "//") {
		return false
	}
	r := rootKey
	if !strings.HasSuffix(r, "/") {
		r += "/"
	}
	return strings.HasPrefix(key, r)
}

// Resolved 是一次路径解析的结果。
type Resolved struct {
	// Path 是归一化后的 canonical 路径（os.* 调用前用 filepath.FromSlash 转换）。
	Path string
	// Mount 是所属挂载点；路径不在任何已枚举挂载点之内时为 nil。
	Mount *Mount
}

// ViaMount 表示这条路径属于一个已知挂载点（而不是「未匹配到挂载点的本地路径」）。
func (r Resolved) ViaMount() bool { return r.Mount != nil }

// OSPath 返回可以直接交给 os.* / filepath.* 的本机路径。
//
// Path 是 canonical 形式（恒用 "/"），而 Windows 的 os 调用只认 "\"——两者之间必须
// 有一次显式转换，且只能是这一处。调用方不要自己对 canonical 路径用 filepath.Join：
// 那会在 Windows 上把这个分隔符约定重新混起来。
func (r Resolved) OSPath() string { return filepath.FromSlash(r.Path) }

// Network 判断这条路径应当按网络位置对待。
//
// 两个来源缺一不可：
//   - 挂载点的 Kind：/mnt/c（WSL 的 9p 共享）、映射的网络盘符 Z: 形态上都像本机卷，
//     只有挂载表知道它们要走网络；
//   - 路径形态：UNC（//server/share）在挂载表为空时也得按网络处理——
//     挂载点没匹配上不代表它在本地。
func (r Resolved) Network() bool {
	if r.Mount != nil {
		return r.Mount.Kind == types.DriveKindNetwork
	}
	return NetworkPath(r.Path)
}

// 列表加载时每个条目的 stat 并发档位。
//
// 本机卷可以放心开大；网络位置必须收敛——1000 个文件按 64 并发就是上千次网络往返，
// 而每次往返都有 RTT，结果是把一台 NAS 打到超时。
const (
	concurrencyLocalVolume   = 64
	concurrencyNetworkVolume = 6
)

// ReadDirConcurrency 返回这条路径应当使用的 stat 并发档位。
func (r Resolved) ReadDirConcurrency() int {
	if r.Network() {
		return concurrencyNetworkVolume
	}
	return concurrencyLocalVolume
}

// NetworkPath 判断路径形态上属于网络位置。
//
// 这里的依据只有形态（UNC = 以 "//" 开头）。WSL 的 "/mnt/c" 这类挂载点看形态是普通
// 绝对路径，要知道它其实是网络位置得靠挂载点的 Kind——两者不要混在一起判断。
func NetworkPath(p string) bool {
	return strings.HasPrefix(p, "//")
}

// IsNetworkTarget 判断一条路径是否位于网络位置。
//
// 给 fileops 的写入路径用（`PublishFile` 的 NetworkTarget）：挂载表只认 canonical
// 路径，而复制循环手里是 os 路径（Windows 上带反斜杠）。两种形态都接受——反斜杠
// 统一折成 "/"，否则 Windows 的 `\\server\share\...` 会被形态兜底漏掉，
// 于是写出一个「同一条共享在 Windows 上算本机卷」的差异。
//
// 与 Resolved.Network 同源、判断也一致：先看所属挂载点的 Kind，形态上的 UNC 兜底
// （挂载表为空时 UNC 也得算网络）。
func IsNetworkTarget(p string) bool {
	if p == "" {
		return false
	}
	canonical := strings.ReplaceAll(p, `\`, "/")
	if m, ok := LongestMount(canonical, GetMounts()); ok {
		return m.Kind == types.DriveKindNetwork
	}
	return NetworkPath(canonical)
}

// Resolve 把一条 VFS 路径解析为「canonical 路径 + 所属挂载点」。
//
// 它是所有文件操作的统一入口，取代了原来的 fileops.IsPathSafe：
//
//   - 路径先 canonical 化，所以调用方不必自己拼/清路径，也不该再用 filepath 处理它；
//   - 挂载点用于导航边界与运行时特征（并发档位、错误映射），**不做访问控制**；
//   - **解析不到挂载点的绝对路径照样通过**。Linux 上只有 / 被枚举时这是常态，
//     而用户完全可能直接导航到 /srv/foo 这种没有单独挂载的目录。
//
// 返回错误目前只有「不是合法绝对路径」一种，错误码由调用方映射成 400。
func Resolve(p string) (Resolved, error) {
	canonical, err := CanonicalizePath(p)
	if err != nil {
		return Resolved{}, err
	}
	res := Resolved{Path: canonical}
	if m, ok := LongestMount(canonical, GetMounts()); ok {
		res.Mount = &m
	}
	return res, nil
}

// SamePath 判断两条 canonical 路径是否指向同一个位置。
//
// 用 ComparisonKey 比较，因此盘符大小写（C: 与 c:）与 UNC 主机名大小写不敏感——
// 这与 Windows 的语义一致，也是「原地粘贴」判定需要的：把 X 粘贴回它自己所在的目录时，
// 目标路径就是源路径，不能按普通冲突处理（「用自己替换自己」没有意义）。
//
// 不解析符号链接：同一个目标的两个不同路径仍会被判为不同。这是有意的——
// 把符号链接当成同一个位置会让「原地粘贴」在多出一步链接时静默变成覆盖。
func SamePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return ComparisonKey(a) == ComparisonKey(b)
}

// BaseName 返回路径的最后一段。
//
// 用 path 语义而不是 filepath：canonical 路径全链路只用 "/"，
// 而 filepath.Base 在非 Windows 上会把 "C:\x" 当成一个整体、把 "//server/share" 也切错。
//
// 同时容忍 "\"（本机路径）：文件操作层有相当一部分入参来自 os.ReadDir / 任务结果，
// 在 Windows 上带反斜杠。只认一种分隔符的话，那些调用点会得到一个「整条路径」的名字。
func BaseName(p string) string {
	p = strings.TrimRight(p, `/\`)
	if p == "" {
		return "/"
	}
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// DirName 返回 canonical 路径的父目录。
//
// 这是一个**词法**操作：它不知道挂载边界，所以 "/mnt/dev-drive" → "/" 是它给出的
// 答案，而界面上「到挂载点根就不能再往上」应当由挂载表决定（见 LongestMount）。
// 只有路径**语法**意义上的根才是自己的父目录："/"、"C:/"、"//host/share"。
func DirName(p string) string {
	if p == "/" {
		return "/"
	}
	trimmed := strings.TrimSuffix(p, "/")
	// 根是自己的父目录。"C:" 与 "C:/" 都归一化成 "C:"（canonical 的盘符根写法）。
	if isSyntacticRoot(trimmed) {
		return trimmed
	}
	i := strings.LastIndexByte(trimmed, '/')
	if i < 0 {
		return trimmed
	}
	if i == 0 {
		return "/"
	}
	parent := trimmed[:i]
	// 父目录是卷根时必须自带斜杠。canonical 只给 POSIX 根补尾斜杠，盘符根不带，
	// 所以这里按形态回填："D:/a.txt" → "D:/"；UNC 共享根本来就不带，保持原样。
	if isSyntacticRoot(parent) && !strings.HasPrefix(parent, "//") {
		root, _, err := splitRoot(parent)
		if err == nil {
			return root
		}
	}
	return parent
}

// isSyntacticRoot 判断路径是否已经是**语法根**："/"、"C:/"、"//host/share"。
//
// 要求根之后什么都没有，所以 "C:"（驱动器相对路径）与 "D:/a.txt" 都不是根。
// 只比较 splitRoot 拼出来的根是不够的：它把 "D:/a.txt" 的根也拼成 "D:/"，
// 而 ComparisonKey 会去掉尾斜杠，于是盘符下的任何路径都会被误判成盘符根。
func isSyntacticRoot(p string) bool {
	if p == "" {
		return false
	}
	root, rel, err := splitRoot(p)
	if err != nil {
		return false
	}
	if rel != "" {
		return false
	}
	canonicalRoot := strings.TrimSuffix(root, "/")
	if canonicalRoot == "" {
		canonicalRoot = "/"
	}
	// 盘符大小写无关（c:/ 与 C:/ 是同一个卷）；UNC 主机名也按 ComparisonKey 处理。
	return ComparisonKey(p) == ComparisonKey(canonicalRoot)
}
