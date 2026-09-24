package sevenzip

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRealZipRoundTrip(t *testing.T) {
	bin, err := exec.LookPath("7z")
	if err != nil {
		t.Skip("7z is not installed")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(src, []byte("hello-archive"), 0o644); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(dir, "sub")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	part := filepath.Join(nested, ".fl-part-secret")
	if err := os.WriteFile(part, []byte("hidden"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "keep.txt"), []byte("kept"), 0o644); err != nil {
		t.Fatal(err)
	}

	zipPath := filepath.Join(dir, "bundle.zip")
	ctx := context.Background()
	var saw bool
	if err := Compress(ctx, bin, []string{src, nested}, zipPath, FormatZip, "secret", func(int) { saw = true }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(zipPath); err != nil {
		t.Fatal(err)
	}

	out := filepath.Join(dir, "out")
	if err := os.Mkdir(out, 0o755); err != nil {
		t.Fatal(err)
	}
	err = Extract(ctx, bin, zipPath, out, "nope", OverwriteAll, nil, nil)
	if err != ErrWrongPassword {
		t.Fatalf("wrong password: %v", err)
	}
	err = Extract(ctx, bin, zipPath, out, "", OverwriteAll, nil, nil)
	if err != ErrPasswordRequired {
		t.Fatalf("missing password: %v", err)
	}
	if err := Extract(ctx, bin, zipPath, out, "secret", OverwriteAll, nil, nil); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(out, "note.txt"))
	if err != nil || string(body) != "hello-archive" {
		t.Fatalf("note.txt = %q, %v", body, err)
	}
	kept, err := os.ReadFile(filepath.Join(out, "sub", "keep.txt"))
	if err != nil || string(kept) != "kept" {
		t.Fatalf("keep.txt = %q, %v", kept, err)
	}
	if _, err := os.Stat(filepath.Join(out, "sub", ".fl-part-secret")); !os.IsNotExist(err) {
		t.Fatalf("temporary name was archived: %v", err)
	}
	_ = saw
}

func TestRealFormatInfoIncludesXlsx(t *testing.T) {
	bin, err := exec.LookPath("7z")
	if err != nil {
		t.Skip("7z is not installed")
	}
	out, err := exec.Command(bin, "i").Output()
	if err != nil {
		t.Fatal(err)
	}
	info := parseFormatInfo(string(out))
	if !SupportedExtractExt("budget.xlsx", info.Extract) {
		t.Fatalf("xlsx missing from %v", info.Extract)
	}
	format, ok := LookupCompress("zip", info.Compress)
	if !ok || format.Ext != ".zip" || !format.Password {
		t.Fatalf("zip format = %+v ok=%v", format, ok)
	}
	for _, id := range []string{"7z", "tar", "gzip"} {
		if _, ok := LookupCompress(id, info.Compress); !ok {
			t.Fatalf("missing create format %s in %+v", id, info.Compress)
		}
	}
	if strings.Contains(strings.Join(info.Extract, " "), ".sha256") {
		t.Fatal("hash names leaked into extract extensions")
	}
}
