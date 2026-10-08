package utils

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestZipPathsToWriterKeepsModTime(t *testing.T) {
	root := t.TempDir()
	fileTime := time.Date(2020, 1, 2, 3, 4, 5, 0, time.Local)
	nestedTime := time.Date(2022, 3, 4, 5, 6, 7, 0, time.Local)
	emptyTime := time.Date(2021, 5, 6, 7, 8, 9, 0, time.Local)

	filePath := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filePath, fileTime, fileTime); err != nil {
		t.Fatal(err)
	}
	nestedDir := filepath.Join(root, "sub")
	if err := os.Mkdir(nestedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	nestedPath := filepath.Join(nestedDir, "nested.txt")
	if err := os.WriteFile(nestedPath, []byte("nested"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(nestedPath, nestedTime, nestedTime); err != nil {
		t.Fatal(err)
	}
	emptyDir := filepath.Join(root, "empty")
	if err := os.Mkdir(emptyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(emptyDir, emptyTime, emptyTime); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := ZipPathsToWriter([]string{root}, &buf); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}

	base := filepath.Base(root)
	want := map[string]time.Time{
		base + "/notes.txt":      fileTime,
		base + "/sub/nested.txt": nestedTime,
		base + "/empty/":         emptyTime,
	}
	if len(zr.File) != len(want) {
		names := make([]string, len(zr.File))
		for i, f := range zr.File {
			names[i] = f.Name
		}
		t.Fatalf("entries = %v, want %d", names, len(want))
	}
	for _, f := range zr.File {
		mod, ok := want[f.Name]
		if !ok {
			t.Errorf("unexpected entry %q", f.Name)
			continue
		}
		if f.Modified.IsZero() {
			t.Errorf("%s has no modification time", f.Name)
			continue
		}
		if f.Modified.Unix() != mod.Unix() {
			t.Errorf("%s modified = %s, want %s", f.Name, f.Modified, mod)
		}
	}
}
