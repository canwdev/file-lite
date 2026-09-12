package fileops

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"file-lite-go/utils"
)

func writeFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func assertNoTempFiles(t *testing.T, dir string) {
	t.Helper()
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		if utils.IsReservedTempName(info.Name()) {
			t.Errorf("leftover temp file: %s", path)
		}
		return nil
	})
}

func statuses(results []ItemResult) map[string]int {
	out := map[string]int{}
	for _, r := range results {
		out[string(r.Status)]++
	}
	return out
}

func TestCopyBasic(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("hello"))
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	e := NewEngine(false)
	results, err := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicyOverwrite,
	}, Callbacks{})
	if err != nil {
		t.Fatal(err)
	}
	if got := statuses(results)["copied"]; got != 1 {
		t.Fatalf("expected 1 copied, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "hello" {
		t.Fatalf("unexpected content %q", got)
	}
	assertNoTempFiles(t, dst)
}

func TestCopyProgressCountsEachByteOnce(t *testing.T) {
	// 复制时 progressWriter 已经按块累加过字节，收尾不能再加一次文件大小，
	// 否则 bytesDone 会是真实值的两倍，进度条在一半时就到 100%。
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.bin")
	dst := filepath.Join(dir, "dst")
	payload := bytes.Repeat([]byte{7}, 4096)
	writeFile(t, src, payload)
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	var lastItems int
	var lastBytes int64
	results, err := NewEngine(false).Run(context.Background(), Options{
		FromPaths: []string{src},
		ToPath:    dst,
		Policy:    PolicyOverwrite,
	}, Callbacks{
		OnProgress: func(items int, bytesDone int64, _ string) {
			lastItems, lastBytes = items, bytesDone
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := statuses(results)["copied"]; got != 1 {
		t.Fatalf("expected 1 copied, got %v", statuses(results))
	}
	if lastItems != 1 {
		t.Fatalf("itemsDone = %d, want 1", lastItems)
	}
	if lastBytes != int64(len(payload)) {
		t.Fatalf("bytesDone = %d, want %d", lastBytes, len(payload))
	}
}

func TestCopyDoesNotClobberSourceWhenDestinationIsInside(t *testing.T) {
	// 目标目录里已有同名文件时，Overwrite 必须原子替换而不是先删除再写
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("new-content"))
	writeFile(t, filepath.Join(dst, "a.txt"), []byte("old-content"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicyOverwrite,
	}, Callbacks{})

	if got := statuses(results)["replaced"]; got != 1 {
		t.Fatalf("expected 1 replaced, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "new-content" {
		t.Fatalf("unexpected content %q", got)
	}
	assertNoTempFiles(t, dst)
}

func TestConflictSkip(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("new"))
	writeFile(t, filepath.Join(dst, "a.txt"), []byte("old"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicySkip,
	}, Callbacks{})

	if got := statuses(results)["skipped"]; got != 1 {
		t.Fatalf("expected 1 skipped, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("destination must be untouched, got %q", got)
	}
}

func TestConflictKeepBoth(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("new"))
	writeFile(t, filepath.Join(dst, "a.txt"), []byte("old"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicyKeepBoth,
	}, Callbacks{})

	if got := statuses(results)["renamed"]; got != 1 {
		t.Fatalf("expected 1 renamed, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "a (1).txt")); got != "new" {
		t.Fatalf("unexpected renamed content %q", got)
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("destination must be untouched, got %q", got)
	}
}

func TestConflictAskIsSafe(t *testing.T) {
	// 执行期间才发现的冲突在 ask 策略下必须跳过而不是覆盖
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("new"))
	writeFile(t, filepath.Join(dst, "a.txt"), []byte("old"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicyAsk,
	}, Callbacks{})

	if got := statuses(results)["conflict"]; got != 1 {
		t.Fatalf("expected 1 conflict, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("destination must not be overwritten, got %q", got)
	}
}

func TestDirectoryMergeWindowsSemantics(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "docs")
	dst := filepath.Join(dir, "target")
	writeFile(t, filepath.Join(src, "new.txt"), []byte("n"))
	writeFile(t, filepath.Join(src, "same.txt"), []byte("from-src"))
	writeFile(t, filepath.Join(dst, "docs", "same.txt"), []byte("from-dst"))
	writeFile(t, filepath.Join(dst, "docs", "keep.txt"), []byte("keep"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{src},
		ToPath:    dst,
		Policy:    PolicySkip,
	}, Callbacks{})

	// 目录本身静默合并，不产生冲突条目
	if got := statuses(results)["skipped"]; got != 1 {
		t.Fatalf("expected only the inner same.txt to be skipped, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dst, "docs", "keep.txt")); got != "keep" {
		t.Fatalf("existing untouched file lost: %q", got)
	}
	if got := readFile(t, filepath.Join(dst, "docs", "same.txt")); got != "from-dst" {
		t.Fatalf("skipped file must keep destination content, got %q", got)
	}
	if got := readFile(t, filepath.Join(dst, "docs", "new.txt")); got != "n" {
		t.Fatalf("new file was not merged in: %q", got)
	}
}

func TestMoveSameVolumeRemovesSource(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("x"))
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		IsMove:    true,
		Policy:    PolicyAsk,
	}, Callbacks{})

	if got := statuses(results)["moved"]; got != 1 {
		t.Fatalf("expected 1 moved, got %v", statuses(results))
	}
	if ExistsAt(filepath.Join(src, "a.txt")) {
		t.Fatal("source should be gone after move")
	}
	if got := readFile(t, filepath.Join(dst, "a.txt")); got != "x" {
		t.Fatalf("unexpected content %q", got)
	}
}

