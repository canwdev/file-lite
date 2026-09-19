package fileops

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"file-lite-go/types"
)

// caseInsensitivePaths 表示本机文件系统的路径比较是否忽略大小写。
//
// 只在这一个地方判断，而且只影响访问控制的宽严，不影响路径本身的形态
// （canonical 永远原样保留大小写，见决策 8）。
var caseInsensitivePaths = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

// ErrPathOutsideRoots 表示路径形态合法，但不在任何一个允许的根之内。
//
// 它与另外两类错误必须分开：
//   - 形态错误（ErrPathNotAbsolute / ErrPathMalformed / ErrPathNeedsShare）是 400，
//     说的是「这条路径本身不合法」；
//   - 这条是**范围**问题，路径完全合法，只是服务端只开放了一部分给你。调用方应当
//     映射成 403 而不是 404——装成「不存在」会让用户永远找不到原因。
var ErrPathOutsideRoots = errors.New("path is outside the configured allowed roots")

// allowedRoots 保存「文件访问范围」的允许根（canonical 形态，已去重、已折叠冗余项）。
//
// 名字里的 root 不是「文件系统根」，而是**一棵可导航树的边界**——与 Mount.Root
// 同一个意思（盘符根、UNC 根、某个目录都算）。这正是这些条目扮演的角色。
//
// 与挂载表一样是**启动时写一次、之后只读**的配置，所以用 RWMutex 而不是原子值：
// 读路径不能互相阻塞。空切片表示不限制——这是默认值，也是绝大多数部署的取值。
var allowedRoots = struct {
	sync.RWMutex
	paths []string
}{}

// SetAllowedRoots 设置文件访问范围的允许根；空切片表示不限制。
//
// 由启动路径调用一次（见 main.go 的 applyAllowedRoots）。之所以要求目录**必须存在**：
// 一个拼错的根会让所有请求变成 403，而用户完全不知道发生了什么；启动时直接
// 失败，错误里带着那条路径，一眼就能改对。
//
// 多条是**并集**语义：落在任意一条之内都放行。嵌套的（`/srv` 与 `/srv/files`）
// 会被折叠成外层那一条——内层不会让任何新路径变得可访问，留着只会让侧边栏出现重复项。
//
// 关于符号链接：这里**不解析**它（与决策 10 一致，见 vfs-abstraction-design.md）。
// 由此产生的取舍是——如果某个根自己是个软链（`/srv/files -> /mnt/pool/files`），
// 那么 /mnt/pool/files 不算在范围内，通过软链的那条路径才是。这是明确的、
// 可解释的行为；反过来若在这里解析，就会引入「根必须先存在」之外的另一层
// 启动期依赖，而根**内部**的软链无论哪种做法都挡不住（要挡得住得解析每一次
// 请求的路径，那既有 TOCTOU 窗口、又会让不存在的路径无法判断）。
func SetAllowedRoots(dirs []string) error {
	canonical := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		// 空串与空白项当作「没写」，直接跳过：配置里留一个 "" 不该变成
		// 「整条规则失效」，也不该报错。
		if strings.TrimSpace(dir) == "" {
			continue
		}
		c, err := CanonicalizePath(dir)
		if err != nil {
			return fmt.Errorf("allowedRoots %q: %w", dir, err)
		}
		st, err := os.Stat(filepath.FromSlash(c))
		if err != nil {
			return fmt.Errorf("allowedRoots %q is not accessible: %w", c, err)
		}
		if !st.IsDir() {
			return fmt.Errorf("allowedRoots %q is not a directory", c)
		}
		canonical = append(canonical, c)
	}
	setAllowedRootsFrom(canonical)
	return nil
}

// ClearAllowedRoots 清空允许根（回到「不限制」）。给测试用。
func ClearAllowedRoots() { setAllowedRootsFrom(nil) }

func setAllowedRootsFrom(paths []string) {
	allowedRoots.Lock()
	allowedRoots.paths = dedupeRoots(paths)
	allowedRoots.Unlock()
}

// AllowedRoots 返回当前的允许根（canonical 形态）；空切片表示不限制。
//
// 返回的是副本：调用方拿到之后不会因为后续 SetAllowedRoots 而看到半新半旧的内容。
func AllowedRoots() []string {
	allowedRoots.RLock()
	defer allowedRoots.RUnlock()
	out := make([]string, len(allowedRoots.paths))
	copy(out, allowedRoots.paths)
	return out
}

// dedupeRoots 去掉重复项与被别的根包含的项。
//
// `/srv` 已经放行 `/srv/files` 下的一切，所以后者是冗余的。折叠之后侧边栏也不会
// 出现「同一个位置列两次」。比较用范围判定的同一套折叠规则（见 foldForComparison），
// 否则 Windows 上 `C:/a` 与 `c:/a` 会被当成两条。
func dedupeRoots(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		covered := false
		for _, kept := range out {
			if IsWithinRoot(foldForComparison(p), foldForComparison(kept)) {
				covered = true
				break
			}
		}
		if covered {
			continue
		}
		// 新来的这条也可能覆盖掉之前留下的项（配置顺序无关）。
		kept := out[:0]
		for _, existing := range out {
			if !IsWithinRoot(foldForComparison(existing), foldForComparison(p)) {
				kept = append(kept, existing)
			}
		}
		out = append(kept, p)
	}
	return out
}

