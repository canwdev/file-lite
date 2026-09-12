package fileops

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMeasureTreeCountsFilesFoldersAndBytes(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), []byte("12345"))
	writeFile(t, filepath.Join(root, "b.txt"), []byte("123"))
	writeFile(t, filepath.Join(root, "sub", "c.txt"), []byte("1234567"))
	writeFile(t, filepath.Join(root, "sub", "deep", "d.txt"), []byte("12"))

	got := MeasureTree(context.Background(), root)
	if !got.Complete {
		t.Fatalf("Complete = false, want true")
	}
	if got.Files != 4 {
		t.Errorf("Files = %d, want 4", got.Files)
	}
	if got.Folders != 2 {
		t.Errorf("Folders = %d, want 2 (sub, deep; root itself is excluded)", got.Folders)
	}
	if want := int64(17); got.Bytes != want {
		t.Errorf("Bytes = %d, want %d", got.Bytes, want)
	}
}

func TestMeasureTreeDoesNotFollowSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs extra privileges on Windows")
	}
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "outside.txt"), []byte("1234567890"))

	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), []byte("1"))
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}

	got := MeasureTree(context.Background(), root)
	// 只有 a.txt 与链接本身；链接指向的目录不再下探
	if got.Files != 2 {
		t.Errorf("Files = %d, want 2 (a.txt + link)", got.Files)
	}
	if got.Folders != 0 {
		t.Errorf("Folders = %d, want 0 (link is not traversed)", got.Folders)
	}
	linkInfo, err := os.Lstat(filepath.Join(root, "link"))
	if err != nil {
		t.Fatal(err)
	}
	if want := int64(1) + linkInfo.Size(); got.Bytes != want {
		t.Errorf("Bytes = %d, want %d (a.txt + the link itself, never the target)", got.Bytes, want)
	}
}

func TestMeasureTreeReportsIncompleteOnCancel(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), []byte("1"))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	got := MeasureTree(ctx, root)
	if got.Complete {
		t.Fatalf("Complete = true, want false after cancellation")
	}
}