func TestDuplicateNaming(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "a.txt"), []byte("1"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(dir, "a.txt")},
		ToPath:    dir,
		Duplicate: true,
	}, Callbacks{})

	if got := statuses(results)["copied"]; got != 1 {
		t.Fatalf("expected 1 copied, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dir, "a - Copy.txt")); got != "1" {
		t.Fatalf("unexpected duplicate content %q", got)
	}
}

func TestDeleteRecursive(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "tree", "a", "b")
	writeFile(t, filepath.Join(nested, "x.txt"), []byte("x"))
	writeFile(t, filepath.Join(dir, "tree", "y.txt"), []byte("y"))

	e := NewEngine(false)
	results, _ := e.Run(context.Background(), Options{
		FromPaths: []string{filepath.Join(dir, "tree")},
	}, Callbacks{})

	if got := statuses(results)["deleted"]; got != 1 {
		t.Fatalf("expected 1 deleted, got %v", statuses(results))
	}
	if ExistsAt(filepath.Join(dir, "tree")) {
		t.Fatal("tree should be deleted")
	}
}

// TestCancelNeverLeavesPartialFile 是本次改造最核心的不变式：
// 取消可以发生在任何时候，但目标目录里既不能有半个文件，也不能有临时文件残留。
func TestCancelNeverLeavesPartialFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	// 32MB，保证复制过程足够长，取消几乎一定落在写入过程中
	payload := make([]byte, 32*1024*1024)
	for i := range payload {
		payload[i] = byte(i)
	}
	srcFile := filepath.Join(src, "big.bin")
	if err := os.WriteFile(srcFile, payload, 0644); err != nil {
		t.Fatal(err)
	}

	e := NewEngine(false)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(2 * time.Millisecond)
		cancel()
	}()
	_, _ = e.Run(ctx, Options{
		FromPaths:       []string{srcFile},
		ToPath:          dst,
		Policy:          PolicyOverwrite,
		FileConcurrency: 1,
	}, Callbacks{})

	assertNoTempFiles(t, dst)

	// 目标文件要么不存在，要么大小与源完全一致（绝不可能是半个文件）
	finalPath := filepath.Join(dst, "big.bin")
	if st, err := os.Stat(finalPath); err == nil {
		if st.Size() != int64(len(payload)) {
			t.Fatalf("partial file published: size=%d want=%d", st.Size(), len(payload))
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}

func TestCancelBeforeStartDoesNothing(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("x"))
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	e := NewEngine(false)
	_, _ = e.Run(ctx, Options{
		FromPaths: []string{filepath.Join(src, "a.txt")},
		ToPath:    dst,
		Policy:    PolicyOverwrite,
	}, Callbacks{})

	if ExistsAt(filepath.Join(dst, "a.txt")) {
		t.Fatal("nothing should be copied after cancellation")
	}
	assertNoTempFiles(t, dst)
}

