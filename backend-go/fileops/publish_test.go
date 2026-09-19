package fileops

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"file-lite-go/types"
)

// publish 目标：写入的内存通过回调提供，方便各处复用。
func publishContent(content string) func(w io.Writer) error {
	return func(w io.Writer) error {
		_, err := io.WriteString(w, content)
		return err
	}
}

// 本机卷上发布的文件应当是「最终形态」：内容、时间、权限都对。
//
// 权限只在类 Unix 上有意义——Windows 上 os.Chmod 只切换只读位，Stat 报回来的
// mode 恒是 0666 / 0444，所以那条断言放在 publish_linux_test.go 里。
func TestPublishFileWritesContentAndAlignsMtime(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "a.txt")
	mtime := time.Date(2026, 5, 1, 2, 3, 4, 0, time.UTC)

	if err := PublishFile(dst, PublishOptions{
		Mode:  0640,
		Mtime: mtime,
	}, publishContent("payload")); err != nil {
		t.Fatal(err)
	}

	if got := readFile(t, dst); got != "payload" {
		t.Fatalf("content = %q，期望 payload", got)
	}
	st, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if !st.ModTime().UTC().Equal(mtime) {
		t.Errorf("mtime = %v，期望 %v", st.ModTime().UTC(), mtime)
	}

	assertNoTempFiles(t, filepath.Dir(dst))
}

// 网络目标上 fsync 必须被跳过：它是整条发布链路里最贵的一步，而在网络位置上
// 保的那个窗口基本不存在（见 PublishOptions.NetworkTarget）。
//
// 跳没跳过从文件内容上看不出来，所以从 syncBeforePublish 这个唯一入口观察。
func TestPublishFileSkipsSyncWhenNetworkTarget(t *testing.T) {
	orig := syncBeforePublish
	t.Cleanup(func() { syncBeforePublish = orig })

	for _, c := range []struct {
		name    string
		network bool
		want    int
	}{
		{"本机卷必须 fsync", false, 1},
		{"网络位置跳过 fsync", true, 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			dst := filepath.Join(dir, "a.txt")

			replacedRealSync := false
			syncBeforePublish = func(f *os.File) error {
				replacedRealSync = true
				return nil
			}
			t.Cleanup(func() { syncBeforePublish = orig })

			if err := PublishFile(dst, PublishOptions{NetworkTarget: c.network}, publishContent("x")); err != nil {
				t.Fatal(err)
			}
			if replacedRealSync != (c.want > 0) {
				t.Fatalf("network=%v：fsync 被调用 = %v，期望 %v", c.network, replacedRealSync, c.want > 0)
			}
			// 两种模式下内容都必须完整，且都不能留下临时文件——
			// 网络位置照旧走「临时文件 + 改名」，跳过的只有收尾。
			if got := readFile(t, dst); got != "x" {
				t.Fatalf("network=%v：content = %q，期望 x", c.network, got)
			}
			assertNoTempFiles(t, dir)
		})
	}
}

// 钩子被替换时也不能改变「发布成功」这件事——否则测试钩子自己就成了行为差异。
func TestPublishFileSyncHookStillPublishes(t *testing.T) {
	orig := syncBeforePublish
	t.Cleanup(func() { syncBeforePublish = orig })
	syncBeforePublish = func(f *os.File) error { return nil }

	dst := filepath.Join(t.TempDir(), "a.txt")
	if err := PublishFile(dst, PublishOptions{}, publishContent("done")); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dst); got != "done" {
		t.Fatalf("content = %q，期望 done", got)
	}
}

// 目标文件已存在时必须被原子替换，网络目标也一样（这层保证不因网络而改变）。
func TestPublishFileReplacesExistingOnNetworkTarget(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(dst, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := PublishFile(dst, PublishOptions{NetworkTarget: true}, publishContent("replacement")); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, dst); got != "replacement" {
		t.Fatalf("content = %q，期望 replacement", got)
	}
	assertNoTempFiles(t, dir)
}

// 写入失败（回调报错）时不能把半成品留在目标上，也不能留下临时文件。
func TestPublishFileCleansUpOnWriteError(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "a.txt")

	err := PublishFile(dst, PublishOptions{}, func(w io.Writer) error {
		if _, werr := io.WriteString(w, "half"); werr != nil {
			return werr
		}
		return os.ErrInvalid
	})
	if err == nil {
		t.Fatal("写入失败应当返回错误")
	}
	if _, statErr := os.Stat(dst); !os.IsNotExist(statErr) {
		t.Fatalf("目标不应存在，得到 %v", statErr)
	}
	assertNoTempFiles(t, dir)
}

// IsNetworkTarget 是复制循环里唯一能问「这条 os 路径在网络位置上吗」的入口，
// 所以两条判定来源都要覆盖：挂载表的 Kind，以及形态上的 UNC 兜底。
func TestIsNetworkTarget(t *testing.T) {
	SetMounts([]types.Drive{
		{Label: "D:", Path: "D:/", Kind: types.DriveKindVolume},
		{Label: "share", Path: "//server/share", Kind: types.DriveKindNetwork},
		{Label: "wsl", Path: "/mnt/c", Kind: types.DriveKindNetwork},
		{Label: "home", Path: "/home/me", Kind: types.DriveKindHome},
	})
	defer ClearMounts()

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"挂载表标的网络位置", "/mnt/c/Users/me/a.txt", true},
		{"UNC 形态的网络位置", `//server/share/docs/a.txt`, true},
		{"挂载表里没有、但形态是 UNC", `//other/share/a.txt`, true},
		{"Windows 反斜杠形态的 UNC", `\\server\share\docs\a.txt`, true},
		{"本机卷", `D:\tmp\a.txt`, false},
		{"Home 不是网络位置", "/home/me/a.txt", false},
		{"空路径", "", false},
	}
	for _, c := range cases {
		if got := IsNetworkTarget(c.path); got != c.want {
			t.Errorf("%s：IsNetworkTarget(%q) = %v，期望 %v", c.name, c.path, got, c.want)
		}
	}
}

// 挂载表为空时，本机路径不能因为「查不到挂载点」就被当成网络位置。
func TestIsNetworkTargetWithoutMountTable(t *testing.T) {
	ClearMounts()
	if IsNetworkTarget(`D:\tmp\a.txt`) {
		t.Error("挂载表为空时本机路径不该算网络位置")
	}
	if !IsNetworkTarget(`\\server\share\a.txt`) {
		t.Error("挂载表为空时 UNC 仍应算网络位置")
	}
}