// TopLevelAllowedRoots 返回不与任何其他允许根重叠的那些根。
//
// 用于「把配置的位置本身当作侧边栏的根」：即便配置里既写了 `/srv` 又写了
// `/srv/files`（dedupeRoots 已折叠），这里也只会列一次。
func TopLevelAllowedRoots() []string {
	paths := AllowedRoots()
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		covered := false
		for _, other := range paths {
			if other == p {
				continue
			}
			if IsWithinRoot(foldForComparison(p), foldForComparison(other)) {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, p)
		}
	}
	return out
}

// IsWithinRoots 判断 canonical 路径是否落在给定的某个根之内（含根自身）。
//
// 交给它之前不用先折叠大小写：它自己按范围比较的规则折（见 foldForComparison）。
// 空 roots 返回 false——「没有根」不等于「哪里都在范围内」，那个语义由调用方判断
// （见 allowedPath：空 = 不限制）。
func IsWithinRoots(canonical string, roots []string) bool {
	if canonical == "" || len(roots) == 0 {
		return false
	}
	folded := foldForComparison(canonical)
	for _, root := range roots {
		if IsWithinRoot(folded, foldForComparison(root)) {
			return true
		}
	}
	return false
}

// InDrives 判断某个盘符根是否**恰好**就是枚举结果里的某一项。
//
// 用于「这个位置是不是已经列出来了」这类判断：必须是相等，不能是前缀包含
// （`D:` 覆盖 `D:/a/b`，但两者不是同一个位置）。比较按范围判定的折叠规则，
// 所以 Windows 上 `C:/a` 与 `c:/a` 视为同一个。
func InDrives(drives []types.Drive, path string) bool {
	folded := foldForComparison(path)
	for _, d := range drives {
		if foldForComparison(d.Path) == folded {
			return true
		}
	}
	return false
}

// allowedPath 判断 canonical 路径是否在文件访问范围之内。
//
// 不限制时**直接返回 true**：这是默认路径，不该因为新增了检查就多出一次比较。
//
// 判定复用 IsWithinRoot 的比较键，因为那几件事它已经处理对了：
//   - **段边界**：根 /srv/files 不得匹配 /srv/files2——裸 strings.HasPrefix
//     会把同级目录放进来；
//   - **盘符与 UNC 主机名大小写不敏感**（C: 与 c: 是同一个卷）；
//   - UNC 是独立命名空间，不参与 Unix 根的前缀匹配。
//
// 还要按平台决定路径部分是否折叠大小写，见 foldForComparison。注意这**与挂载点匹配
// （LongestMount）不同**，是有意的：挂载点匹配错一次只是「属于哪个卷」判断错
// （并发档位、错误映射），而这里判错的后果是**把一个合法路径挡在门外**——
// Windows 上用户完全可能用 `C:/Users/Me` 去访问根 `C:/Users/me`，
// 那不是越权，是同一个目录。
func allowedPath(canonical string) bool {
	roots := AllowedRoots()
	if len(roots) == 0 {
		return true
	}
	return IsWithinRoots(canonical, roots)
}

// foldForComparison 把路径折成「用于范围比较」的形态。
//
// 它做的是**比较键**（ComparisonKey）那件事，再加一层按平台的大小写折叠。
// 为什么必须自己做一遍比较键：判定走的是 IsWithinRoot，而它是拿**原样字符串**
// 比对的；真正读比较键的是挂载表内部的 isWithinRootKey。两者不能混用——
// 不折的话 `c:/Users` 与根 `C:/Users` 会被判成不同位置。
//
// 折叠必须止步于**命名空间**，命名空间自己的规则不能动：
//   - UNC 共享名保持大小写敏感（不同 SMB 服务器行为不一致，误判为同一个会操作错
//     位置，见 ComparisonKey 的注释）；
//   - 盘符统一成大写（c: 与 C: 是同一个卷）；
//   - 主机名统一成小写（SMB 主机名不区分大小写）。
//
// 大小写折叠只在大小写不敏感的平台（Windows / macOS）上做：Linux 上 `/Data` 与
// `/data` 是两个目录，折叠会把根 `/data` 之外的东西放进来。
func foldForComparison(p string) string {
	host, share, rest := splitNamespace(p)
	if host != "" {
		host = strings.ToLower(host)
	}
	if caseInsensitivePaths {
		rest = strings.ToLower(rest)
	}
	return host + share + rest
}

// splitNamespace 把路径切成「命名空间」「共享名」「其余部分」。
//
// 只把比较键同样特殊对待的两类根摘出来，其余（Unix 根、Home 等）整条都算「其余」：
//
//	//host/share/docs → ("//host", "/share", "/docs")
//	C:/Users/me      → ("C:", "", "/Users/me")
//	/srv/files       → ("", "", "/srv/files")
//
// 盘符用比较键相同的判据（第二位是 ":"），不额外校验字母：`1:/x` 这类畸形输入
// 交给 canonical 化去拒，这里只负责把盘符段摘出来。
//
// UNC 只给到主机名（`//host`）时不拆分：它本来就是非法路径，比较键对它的判定同样保守。
func splitNamespace(p string) (host, share, rest string) {
	if strings.HasPrefix(p, "//") {
		parts := strings.SplitN(strings.Trim(p, "/"), "/", 3)
		if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
			host = "//" + parts[0]
			share = "/" + parts[1]
			if len(parts) == 3 {
				rest = "/" + parts[2]
			}
			return host, share, rest
		}
		return p, "", ""
	}
	if len(p) >= 2 && p[1] == ':' {
		return strings.ToUpper(p[:2]), "", p[2:]
	}
	return "", "", p
}
