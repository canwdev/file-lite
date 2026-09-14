package fileops

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// 跨卷 rename 的错误码每个系统都不一样，而且 Windows 上 syscall.EXDEV 是个
// 系统永远不会返回的杜撰值。这条用例盯的就是那个回归：只判 EXDEV 时，
// 跨盘移动会直接失败而不是回退到复制 + 删除。
func TestIsCrossDeviceError(t *testing.T) {
	cross := &os.LinkError{Op: "rename", Old: "D:/a.txt", New: "F:/a.txt", Err: crossDeviceErrno}
	if !isCrossDeviceError(cross) {
		t.Fatalf("%v was not recognized as a cross-device rename", cross)
	}

	// 别的失败不能被当成跨卷，否则会先复制、再删源，把真正的错误盖掉
	for _, errno := range []syscall.Errno{syscall.EACCES, syscall.ENOENT, syscall.EEXIST} {
		err := &os.LinkError{Op: "rename", Old: "a", New: "b", Err: errno}
		if isCrossDeviceError(err) {
			t.Fatalf("%v must not be treated as a cross-device rename", err)
		}
	}
}

// crossDeviceRoot 找一个与 t.TempDir() 不在同一个文件系统上的目录，
// 用来制造真实的跨卷 rename。只有一个文件系统时返回 ok=false。
func crossDeviceRoot(t *testing.T) (string, bool) {
	t.Helper()
	probe := filepath.Join(t.TempDir(), "probe.txt")
	writeFile(t, probe, []byte("probe"))

	for _, dir := range []string{"/dev/shm", "/run", "/tmp"} {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			continue
		}
		target, err := os.MkdirTemp(dir, "file-lite-crossdev-probe-")
		if err != nil {
			continue
		}
		dst := filepath.Join(target, "probe.txt")
		err = os.Rename(probe, dst)
		if err == nil {
			// 同一个文件系统，换个候选
			if rerr := os.Rename(dst, probe); rerr != nil {
				t.Fatalf("rename probe back: %v", rerr)
			}
			os.Remove(target)
			continue
		}
		os.Remove(target)
		if isCrossDeviceError(err) {
			return dir, true
		}
	}
	return "", false
}

// 跨分区移动必须退化成「复制 + 删除」而不是报错；文件、新目录、以及合并进
// 已存在目录三种情况都有自己的 rename 分支，都要走到。
func TestMoveAcrossFilesystemsFallsBackToCopyAndDelete(t *testing.T) {
	root, ok := crossDeviceRoot(t)
	if !ok {
		t.Skip("no second filesystem available to exercise a cross-device rename")
	}
	dst, err := os.MkdirTemp(root, "file-lite-crossdev-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dst) })

	src := t.TempDir()
	file := filepath.Join(src, "a.jfif")
	tree := filepath.Join(src, "tree")
	merge := filepath.Join(src, "merge")
	writeFile(t, file, []byte("hello"))
	writeFile(t, filepath.Join(tree, "nested", "b.txt"), []byte("deep"))
	writeFile(t, filepath.Join(merge, "added.txt"), []byte("added"))
	// 目标里已有同名目录：目录顶不掉目录，走合并分支
	writeFile(t, filepath.Join(dst, "merge", "keep.txt"), []byte("keep"))

	results, err := NewEngine().Run(context.Background(), Options{
		FromPaths: []string{file, tree, merge},
		ToPath:    dst,
		IsMove:    true,
		Policy:    PolicyOverwrite,
	}, Callbacks{})
	if err != nil {
		t.Fatal(err)
	}
	if got := statuses(results)["failed"]; got != 0 {
		t.Fatalf("expected no failures, got %v (%+v)", statuses(results), results)
	}
	for path, want := range map[string]string{
		filepath.Join(dst, "a.jfif"):                  "hello",
		filepath.Join(dst, "tree", "nested", "b.txt"): "deep",
		filepath.Join(dst, "merge", "added.txt"):      "added",
		filepath.Join(dst, "merge", "keep.txt"):       "keep",
	} {
		if got := readFile(t, path); got != want {
			t.Fatalf("%s: unexpected content %q", path, got)
		}
	}
	// 源目录要等子项的复制落地之后才删得掉：删早了会留下空的源目录树并报
	// "directory not empty"
	for _, p := range []string{file, tree, merge} {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Fatalf("source %s still present after the move (err=%v)", p, err)
		}
	}
	assertNoTempFiles(t, dst)
}
