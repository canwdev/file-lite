//go:build !windows

package fileops

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type copyRun struct {
	results []ItemResult
	err     error
}

// A named pipe has no byte stream to copy, and os.Open would block on it until a
// writer appears — the wait happens inside open, so ctx cancellation cannot break
// it. The item must fail fast instead of pinning a copy goroutine and one of the
// file-concurrency slots; a pinned goroutine also keeps Manager.Stop waiting on
// its WaitGroup forever.
func TestCopyNamedPipeFailsInsteadOfBlocking(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	writeFile(t, filepath.Join(src, "keep.txt"), []byte("keep"))
	if err := unix.Mkfifo(filepath.Join(src, "pipe"), 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}

	done := make(chan copyRun, 1)
	go func() {
		results, err := NewEngine().Run(context.Background(), Options{
			FromPaths: []string{src},
			ToPath:    dst,
			Policy:    PolicyOverwrite,
		}, Callbacks{})
		done <- copyRun{results: results, err: err}
	}()

	select {
	case run := <-done:
		if run.err != nil {
			t.Fatalf("Run: %v", run.err)
		}
		if got := statuses(run.results); got[string(StatusCopied)] != 1 || got[string(StatusFailed)] != 1 {
			t.Fatalf("statuses = %v, want 1 copied and 1 failed", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("copy blocked on the named pipe")
	}

	if got := readFile(t, filepath.Join(dst, "src", "keep.txt")); got != "keep" {
		t.Fatalf("regular file was not copied: %q", got)
	}
	if ExistsAt(filepath.Join(dst, "src", "pipe")) {
		t.Fatal("the named pipe must not appear in the destination")
	}
	assertNoTempFiles(t, filepath.Join(dst, "src"))
}
