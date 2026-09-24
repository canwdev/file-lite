package tasks

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"file-lite-go/fileops"
	"file-lite-go/sevenzip"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func newTestManager(t *testing.T, ttl time.Duration) (*Manager, chan Event) {
	t.Helper()
	engine := fileops.NewEngine()
	m := NewManager(engine, Options{Concurrency: 1, FileConcurrency: 1, ConflictTTL: ttl})
	events := make(chan Event, 256)
	m.SetEmitter(func(ev Event) { events <- ev })
	m.Start()
	t.Cleanup(m.Stop)
	return m, events
}

func waitFor(t *testing.T, events chan Event, typ EventType, taskID string) Event {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev.Type == typ && (taskID == "" || ev.Task.ID == taskID) {
				return ev
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %s", typ)
		}
	}
}

func TestTaskPausesOnConflictThenSkip(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "new")
	write(t, filepath.Join(dst, "a.txt"), "old")

	m, events := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{
		Kind:       KindCopy,
		FromPaths:  []string{src},
		ToPath:     dst,
		OnConflict: fileops.PolicyAsk,
	})
	if err != nil {
		t.Fatal(err)
	}

	conflict := waitFor(t, events, EventConflict, snap.ID)
	if conflict.Conflict == nil || conflict.Conflict.TotalCount != 1 {
		t.Fatalf("expected 1 conflict, got %+v", conflict.Conflict)
	}
	// 暂停期间磁盘必须零改动
	if got := read(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("destination changed before decision: %q", got)
	}
	if !fileops.ExistsAt(src) {
		t.Fatal("source must still exist while paused")
	}

	if err := m.Resolve(snap.ID, ResolveRequest{Policy: fileops.PolicySkip, ApplyToAll: true}); err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("expected succeeded, got %s (%s)", done.Task.State, done.Task.Error)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("skip must keep destination, got %q", got)
	}
}

func TestTaskConflictOverwriteReplaces(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "new")
	write(t, filepath.Join(dst, "a.txt"), "old")

	m, events := newTestManager(t, time.Minute)
	snap, _ := m.Create(CreateParams{Kind: KindCopy, FromPaths: []string{src}, ToPath: dst, OnConflict: fileops.PolicyAsk})
	waitFor(t, events, EventConflict, snap.ID)
	if err := m.Resolve(snap.ID, ResolveRequest{Policy: fileops.PolicyOverwrite, ApplyToAll: true}); err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("expected succeeded, got %s", done.Task.State)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "new" {
		t.Fatalf("overwrite must replace, got %q", got)
	}
}

func TestTaskCancelWhileAwaitingConflict(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "new")
	write(t, filepath.Join(dst, "a.txt"), "old")

	m, events := newTestManager(t, time.Minute)
	snap, _ := m.Create(CreateParams{Kind: KindCopy, FromPaths: []string{src}, ToPath: dst, OnConflict: fileops.PolicyAsk})
	waitFor(t, events, EventConflict, snap.ID)

	if err := m.Cancel(snap.ID); err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateCancelled {
		t.Fatalf("expected cancelled, got %s", done.Task.State)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("cancel must not touch destination, got %q", got)
	}
	if !fileops.ExistsAt(src) {
		t.Fatal("source must survive cancellation")
	}
}

func TestTaskConflictTTLFailsSafely(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "new")
	write(t, filepath.Join(dst, "a.txt"), "old")

	m, events := newTestManager(t, 50*time.Millisecond)
	snap, _ := m.Create(CreateParams{Kind: KindCopy, FromPaths: []string{src}, ToPath: dst, OnConflict: fileops.PolicyAsk})
	waitFor(t, events, EventConflict, snap.ID)
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateFailed {
		t.Fatalf("expected failed after TTL, got %s", done.Task.State)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "old" {
		t.Fatalf("unresolved conflict must never overwrite, got %q", got)
	}
}

func TestTaskDeleteAndList(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "tree", "a", "b.txt")
	write(t, target, "x")

	m, events := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{Kind: KindDelete, FromPaths: []string{filepath.Join(dir, "tree")}})
	if err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("expected succeeded, got %s (%s)", done.Task.State, done.Task.Error)
	}
	if fileops.ExistsAt(filepath.Join(dir, "tree")) {
		t.Fatal("tree should be deleted")
	}
	if len(m.List()) != 1 {
		t.Fatalf("expected task to be listed, got %d", len(m.List()))
	}
	if err := m.Dismiss(snap.ID); err != nil {
		t.Fatal(err)
	}
	if len(m.List()) != 0 {
		t.Fatal("dismiss should remove the task")
	}
}

func TestCreateRejectsUnsafeDestination(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	m, _ := newTestManager(t, time.Minute)
	// 目标在源内部
	if _, err := m.Create(CreateParams{
		Kind:      KindCopy,
		FromPaths: []string{src},
		ToPath:    filepath.Join(src, "sub"),
	}); err == nil {
		t.Fatal("expected destination-inside-source to be rejected")
	}
	// 删除不接受目标
	if _, err := m.Create(CreateParams{Kind: KindDelete, FromPaths: []string{src}, ToPath: dir}); err == nil {
		t.Fatal("expected delete with destination to be rejected")
	}
}

