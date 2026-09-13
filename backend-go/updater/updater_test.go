package updater

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"file-lite-go/config"
)

// useExe 把包级 exePath 指向临时目录里的假 exe，让测试不必碰真正在运行的二进制。
func useExe(t *testing.T, exe string) {
	t.Helper()
	prevPath, prevArgs, prevCwd := exePath, exeArgs, exeCwd
	exePath = exe
	exeArgs = []string{exe}
	exeCwd = filepath.Dir(exe)
	t.Cleanup(func() { exePath, exeArgs, exeCwd = prevPath, prevArgs, prevCwd })
}

func TestParseVersion(t *testing.T) {
	cases := []struct {
		out  string
		want string
		ok   bool
	}{
		{out: config.PkgName + " v1.5.0\n", want: "1.5.0", ok: true},
		{out: config.PkgName + " v1.5.0", want: "1.5.0", ok: true},
		{out: "  " + config.PkgName + " v10.20.30  \r\n", want: "10.20.30", ok: true},
		{out: "some-other-tool v1.0.0\n"},
		{out: config.PkgName + " v1.5\n"},
		{out: ""},
	}
	for _, tc := range cases {
		got, ok := parseVersion(tc.out)
		if ok != tc.ok || got != tc.want {
			t.Errorf("parseVersion(%q) = (%q, %v), want (%q, %v)", tc.out, got, ok, tc.want, tc.ok)
		}
	}
}

func TestInstallNeedsKnownExecutable(t *testing.T) {
	useExe(t, "")
	if _, err := Install(strings.NewReader("candidate")); err == nil {
		t.Fatal("Install without a known executable path should fail")
	}
}

// 上传一个根本跑不起来的文件：必须报错，不能动正在运行的二进制，也不能留下候选文件。
func TestInstallRejectsNonRunnableFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "file-lite-go")
	if err := os.WriteFile(target, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	useExe(t, target)

	if _, err := Install(strings.NewReader("definitely not an executable")); err == nil {
		t.Fatal("Install should reject a file that cannot run")
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "old-binary" {
		t.Fatalf("running binary was touched: %q", got)
	}
	if _, err := os.Stat(stagedPath()); !os.IsNotExist(err) {
		t.Fatalf("a rejected candidate must not be left behind (err=%v)", err)
	}
}

func TestCleanupRemovesUpdateLeftovers(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "file-lite-go")
	if err := os.WriteFile(target, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	useExe(t, target)

	unrelated := filepath.Join(dir, "keep-me")
	for _, p := range []string{filepath.Join(dir, ".file-lite-go.old"), stagedPath(), unrelated} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	Cleanup()

	for _, p := range []string{filepath.Join(dir, ".file-lite-go.old"), stagedPath()} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s should have been removed (err=%v)", p, err)
		}
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Errorf("Cleanup removed an unrelated file: %v", err)
	}
}
