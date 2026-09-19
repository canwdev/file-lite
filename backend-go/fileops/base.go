package fileops

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// caseInsensitivePaths 表示本机文件系统的路径比较是否忽略大小写。
//
// 只在这一个地方判断，而且只影响访问控制的宽严，不影响路径本身的形态
// （canonical 永远原样保留大小写，见决策 8）。
var caseInsensitivePaths = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

// ErrPathOutsideBase 表示路径形态合法，但落在配置的基目录之外。
//
// 它与另外两类错误必须分开：
//   - 形态错误（ErrPathNotAbsolute / ErrPathMalformed / ErrPathNeedsShare）是 400，
//     说的是「这条路径本身不合法」；
//   - 这条是**范围**问题，路径完全合法，只是服务端只开放了一部分给你。调用方应当
//     映射成 403 而不是 404——装成「不存在」会让用户永远找不到原因。
var ErrPathOutsideBase = errors.New("path is outside the configured base directory")

// baseDir 保存「文件访问范围」的基目录（canonical 形态）。
//
// 与挂载表一样是**启动时写一次、之后只读**的配置，所以用 RWMutex 而不是原子值：
// 读路径不能互相阻塞。空串表示不限制——这是默认值，也是绝大多数部署的取值。
var baseDir = struct {
	sync.RWMutex
	canonical string
}{}

// SetBaseDir 设置文件访问范围的基目录；空串表示不限制。
//
// 由启动路径调用一次（见 routes.registerFiles）。之所以要求目录**必须存在**：
// 一个拼错的基目录会让所有请求变成 403，而用户完全不知道发生了什么；启动时直接
// 失败，错误里带着那条路径，一眼就能改对。
//
// 关于符号链接：这里**不解析**它（与决策 10 一致，见 vfs-abstraction-design.md）。
// 由此产生的取舍是——如果基目录自己是个软链（`/srv/files -> /mnt/pool/files`），
// 那么 /mnt/pool/files 不算在范围内，通过软链的那条路径才是。这是明确的、
// 可解释的行为；反过来若在这里解析，就会引入「基目录必须先存在」之外的另一层
// 启动期依赖，而基目录**内部**的软链无论哪种做法都挡不住（要挡得住得解析每一次
// 请求的路径，那既有 TOCTOU 窗口、又会让不存在的路径无法判断）。
func SetBaseDir(dir string) error {
	if dir == "" {
		setBaseDirFrom("")
		return nil
	}

	canonical, err := CanonicalizePath(dir)
	if err != nil {
		return fmt.Errorf("safeBaseDir %q: %w", dir, err)
	}

	st, err := os.Stat(filepath.FromSlash(canonical))
	if err != nil {
		return fmt.Errorf("safeBaseDir %q is not accessible: %w", canonical, err)
	}
	if !st.IsDir() {
		return fmt.Errorf("safeBaseDir %q is not a directory", canonical)
	}

	setBaseDirFrom(canonical)
	return nil
}

// ClearBaseDir 清空基目录（回到「不限制」）。给测试用。
func ClearBaseDir() { setBaseDirFrom("") }

func setBaseDirFrom(canonical string) {
	baseDir.Lock()
	baseDir.canonical = canonical
	baseDir.Unlock()
}

// BaseDir 返回当前基目录的 canonical 形态；空串表示不限制。
func BaseDir() string {
	baseDir.RLock()
	defer baseDir.RUnlock()
	return baseDir.canonical
}

// pathWithinBase 判断 canonical 路径是否在文件访问范围之内。
//
// 不限制时**直接返回 true**：这是默认路径，不该因为新增了检查就多出一次比较。
//
// 判定复用 IsWithinRoot 的比较键，因为那几件事它已经处理对了：
//   - **段边界**：基目录 /srv/files 不得匹配 /srv/files2——裸 strings.HasPrefix
//     会把同级目录放进来；
//   - **盘符与 UNC 主机名大小写不敏感**（C: 与 c: 是同一个卷）；
//   - UNC 是独立命名空间，不参与 Unix 根的前缀匹配。
//
// 还要按平台决定路径部分是否折叠大小写，见 foldForBase。注意这**与挂载点匹配
// （LongestMount）不同**，是有意的：挂载点匹配错一次只是「属于哪个卷」判断错
// （并发档位、错误映射），而这里判错的后果是**把一个合法路径挡在门外**——
// Windows 上用户完全可能用 `C:/Users/Me` 去访问基目录 `C:/Users/me`，
// 那不是越权，是同一个目录。
func pathWithinBase(canonical string) bool {
	base := BaseDir()
	if base == "" {
		return true
	}
	return IsWithinRoot(foldForBase(canonical), foldForBase(base))
}

// foldForBase 把路径折成「用于范围比较」的形态。
//
// 它做的是**比较键**（ComparisonKey）那件事，再加一层按平台的大小写折叠。
// 为什么必须自己做一遍比较键：判定走的是 IsWithinRoot，而它是拿**原样字符串**
// 比对的；真正读比较键的是挂载表内部的 isWithinRootKey。两者不能混用——
// 不折的话 `c:/Users` 与基目录 `C:/Users` 会被判成不同位置。
//
// 折叠必须止步于**命名空间**，命名空间自己的规则不能动：
//   - UNC 共享名保持大小写敏感（不同 SMB 服务器行为不一致，误判为同一个会操作错
//     位置，见 ComparisonKey 的注释）；
//   - 盘符统一成大写（c: 与 C: 是同一个卷）；
//   - 主机名统一成小写（SMB 主机名不区分大小写）。
//
// 大小写折叠只在大小写不敏感的平台（Windows / macOS）上做：Linux 上 `/Data` 与
// `/data` 是两个目录，折叠会把基目录 `/data` 之外的东西放进来。
func foldForBase(p string) string {
	host, share, rest := splitBaseNamespace(p)
	if host != "" {
		host = strings.ToLower(host)
	}
	if caseInsensitivePaths {
		rest = strings.ToLower(rest)
	}
	return host + share + rest
}

// splitBaseNamespace 把路径切成「命名空间」「共享名」「其余部分」。
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
func splitBaseNamespace(p string) (host, share, rest string) {
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
