package config

import (
	"path/filepath"
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

func TestResolveStartPath(t *testing.T) {
	wd := filepath.FromSlash("/work")
	abs := filepath.FromSlash("/srv/files")

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"未配置", "", ""},
		{"绝对路径原样", abs, "/srv/files"},
		{"相对路径按工作目录解析", "files", "/work/files"},
		{"当前目录", "./", "/work"},
		{"带父目录段", "a/../b", "/work/b"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := resolveStartPath(c.raw, wd); got != c.want {
				t.Fatalf("resolveStartPath(%q, %q) = %q，期望 %q", c.raw, wd, got, c.want)
			}
		})
	}
}