// TestRetryOnlyFailedItems 验证重试只挑失败 / 冲突项，且不成功项不会被重复处理。
func TestRetryOnlyFailedItems(t *testing.T) {
	dir := t.TempDir()
	okSrc := filepath.Join(dir, "src", "ok.txt")
	badSrc := filepath.Join(dir, "src", "bad.txt")
	dst := filepath.Join(dir, "dst")
	write(t, okSrc, "ok")
	write(t, badSrc, "bad")

	// 让 bad.txt 复制必失败：目标是同名目录（file-vs-dir 冲突且策略为 ask）
	if err := os.MkdirAll(filepath.Join(dst, "bad.txt"), 0755); err != nil {
		t.Fatal(err)
	}

	m, events := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{
		Kind:       KindCopy,
		FromPaths:  []string{okSrc, badSrc},
		ToPath:     dst,
		OnConflict: fileops.PolicyAsk,
	})
	if err != nil {
		t.Fatal(err)
	}
	conflict := waitFor(t, events, EventConflict, snap.ID)
	if conflict.Conflict == nil || conflict.Conflict.TotalCount != 1 {
		t.Fatalf("expected exactly the bad.txt conflict, got %+v", conflict.Conflict)
	}
	// 只对冲突项选 skip，bad.txt 会以 skipped 收尾，ok.txt 正常复制
	if err := m.Resolve(snap.ID, ResolveRequest{Policy: fileops.PolicySkip, ApplyToAll: true}); err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("expected succeeded, got %s (%s)", done.Task.State, done.Task.Error)
	}
	if done.Task.Stats.Skipped != 1 {
		t.Fatalf("expected 1 skipped, got %+v", done.Task.Stats)
	}

	// 跳过的项不属于「失败」，所以没有可重试的内容
	if _, err := m.Retry(snap.ID); err == nil {
		t.Fatal("skipped items must not be retried")
	}
}

// TestRetryRecreatesFailedTask 先制造一次真实失败，再重试。
//
// 失败用「目标是一个文件」制造，而不是 chmod 0500：目录权限在 Windows 上不生效
// （os.Geteuid 返回 -1、只读目录照样能写文件），用权限做夹具会让这条用例在 Windows 上
// 拿到一个 succeeded 的任务，从而完全测不到重试路径。目标位置上有个**文件**时写入必定失败，
// 之后把它换成目录，重试就必须成功——「先失败后成功」正是这条用例要的两种状态。
func TestRetryRecreatesFailedTask(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "content")

	m, events := newTestManager(t, 50*time.Millisecond)

	// dst 本该是目录，先放一个同名文件，让复制没法落盘
	if err := os.WriteFile(dst, []byte("not a directory"), 0644); err != nil {
		t.Fatal(err)
	}

	snap, err := m.Create(CreateParams{Kind: KindCopy, FromPaths: []string{src}, ToPath: dst, OnConflict: fileops.PolicyAsk})
	if err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateFailed {
		t.Fatalf("expected failed, got %s", done.Task.State)
	}

	// 修好目标（文件换成目录）后重试，应当用失败项建出一个新任务并成功
	if err := os.Remove(dst); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	retried, err := m.Retry(snap.ID)
	if err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if retried.ID == snap.ID {
		t.Fatal("retry must create a new task")
	}
	// 快照里的路径是 canonical 形态（"/"）：前端持有的就是这种路径，
	// 回给它 OS 形态（Windows 上的 "\"）会让它一个都对不上。
	if len(retried.FromPaths) != 1 || retried.FromPaths[0] != filepath.ToSlash(src) {
		t.Fatalf("unexpected retry sources: %v（期望 %q）", retried.FromPaths, filepath.ToSlash(src))
	}
	done2 := waitFor(t, events, EventDone, retried.ID)
	if done2.Task.State != StateSucceeded {
		t.Fatalf("expected retry to succeed, got %s (%s)", done2.Task.State, done2.Task.Error)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "content" {
		t.Fatalf("unexpected content %q", got)
	}
}

// TestCreateResolvesPathsToCanonical 锁定任务层与前端共用的路径形态。
//
// 前端发过来的是 canonical 路径（恒用 "/"），它拿回来的 fromPaths / toPath 也必须
// 是 canonical。中间存 OS 形态的话，Windows 上回给前端的是 "\" 路径，
// 前端按路径匹配的列表补丁会一条都命不中。
func TestCreateResolvesPathsToCanonical(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "x")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	m, _ := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{
		Kind:      KindCopy,
		FromPaths: []string{src},
		ToPath:    dst,
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.ToSlash(src); snap.FromPaths[0] != want {
		t.Errorf("fromPaths[0] = %q，期望 canonical 形态 %q", snap.FromPaths[0], want)
	}
	if want := filepath.ToSlash(dst); snap.ToPath != want {
		t.Errorf("toPath = %q，期望 canonical 形态 %q", snap.ToPath, want)
	}
}

