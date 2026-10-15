//go:build !windows

package utils

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// os.Open blocks on a named pipe until a writer appears, and nothing cancels that
// wait. Packing a selection (and the pre-flight that runs before the response
// headers) must skip such an entry instead of hanging the download forever.
func TestZipPathsSkipsNamedPipe(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(root, "pipe"), 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		if err := VerifyZipPathsReadable([]string{root}); err != nil {
			done <- fmt.Errorf("pre-flight: %w", err)
			return
		}
		var buf bytes.Buffer
		if err := ZipPathsToWriter([]string{root}, &buf); err != nil {
			done <- err
			return
		}
		zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
		if err != nil {
			done <- err
			return
		}
		names := make([]string, len(zr.File))
		for i, f := range zr.File {
			names[i] = f.Name
		}
		want := filepath.Base(root) + "/keep.txt"
		if len(names) != 1 || names[0] != want {
			done <- fmt.Errorf("entries = %v, want only %q", names, want)
			return
		}
		done <- nil
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("packing blocked on the named pipe")
	}
}