func TestScanReportsNestedConflicts(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "docs")
	dst := filepath.Join(dir, "target")
	writeFile(t, filepath.Join(src, "same.txt"), []byte("a"))
	writeFile(t, filepath.Join(src, "fresh.txt"), []byte("b"))
	writeFile(t, filepath.Join(dst, "docs", "same.txt"), []byte("c"))

	res, err := Scan(context.Background(), []string{src}, dst)
	if err != nil {
		t.Fatal(err)
	}
	if res.ConflictTotal != 1 {
		t.Fatalf("expected 1 conflict, got %d", res.ConflictTotal)
	}
	if res.Conflicts[0].RelativePath != "docs/same.txt" {
		t.Fatalf("unexpected relative path %q", res.Conflicts[0].RelativePath)
	}
	if res.ItemsTotal != 2 {
		t.Fatalf("expected 2 items, got %d", res.ItemsTotal)
	}
}

func TestScanTreatsDirectoryMergeAsNoConflict(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "docs")
	dst := filepath.Join(dir, "target")
	writeFile(t, filepath.Join(src, "a.txt"), []byte("a"))
	if err := os.MkdirAll(filepath.Join(dst, "docs"), 0755); err != nil {
		t.Fatal(err)
	}

	res, err := Scan(context.Background(), []string{src}, dst)
	if err != nil {
		t.Fatal(err)
	}
	if res.ConflictTotal != 0 {
		t.Fatalf("directory-vs-directory must merge silently, got %d conflicts", res.ConflictTotal)
	}
}

func TestReservedTempName(t *testing.T) {
	if !utils.IsReservedTempName(utils.TempFilePrefix + "abc") {
		t.Fatal("temp prefix must be reserved")
	}
	if utils.IsReservedTempName("normal.txt") {
		t.Fatal("normal name must not be reserved")
	}
	if !strings.HasPrefix(utils.TempFilePrefix, ".") {
		t.Fatal("temp prefix should start with a dot so it is also treated as hidden")
	}
}

// TestFailureMessageHidesTempFile 用户看到的报错必须是目标路径，
// 不能泄露内部的 .fl-part-* 临时文件名。
func TestFailureMessageHidesTempFile(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	writeFile(t, src, []byte("x"))
	if err := os.MkdirAll(dst, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dst, 0755) })

	e := NewEngine(false)
	results, err := e.Run(context.Background(), Options{
		FromPaths: []string{src},
		ToPath:    dst,
		Policy:    PolicyOverwrite,
	}, Callbacks{})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Status != StatusFailed {
		t.Fatalf("expected a failed result, got %+v", results)
	}
	msg := results[0].Message
	if strings.Contains(msg, utils.TempFilePrefix) {
		t.Fatalf("error message leaks the temporary file name: %q", msg)
	}
	if !strings.Contains(msg, dst) {
		t.Fatalf("error message should mention the destination: %q", msg)
	}
}