// 非法路径必须在建任务时就报错，而不是等执行到一半才失败。
func TestCreateRejectsBadPaths(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	m, _ := newTestManager(t, time.Minute)
	for _, bad := range []string{"relative/file.txt", "/a/../../etc/passwd"} {
		if _, err := m.Create(CreateParams{
			Kind:      KindCopy,
			FromPaths: []string{bad},
			ToPath:    dst,
		}); err == nil {
			t.Errorf("非法源路径 %q 应当在建任务时被拒", bad)
		}
	}
	if _, err := m.Create(CreateParams{
		Kind:      KindCopy,
		FromPaths: []string{filepath.Join(dir, "missing.txt")},
		ToPath:    "relative/dest",
	}); err == nil {
		t.Error("非法目标路径应当在建任务时被拒")
	}
}

// TestCreateBroadcastsFullSnapshot 锁住一个曾让前端完全看不到任务的 bug：
// 客户端只通过 snapshot / created 认识任务，如果 created 没带完整快照，
// 后续的 update / done 都会因为「查无此任务」被丢掉，任务行永远不会出现。
func TestCreateBroadcastsFullSnapshot(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "x")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}

	m, events := newTestManager(t, time.Minute)
	if _, err := m.Create(CreateParams{
		Kind:      KindCopy,
		FromPaths: []string{src},
		ToPath:    dst,
	}); err != nil {
		t.Fatal(err)
	}

	created := waitFor(t, events, EventCreated, "")
	if created.Task.ID == "" {
		t.Fatal("created event must carry the task id")
	}
	if created.Task.Kind != KindCopy {
		t.Fatalf("created event must carry the kind, got %q", created.Task.Kind)
	}
	if len(created.Task.FromPaths) != 1 {
		t.Fatalf("created event must carry the sources, got %v", created.Task.FromPaths)
	}
	if created.Task.State != StateQueued {
		t.Fatalf("expected the snapshot to be queued, got %s", created.Task.State)
	}
}

// TestInPlaceCopyDoesNotAskForConflict 原地粘贴不该让任务停在等待决策上。
// 如果扫描阶段把它当成冲突，任务会暂停到 TTL 超时，这里的 done 就等不到。
func TestInPlaceCopyDoesNotAskForConflict(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	write(t, src, "alpha")

	m, events := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{
		Kind:       KindCopy,
		FromPaths:  []string{src},
		ToPath:     dir,
		OnConflict: fileops.PolicyAsk,
	})
	if err != nil {
		t.Fatal(err)
	}

	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("expected succeeded, got %s (%s)", done.Task.State, done.Task.Error)
	}
	if !fileops.ExistsAt(filepath.Join(dir, "a - Copy.txt")) {
		t.Fatal("expected an in-place copy to produce \"a - Copy.txt\"")
	}
	if read(t, src) != "alpha" {
		t.Fatal("the original must be untouched")
	}
}

func TestCompressHidesPasswordAndWritesZip(t *testing.T) {
	sevenzip.ForceBinaryForTest("7z")
	t.Cleanup(func() {
		sevenzip.ResetProbeForTest()
		sevenzip.SetRunnerForTest(nil)
	})
	var args []string
	sevenzip.SetRunnerForTest(func(_ context.Context, _ string, _ string, got []string, onPercent func(int)) (int, string, error) {
		args = append([]string(nil), got...)
		if onPercent != nil {
			onPercent(100)
		}
		for _, arg := range got {
			if strings.HasPrefix(arg, "-") || strings.HasPrefix(arg, "@") {
				continue
			}
			if strings.HasSuffix(strings.ToLower(arg), ".zip") {
				if err := os.WriteFile(arg, []byte("PK"), 0o644); err != nil {
					return 1, "", err
				}
			}
		}
		return 0, "", nil
	})

	dir := t.TempDir()
	src := filepath.Join(dir, "a.txt")
	write(t, src, "hello")
	dest := filepath.Join(dir, "a.txt.zip")

	m, events := newTestManager(t, time.Minute)
	snap, err := m.Create(CreateParams{
		Kind:       KindCompress,
		FromPaths:  []string{src},
		ToPath:     dest,
		Password:   "secret",
		OnConflict: fileops.PolicyOverwrite,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret") {
		t.Fatalf("password leaked into snapshot: %s", raw)
	}

	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateSucceeded {
		t.Fatalf("state = %s (%s)", done.Task.State, done.Task.Error)
	}
	doneRaw, _ := json.Marshal(done.Task)
	if strings.Contains(string(doneRaw), "secret") {
		t.Fatalf("password leaked into done event: %s", doneRaw)
	}
	if !fileops.ExistsAt(dest) {
		t.Fatal("expected the zip to be published")
	}
	if !containsArg(args, "-psecret") || containsArg(args, "secret") {
		t.Fatalf("password must be one -p argument: %#v", args)
	}
	if !containsArg(args, "-tzip") || !containsArg(args, "-bsp2") {
		t.Fatalf("args = %#v", args)
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
