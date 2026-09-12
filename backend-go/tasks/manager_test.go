package tasks

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"file-lite-go/fileops"
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
	engine := fileops.NewEngine(false)
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

func TestRetryRecreatesFailedTask(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "a.txt")
	dst := filepath.Join(dir, "dst")
	write(t, src, "content")

	m, events := newTestManager(t, 50*time.Millisecond)

	// 先制造一次真实失败：目标目录不可写
	if err := os.MkdirAll(dst, 0500); err != nil {
		t.Fatal(err)
	}
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}

	snap, err := m.Create(CreateParams{Kind: KindCopy, FromPaths: []string{src}, ToPath: dst, OnConflict: fileops.PolicyAsk})
	if err != nil {
		t.Fatal(err)
	}
	done := waitFor(t, events, EventDone, snap.ID)
	if done.Task.State != StateFailed {
		t.Fatalf("expected failed, got %s", done.Task.State)
	}

	// 修好权限后重试，应当用失败项建出一个新任务并成功
	if err := os.Chmod(dst, 0755); err != nil {
		t.Fatal(err)
	}
	retried, err := m.Retry(snap.ID)
	if err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if retried.ID == snap.ID {
		t.Fatal("retry must create a new task")
	}
	if len(retried.FromPaths) != 1 || retried.FromPaths[0] != src {
		t.Fatalf("unexpected retry sources: %v", retried.FromPaths)
	}
	done2 := waitFor(t, events, EventDone, retried.ID)
	if done2.Task.State != StateSucceeded {
		t.Fatalf("expected retry to succeed, got %s (%s)", done2.Task.State, done2.Task.Error)
	}
	if got := read(t, filepath.Join(dst, "a.txt")); got != "content" {
		t.Fatalf("unexpected content %q", got)
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
