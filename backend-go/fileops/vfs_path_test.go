package fileops

import (
	"errors"
	"testing"
)

// 本文件的用例与 docs/design/vfs-abstraction-design.md §4.2 的规则表一一对应。
// 规则表改了，这里必须同步改——它是 canonical 规则的唯一可执行契约。

func TestCanonicalizePath(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string // 期望的 canonical
		err  error  // 非 nil 表示应当报错
	}{
		// ---- 规则 1-3：盘符与分隔符 ----
		{"盘符反斜杠", `C:\Users\me\a.txt`, "C:/Users/me/a.txt", nil},
		{"重复分隔符", `C:\Users\\me\a.txt`, "C:/Users/me/a.txt", nil},
		{"根带尾斜杠", `C:\`, "C:/", nil},
		{"盘符加斜杠", `C:/`, "C:/", nil},
		{"非根去尾斜杠", `C:/Users/`, "C:/Users", nil},
		{"混合分隔符", `C:\Users/me\a.txt`, "C:/Users/me/a.txt", nil},
		{"正斜杠形态", `C:/Users/me/a.txt`, "C:/Users/me/a.txt", nil},

		// ---- 规则 4-6：UNC 与 WSL ----
		{"UNC 共享根", `\\server\share`, "//server/share/", nil},
		{"UNC 共享根带尾斜杠", `\\server\share\`, "//server/share/", nil},
		{"UNC 子路径", `\\server\share\docs\`, "//server/share/docs", nil},
		{"UNC 正斜杠形态", `//server/share/docs`, "//server/share/docs", nil},
		{"UNC 三斜杠", `///server/share/docs`, "//server/share/docs", nil},
		{"UNC 内部重复斜杠", `//server//share//docs`, "//server/share/docs", nil},
		// 4 段以上：SplitN(...,3) 会把余下部分留在第 3 段，必须整体保留，
		// 只取第 3 段会静默丢掉深层路径（前端副本曾因此出错）。
		{"UNC 深路径", `//server/share/a/b/c/d.txt`, "//server/share/a/b/c/d.txt", nil},
		{"UNC 深路径折叠", `//server/share/a/b/../c`, "//server/share/a/c", nil},
		{"WSL", `\\wsl.localhost\Debian\home\me`, "//wsl.localhost/Debian/home/me", nil},
		{"WSL 正斜杠", `//wsl.localhost/Debian/`, "//wsl.localhost/Debian/", nil},

		// ---- 规则 7-10：点段折叠与逃逸 ----
		{"根内折叠点点", `/home/me/../other`, "/home/other", nil},
		{"折叠当前目录", `/home/./me`, "/home/me", nil},
		{"UNC 根内折叠", `//server/share/docs/../x`, "//server/share/x", nil},
		{"盘符根内折叠", `C:\Users\me\..\other`, "C:/Users/other", nil},
		{"Unix 逃逸越根", `/data/../../etc`, "", ErrPathEscapesRoot},
		{"UNC 逃逸越根", `//server/share/../..`, "", ErrPathEscapesRoot},
		{"盘符逃逸越根", `C:\..\..\x`, "", ErrPathEscapesRoot},
		{"根自身是点点", `/..`, "", ErrPathEscapesRoot},

		// ---- 规则 11：ZIP 的将来形态（.zip 只是普通路径段）----
		{"ZIP 挂载形态", `D:/Downloads/temp.zip/temp/videos/`, "D:/Downloads/temp.zip/temp/videos", nil},
		{"ZIP 归档目录", `D:\Downloads\temp.zip`, "D:/Downloads/temp.zip", nil},

		// ---- 规则 12：大小写原样保留 ----
		{"盘符小写原样", `c:/Users`, "c:/Users", nil},
		{"UNC 大小写原样", `\\SERVER\Share\Docs`, "//SERVER/Share/Docs", nil},

		// ---- 规则 13：非绝对路径 ----
		{"相对路径", `foo`, "", ErrPathNotAbsolute},
		{"点开头相对路径", `./foo`, "", ErrPathNotAbsolute},
		{"空串", ``, "", ErrPathNotAbsolute},
		{"裸盘符即卷根", `C:`, "C:/", nil},
		{"盘符相对路径", `C:Users`, "", ErrPathNotAbsolute},

		// ---- 规则 14：解码之后的字面字符 ----
		{"特殊字符原样", `/data/a b#c?d%e+f.txt`, "/data/a b#c?d%e+f.txt", nil},

		// ---- 规则 15：Unix 上的反斜杠是合法文件名字符 ----
		{"Unix 反斜杠文件名", `/data/a\b.txt`, "/data/a/b.txt", nil},

		// ---- 规则 16：不做 Unicode 归一化 ----
		{"NFC 原样", "/data/é.txt", "/data/é.txt", nil},
		{"NFD 原样", "/data/e\u0301.txt", "/data/e\u0301.txt", nil},

		// ---- Unix 恒等 ----
		{"Unix 根", `/`, "/", nil},
		{"Unix 路径", `/home/me/a.txt`, "/home/me/a.txt", nil},
		{"Unix 去尾斜杠", `/home/me/`, "/home/me", nil},

		// ---- 畸形 UNC ----
		// 只给到主机名：最常见的误用（照着资源管理器输 \\wsl.localhost），
		// 给专门的错误，文案要能直接告诉用户该补什么。
		{"UNC 缺共享名", `\\server`, "", ErrPathNeedsShare},
		{"UNC 缺共享名带尾斜杠", `//wsl.localhost/`, "", ErrPathNeedsShare},
		{"UNC 空主机名", `\\\share`, "", ErrPathMalformed},
		{"UNC 点点主机", `\\.\share`, "", ErrPathMalformed},
		{"UNC 点点共享", `\\server\..`, "", ErrPathMalformed},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := CanonicalizePath(c.in)
			if c.err != nil {
				if !errors.Is(err, c.err) {
					t.Fatalf("CanonicalizePath(%q) 期望错误 %v，得到 err=%v got=%q", c.in, c.err, err, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("CanonicalizePath(%q) 意外报错: %v", c.in, err)
			}
			if got != c.want {
				t.Fatalf("CanonicalizePath(%q) = %q，期望 %q", c.in, got, c.want)
			}
		})
	}
}

