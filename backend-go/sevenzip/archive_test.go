package sevenzip

import (
	"context"
	"strings"
	"testing"
)

func TestParseFormatInfoReads7zExtensions(t *testing.T) {
	sample := `
Formats:
 0 C...F..........c.a.m+.. w...0  7z       7z            7 z BC AF ' 1C
 0  ...F..................  Rar      rar r00       R a r ! 1A 07 00
 0 C...FMG........c.a.m+.. wud.0  zip      zip z01 zipx jar xpi odt ods docx xlsx epub ipa apk appx P K 03 04
 0 CK.................m+.. .u..1  gzip     gz gzip tgz (.tar) tpz (.tar) 1F 8B 08
 0 C......O...LH......m+.. wu.n1  tar      tar ova       offset=257 u s t a r
 0  ......................  Iso      iso img       offset=32769 C D 0 0 1
   CK.....O.....XC........  Hash     sha256 sha1
`
	got := parseFormatInfo(sample)
	joined := strings.Join(got.Extract, " ")
	for _, want := range []string{".7z", ".rar", ".zip", ".xlsx", ".docx", ".gz", ".tgz", ".tar", ".iso"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %s in %v", want, got.Extract)
		}
	}
	if strings.Contains(joined, ".sha256") || strings.Contains(joined, ".(.tar)") {
		t.Fatalf("unexpected extension in %v", got.Extract)
	}
	var ids []string
	for _, format := range got.Compress {
		ids = append(ids, format.ID)
	}
	if strings.Join(ids, " ") != "zip 7z tar gzip" {
		t.Fatalf("compress = %v", ids)
	}
}

func TestSupportedExtractExtPrefersLongest(t *testing.T) {
	exts := []string{".gz", ".tar.gz", ".zip"}
	if !SupportedExtractExt("Foo.TAR.GZ", exts) {
		t.Fatal("expected tar.gz")
	}
	if SupportedExtractExt("notes.txt", exts) {
		t.Fatal("txt is not an archive")
	}
}

func TestProgressWriterAppliesBackspace(t *testing.T) {
	var got []int
	w := &progressWriter{onChange: func(n int) { got = append(got, n) }}
	raw := []byte("  0%\x08\x08\x08\x08 96% 2 + blob.bin")
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 || got[len(got)-1] != 96 {
		t.Fatalf("percents = %v, want last 96", got)
	}
	if strings.Contains(w.Text(), "\b") {
		t.Fatalf("log still has backspaces: %q", w.Text())
	}
}

func TestParseListSLTDropsArchiveRecord(t *testing.T) {
	text := `
Path = /tmp/out.zip
Type = zip

Path = a.txt
Folder = -
Size = 5

Path = dir/b.txt
Folder = -
Size = 2

Path = dir
Folder = +
`
	entries := parseListSLT(text)
	if len(entries) != 3 {
		t.Fatalf("entries = %+v", entries)
	}
	top := TopLevelNames(entries)
	if len(top) != 2 {
		t.Fatalf("top = %+v", top)
	}
	if top[0].Path != "a.txt" || top[0].IsDir {
		t.Fatalf("first = %+v", top[0])
	}
	if top[1].Path != "dir" || !top[1].IsDir {
		t.Fatalf("dir = %+v", top[1])
	}
}

func TestCompressArgsKeepPasswordInOneArg(t *testing.T) {
	args := compressArgs("/tmp/out.zip", "/tmp/list.txt", "zip", "secret")
	joined := strings.Join(args, "\n")
	if strings.Contains(joined, "\nsecret\n") || argsContain(args, "secret") {
		t.Fatalf("password must not be its own argument: %#v", args)
	}
	if !argsContain(args, "-psecret") || !argsContain(args, "-mem=AES256") || !argsContain(args, "-tzip") || !argsContain(args, "-bsp2") {
		t.Fatalf("args = %#v", args)
	}
	if !argsContain(args, "@/tmp/list.txt") {
		t.Fatalf("missing listfile: %#v", args)
	}
}

func TestExtractArgsGlueOutputAndPassword(t *testing.T) {
	args := extractArgs("/tmp/a.zip", "/tmp/dest", "pw", OverwriteSkip, nil)
	if !argsContain(args, "-o/tmp/dest") || !argsContain(args, "-ppw") || !argsContain(args, "-aos") {
		t.Fatalf("args = %#v", args)
	}
	if argsContain(args, "-o") || argsContain(args, "-p") {
		t.Fatalf("split -o/-p would be an empty password: %#v", args)
	}
}

func TestClassifyWrongPassword(t *testing.T) {
	err := classifyRun(context.Background(), 2, "ERROR: Wrong password : a.txt\n", nil, "secret")
	if err != ErrWrongPassword {
		t.Fatalf("got %v", err)
	}
	err = classifyRun(context.Background(), 2, "ERROR: Data Error : a.txt\n", nil, "")
	if err == nil || err == ErrWrongPassword {
		t.Fatalf("corrupt archive must not be a password error: %v", err)
	}
	banner := "7-Zip 25.01 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03\n\nEnter password (will not be echoed):\n"
	err = classifyRun(context.Background(), 255, banner, nil, "")
	if err != ErrPasswordRequired {
		t.Fatalf("missing password: %v", err)
	}
	buried := "7-Zip 25.01 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03\n\nERROR: Data Error : a.txt\n"
	err = classifyRun(context.Background(), 2, buried, nil, "")
	if err == nil || err.Error() != "ERROR: Data Error : a.txt" {
		t.Fatalf("banner hid the reason: %v", err)
	}
}

func argsContain(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}
