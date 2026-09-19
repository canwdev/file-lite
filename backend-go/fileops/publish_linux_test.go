//go:build linux

package fileops

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// withoutUmask 关掉 umask 跑 fn，否则创建模式会被进程的 umask 削掉。
//
// 为什么必须关：`os.OpenFile` 的 mode 只是上限，实际权限是 mode &^ umask。本例的两个
// 模式（0640 / 0644）在常见的 umask 022 下恰好都不被削，但换成 umask 077 就会被削成
// 0600——于是断言变成看环境脸色，而不是看实现。测试要先把这层不确定性去掉。
//
// 注意这是进程级状态：本文件里的用例不要标记 t.Parallel()。
func withoutUmask(t *testing.T, fn func()) {
	t.Helper()
	old := syscall.Umask(0)
	defer syscall.Umask(old)
	fn()
}

// 本机卷上，权限必须对齐到源：目标一出现就应该是最终形态，而不是先 0600 再补一次 chmod。
//
// 只在类 Unix 上断言：Windows 的 os.Chmod 只切换只读位，os.Stat 报回来的 mode
// 恒是 0666 / 0444，这条断言在那里没有意义（也正因如此，PublishOptions.Mode
// 在 Windows 上本来就不承载「权限」这层信息）。
func TestPublishFileAlignsModeOnLocalVolume(t *testing.T) {
	withoutUmask(t, func() {
		dst := filepath.Join(t.TempDir(), "a.txt")

		if err := PublishFile(dst, PublishOptions{Mode: 0640}, publishContent("payload")); err != nil {
			t.Fatal(err)
		}

		st, err := os.Stat(dst)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0640 {
			t.Errorf("mode = %v，期望 0640", st.Mode().Perm())
		}
		assertNoTempFiles(t, filepath.Dir(dst))
	})
}

// 网络目标上跳过的只是那次「发布前 chmod」，**权限本身仍然要对**。
//
// 这是回归测试：临时文件默认按 0600 创建，如果只是跳过 chmod，SMB / NFS 上发布
// 出来的文件会变成「仅所有者可读写」——共享环境里别人读不到，恰恰废掉了它的用途。
// 所以网络目标的权限必须在创建临时文件时就带上。
func TestPublishFileKeepsRequestedModeOnNetworkTarget(t *testing.T) {
	withoutUmask(t, func() {
		dst := filepath.Join(t.TempDir(), "a.txt")

		if err := PublishFile(dst, PublishOptions{
			Mode:          0644,
			NetworkTarget: true,
		}, publishContent("payload")); err != nil {
			t.Fatal(err)
		}

		st, err := os.Stat(dst)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0644 {
			t.Errorf("网络目标上 mode = %v，期望 0644（不能退化成临时文件的 0600）", st.Mode().Perm())
		}
		assertNoTempFiles(t, filepath.Dir(dst))
	})
}
