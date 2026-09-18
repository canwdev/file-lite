package utils

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// IsPathInsideOrEqual 用来挡住「把目录移动 / 复制进自己的子树」。
// 它是**词法**判断（先 filepath.Abs，再按段边界比较），所以目标不存在时也能判。
//
// 这里刻意用真实的符号链接建夹具，是为了锁定「父路径含链接时词法判断与实际指向
// 一致」这个前提：链接本身位于源目录内，它下面的路径因此也在源目录内，
// 字符串前缀判断同样成立，两者不会分叉。
func TestIsPathInsideOrEqual(t *testing.T) {
	root := tempDirNearCwd(t)
	src := filepath.Join(root, "src")
	sub := filepath.Join(src, "sub")
	outside := filepath.Join(root, "outside")
	for _, d := range []string{sub, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if err := os.Symlink(src, filepath.Join(src, "link")); err != nil {
		t.Skipf("无法创建符号链接，跳过：%v", err)
	}

	cases := []struct {
		name   string
		target string
		parent string
		want   bool
	}{
		{"同一路径", src, src, true},
		{"直接子目录", sub, src, true},
		{"尚不存在的子目录", filepath.Join(src, "new"), src, true},
		{"带当前目录段的子目录", filepath.Join(src, ".", "sub"), src, true},
		{"带父目录段的子目录", filepath.Join(src, "sub", "..", "sub"), src, true},
		{"兄弟目录", outside, src, false},
		{"祖先目录", root, src, false},
		{"名字是源的前缀但不是子目录", filepath.Join(root, "src2"), src, false},
		// 链接位于源目录内，它下面的一切都在源的子树里。
		{"经过符号链接的子路径", filepath.Join(src, "link", "sub"), src, true},
		{"符号链接自身", filepath.Join(src, "link"), src, true},
		// 相对路径必须先被解析成绝对路径再比较。
		{"相对目标", mustRel(t, sub), src, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsPathInsideOrEqual(c.target, c.parent); got != c.want {
				t.Fatalf("IsPathInsideOrEqual(%q, %q) = %v，期望 %v", c.target, c.parent, got, c.want)
			}
		})
	}
}
// 大小写：只在真正不区分大小写的平台上验证，避免在 Linux 上写死 Windows 语义。
func TestIsPathInsideOrEqualCaseInsensitiveFS(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("只有 Windows / macOS 的默认文件系统不区分大小写")
	}
	root := t.TempDir()
	src := filepath.Join(root, "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	// 词法判断不折叠大小写，这里锁定住这是**已知且有意的**取舍：
	// 返回 false 时由文件系统自己拒绝（Windows 上 os.Rename 会失败）。
	if got := IsPathInsideOrEqual(filepath.Join(root, "SRC", "sub"), src); got != false {
		t.Fatalf("词法判断不折叠大小写，期望 false，得到 %v", got)
	}
}

// tempDirNearCwd 在**当前工作目录所在的分区**上建临时目录。
//
// 「相对目标」这条用例要把绝对路径转成相对路径，而 Windows 上盘符不同的两个路径
// 之间不存在相对路径（filepath.Rel 会直接报错）。t.TempDir() 落在系统盘，
// 工作区可能在别的盘，于是这条断言会在 Windows 上以夹具报错的形式失败。
// 把夹具建在工作目录下，两边必然同盘。
func tempDirNearCwd(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp(".", "fs-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	abs, err := filepath.Abs(dir)
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func mustRel(t *testing.T, p string) string {
	t.Helper()
	rel, err := filepath.Rel(mustGetwd(t), p)
	if err != nil {
		t.Fatal(err)
	}
	return rel
}

func mustGetwd(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return wd
}