// 规则 15 的说明：Unix 上反斜杠是合法文件名字符，但项目约定“地址栏恒用正斜杠”，
// 前端在所有平台都做 \ → / 归一化（含反斜杠的 Unix 文件名因此在 Web UI 中不可达，
// 见设计文档 §8.2）。本测试锁定该约定：后端会转换，而不是保留。
// 将来若要改成平台感知，必须同时改这里与设计文档。
func TestCanonicalizePath_BackslashFoldingIsIntentional(t *testing.T) {
	got, err := CanonicalizePath(`/data/a\b.txt`)
	if err != nil {
		t.Fatalf("意外报错: %v", err)
	}
	if got != "/data/a/b.txt" {
		t.Fatalf("期望反斜杠被折叠为分隔符，得到 %q", got)
	}
}

func TestCanonicalizePath_Idempotent(t *testing.T) {
	// canonical 形式必须是不动点：再 canon 一次结果不变。
	inputs := []string{
		`C:\Users\me\a.txt`,
		`\\server\share\docs`,
		`//wsl.localhost/Debian/home/me`,
		`/data/../data/x`,
		`D:/Downloads/temp.zip/temp/videos`,
		`c:/Users`,
		`/`,
		`C:\`,
	}
	for _, in := range inputs {
		once, err := CanonicalizePath(in)
		if err != nil {
			t.Fatalf("CanonicalizePath(%q) 报错: %v", in, err)
		}
		twice, err := CanonicalizePath(once)
		if err != nil {
			t.Fatalf("CanonicalizePath(%q) 二次报错: %v", once, err)
		}
		if once != twice {
			t.Fatalf("不幂等: %q → %q → %q", in, once, twice)
		}
	}
}

func TestComparisonKey(t *testing.T) {
	cases := []struct {
		name    string
		a, b    string
		sameKey bool
	}{
		// 盘符大小写等价（Windows 上 c: 与 C: 是同一个卷）
		{"盘符大小写", `c:/Users/me`, `C:/Users/me`, true},
		{"盘符根与带斜杠", `C:`, `C:/`, true},
		{"盘符根与子路径", `C:/Users`, `C:/Users/`, true},

		// UNC 主机名不区分大小写
		{"UNC 主机名大小写", `//SERVER/share/docs`, `//server/share/docs`, true},
		{"UNC 主机名与根尾斜杠", `//SERVER/share`, `//server/share/`, true},
		{"UNC 反斜杠形态", `\\SERVER\share\docs`, `//server/share/docs`, true},

		// UNC 共享名区分大小写（不同 SMB 服务器行为不一致，按敏感处理更安全）
		{"UNC 共享名大小写", `//server/SHARE/x`, `//server/share/x`, false},

		// 路径部分原样保留（是否等价由后端 Caps.CaseSensitive 决定）
		{"路径段大小写", `/data/Users`, `/data/users`, false},

		// 不同位置当然不同键
		{"不同主机", `//a/share`, `//b/share`, false},
		{"不同盘符", `C:/x`, `D:/x`, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ka, kb := ComparisonKey(c.a), ComparisonKey(c.b)
			if (ka == kb) != c.sameKey {
				t.Fatalf("ComparisonKey(%q)=%q, ComparisonKey(%q)=%q，期望同键=%v",
					c.a, ka, c.b, kb, c.sameKey)
			}
		})
	}
}

func TestIsWithinRoot(t *testing.T) {
	cases := []struct {
		name string
		p    string
		root string
		want bool
	}{
		{"自身", "/data", "/data", true},
		{"子路径", "/data/x", "/data", true},
		{"带尾斜杠的根", "/data/x", "/data/", true},
		{"段边界：不得匹配前缀", "/data2", "/data", false},
		{"段边界：不得匹配前缀子路径", "/data2/x", "/data", false},

		{"Unix 根下任意路径", "/home/me", "/", true},
		{"Unix 根自身", "/", "/", true},

		{"盘符根自身", "C:", "C:", true},
		{"盘符根带斜杠", "C:/", "C:", true},
		{"盘符子路径", "C:/Users/me", "C:", true},
		{"盘符段边界", "C:/Users2", "C:/Users", false},
		{"不同盘符", "D:/x", "C:", false},

		{"UNC 根自身", "//server/share/", "//server/share/", true},
		{"UNC 子路径", "//server/share/docs", "//server/share/", true},
		{"UNC 段边界", "//server/share2", "//server/share", false},
		{"不同共享", "//server/other/x", "//server/share", false},

		{"空路径", "", "/data", false},
		{"空根", "/data", "", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsWithinRoot(c.p, c.root); got != c.want {
				t.Fatalf("IsWithinRoot(%q, %q) = %v，期望 %v", c.p, c.root, got, c.want)
			}
		})
	}
}
