//go:build !windows

package routes

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Serving a named pipe must be rejected instead of opened: os.Open waits for a
// writer forever and that wait cannot be cancelled, so the handler goroutine and
// its connection would never be released.
func TestContentRejectsNamedPipe(t *testing.T) {
	dir := t.TempDir()
	pipe := filepath.Join(dir, "pipe")
	if err := unix.Mkfifo(pipe, 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}

	e := newRESTTestServer()
	// requestREST never calls t.Fatal, so it is safe on this goroutine; the timeout
	// is what turns a regression (a blocking open) into a clear failure instead of
	// a hung test binary.
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(pipe)))
	}()

	select {
	case rec := <-done:
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("status = %d, want 415: %s", rec.Code, rec.Body.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("content request blocked on the named pipe")
	}
}
