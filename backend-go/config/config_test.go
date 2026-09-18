package config

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNormalizeLogLevel(t *testing.T) {
	cases := map[string]string{
		"":          LogLevelWarn,
		"nonsense":  LogLevelWarn,
		"verbose":   LogLevelVerbose,
		" VERBOSE ": LogLevelVerbose,
		"warn":      LogLevelWarn,
		"error":     LogLevelError,
		"none":      LogLevelNone,
		"Warning":   LogLevelWarn,
	}
	for in, want := range cases {
		if got := normalizeLogLevel(in); got != want {
			t.Errorf("normalizeLogLevel(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestResolveStartPath 锁定「startPath 是服务进程所在文件系统的真实路径」这条语义：
// 绝对路径原样（只做分隔符归一化），相对路径按启动时的工作目录解析。
//
// 绝对路径用 t.TempDir() 而不是写死 "/srv/files"：`\srv\files` 在 Windows 上不是绝对
// 路径（没有盘符），会被当成相对路径接到工作目录后面，于是这条断言在迁移到 Windows 后
// 必然失败，而失败的是夹具而不是被测逻辑。
func TestResolveStartPath(t *testing.T) {
	wd := t.TempDir()
	abs := filepath.Join(wd, "files") // 平台相关，但一定是绝对路径

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"未配置", "", ""},
		{"绝对路径原样", abs, normalizePath(abs)},
		{"相对路径按工作目录解析", "files", normalizePath(filepath.Join(wd, "files"))},
		{"当前目录", "./", normalizePath(wd)},
		{"带父目录段", "a/../b", normalizePath(filepath.Join(wd, "b"))},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := resolveStartPath(c.raw, wd); got != c.want {
				t.Fatalf("resolveStartPath(%q, %q) = %q，期望 %q", c.raw, wd, got, c.want)
			}
		})
	}
}

// TestNormalizePathKeepsUNCPrefix：UNC 的前导 `//` 是「这是一个网络共享」的标记，
// 折叠掉它就变成 Unix 根下的普通目录，startPath 会指到一个完全不同的位置。
func TestNormalizePathKeepsUNCPrefix(t *testing.T) {
	cases := map[string]string{
		`\\server\share`:            `//server/share`,
		`\\server\share\docs`:       `//server/share/docs`,
		`//server//share//docs`:     `//server/share/docs`,
		`\\wsl.localhost\Debian\me`: `//wsl.localhost/Debian/me`,
		// 普通路径仍然折叠重复斜杠
		`/data//x`:  `/data/x`,
		`C:\Users\`: `C:/Users/`,
	}
	for in, want := range cases {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%q) = %q，期望 %q", in, got, want)
		}
	}
}

// UNC 的 startPath 必须是绝对路径（Windows 上 filepath.IsAbs 认 UNC）。
func TestResolveStartPathWithUNC(t *testing.T) {
	got := resolveStartPath(`\\server\share\docs`, `C:\work`)
	if runtime.GOOS == "windows" {
		if got != `//server/share/docs` {
			t.Fatalf("UNC startPath 应原样保留前导 //，得到 %q", got)
		}
		return
	}
	// 非 Windows 上 UNC 不是绝对路径，按相对路径解析——这是有意的降级。
	if !strings.HasSuffix(got, "/server/share/docs") {
		t.Fatalf("非 Windows 上 UNC 按相对路径解析，得到 %q", got)
	}
}