// TestResultSetIsBounded 锁定内存上限：一次超大复制不能把每条结果都留在内存里，
// 同时失败项不能被大量成功项挤掉（失败清单与 Try Again 只依赖失败项）。
func TestResultSetIsBounded(t *testing.T) {
	rs := &runState{}
	// 先把成功额度用满，再灌失败项：失败项必须仍然被保住
	for i := 0; i < maxStoredSuccesses+200; i++ {
		rs.record(ItemResult{FromPath: "ok", Status: StatusCopied})
	}
	for i := 0; i < maxStoredFailures+200; i++ {
		rs.record(ItemResult{FromPath: "bad", Status: StatusFailed})
	}

	got := rs.resultsSnapshot()
	if len(got) != maxStoredSuccesses+maxStoredFailures {
		t.Fatalf("expected the result set to be capped at %d, got %d",
			maxStoredSuccesses+maxStoredFailures, len(got))
	}

	var failures int
	for _, r := range got {
		if r.Status == StatusFailed {
			failures++
		}
	}
	if failures != maxStoredFailures {
		t.Fatalf("failures must not be crowded out by successes: got %d, want %d", failures, maxStoredFailures)
	}
}

// TestCopyIntoItsOwnFolderDuplicates 覆盖「原地粘贴」：
// 把 X 粘贴回它自己所在的目录时，不应问「是否用自己替换自己」
// （那个操作只会把文件静默重写一遍，实测 inode 变化、硬链接被拆开），
// 而应按资源管理器语义直接生成 "X - Copy"。
func TestCopyIntoItsOwnFolderDuplicates(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	writeFile(t, src, []byte("alpha"))
	link := filepath.Join(dir, "hardlink.txt")
	if err := os.Link(src, link); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(src)
	if err != nil {
		t.Fatal(err)
	}

	e := NewEngine(false)
	// 即使策略是 overwrite，也不该动原文件
	results, err := e.Run(context.Background(), Options{
		FromPaths: []string{src},
		ToPath:    dir,
		Policy:    PolicyOverwrite,
	}, Callbacks{})
	if err != nil {
		t.Fatal(err)
	}

	if got := statuses(results)["copied"]; got != 1 {
		t.Fatalf("expected the copy to be renamed, got %v", statuses(results))
	}
	if got := readFile(t, filepath.Join(dir, "a - Copy.txt")); got != "alpha" {
		t.Fatalf("unexpected duplicate content %q", got)
	}
	if got := readFile(t, src); got != "alpha" {
		t.Fatalf("original must be untouched, got %q", got)
	}

	after, err := os.Lstat(src)
	if err != nil {
		t.Fatal(err)
	}
	// 原文件不能被重写：inode 相同、硬链接计数不变
	if !os.SameFile(before, after) {
		t.Fatal("the original file was rewritten in place (inode changed)")
	}
	if utils.HardLinkCount(after, src) != 2 {
		t.Fatalf("the hard link was broken: nlink=%d, want 2", utils.HardLinkCount(after, src))
	}
}

// TestMoveIntoItsOwnFolderIsSkipped 原地移动是空操作，如实上报跳过。
func TestMoveIntoItsOwnFolderIsSkipped(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	writeFile(t, src, []byte("alpha"))

	e := NewEngine(false)
	results, err := e.Run(context.Background(), Options{
		FromPaths: []string{src},
		ToPath:    dir,
		IsMove:    true,
		Policy:    PolicyAsk,
	}, Callbacks{})
	if err != nil {
		t.Fatal(err)
	}

	if got := statuses(results)["skipped"]; got != 1 {
		t.Fatalf("expected a skipped result, got %v", statuses(results))
	}
	if !ExistsAt(src) {
		t.Fatal("the file must stay where it is")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("nothing should have been created, got %d entries", len(entries))
	}
}

// TestScanDoesNotReportInPlacePasteAsConflict 原地粘贴不该让任务停下来等决策。
func TestScanDoesNotReportInPlacePasteAsConflict(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	writeFile(t, src, []byte("alpha"))

	res, err := Scan(context.Background(), []string{src}, dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.ConflictTotal != 0 {
		t.Fatalf("in-place paste must not be a conflict, got %d", res.ConflictTotal)
	}
	if res.ItemsTotal != 1 {
		t.Fatalf("expected 1 item, got %d", res.ItemsTotal)
	}
}
