package updater

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.6.0", "v1.6.0", 0},
		{"1.6.0", "v1.6.0", 0},
		{"v1.7.0", "v1.6.9", 1},
		{"v1.5.9", "v1.6.0", -1},
		{"v1.6.0", "v1.6.0-pre.50", 1},
		{"v1.6.0-pre.50", "v1.6.0-pre.9", 1},
		{"v1.6.0-pre.2", "v1.6.0-pre.10", -1},
		{"v1.6.0-beta.1", "v1.6.0-alpha.9", 1},
		{"v1.6.0-pre", "v1.6.0-pre.1", -1},
		{"v1.6.0+build.5", "v1.6.0", 0},
	}
	for _, tc := range cases {
		got, err := compareSemver(tc.a, tc.b)
		if err != nil {
			t.Errorf("compareSemver(%q, %q): %v", tc.a, tc.b, err)
			continue
		}
		if got != tc.want {
			t.Errorf("compareSemver(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}

	for _, raw := range []string{"", "1.6", "banana", "v1.6.0-", "v1.6.x"} {
		if _, err := compareSemver(raw, "v1.6.0"); err == nil {
			t.Errorf("compareSemver(%q) should fail", raw)
		}
	}
}

func TestSelectReleaseAsset(t *testing.T) {
	assets := []githubAsset{
		{Name: "file-lite-windows_amd64-v1.6.0.zip", Size: 10},
		{Name: "file-lite-windows_arm64-v1.6.0.zip", Size: 10},
		{Name: "file-lite-linux_amd64-v1.6.0.zip", Size: 10},
	}

	got, err := selectReleaseAsset(assets, "windows", "amd64")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "file-lite-windows_amd64-v1.6.0.zip" {
		t.Fatalf("selected %q", got.Name)
	}

	if _, err := selectReleaseAsset(assets, "darwin", "arm64"); err == nil {
		t.Fatal("a missing platform asset should fail")
	}
	if _, err := selectReleaseAsset(assets, "linux", "arm"); err == nil {
		t.Fatal("an unsupported platform should fail")
	}
	if _, err := selectReleaseAsset(assets, "windows", "386"); err == nil {
		t.Fatal("a missing 386 asset should fail")
	}

	ambiguous := append(assets, githubAsset{Name: "file-lite-windows_amd64-extra.zip", Size: 10})
	if _, err := selectReleaseAsset(ambiguous, "windows", "amd64"); err == nil {
		t.Fatal("two matching assets should fail")
	}

	tooLarge := []githubAsset{{Name: "file-lite-windows_amd64-v1.6.0.zip", Size: maxAssetSize + 1}}
	if _, err := selectReleaseAsset(tooLarge, "windows", "amd64"); err == nil {
		t.Fatal("an oversized asset should fail")
	}
}

func TestPlatformTargetDir(t *testing.T) {
	cases := []struct {
		goos, goarch string
		want         string
		ok           bool
	}{
		{"windows", "amd64", "windows_amd64", true},
		{"linux", "arm64", "linux_arm64", true},
		{"darwin", "amd64", "mac_amd64", true},
		{"darwin", "arm64", "mac_arm64", true},
		{"linux", "386", "", false},
		{"darwin", "386", "", false},
		{"freebsd", "amd64", "", false},
		{"windows", "mips", "", false},
	}
	for _, tc := range cases {
		got, ok := platformTargetDir(tc.goos, tc.goarch)
		if got != tc.want || ok != tc.ok {
			t.Errorf("platformTargetDir(%q, %q) = (%q, %v), want (%q, %v)", tc.goos, tc.goarch, got, ok, tc.want, tc.ok)
		}
	}
}

func TestVerifyAssetDigest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset.zip")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	const digest = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

	if err := verifyAssetDigest(path, digest); err != nil {
		t.Fatalf("matching digest rejected: %v", err)
	}
	if err := verifyAssetDigest(path, "sha256:"+"0"+digest[len("sha256:")+1:]); err == nil {
		t.Fatal("a different digest should fail")
	}
	if err := verifyAssetDigest(path, "md5:deadbeef"); err == nil {
		t.Fatal("a non-sha256 digest should fail")
	}
}

func TestExtractReleaseBinary(t *testing.T) {
	cases := []struct {
		name    string
		entries map[string]string
		want    string
		wantErr bool
	}{
		{
			name:    "flat layout",
			entries: map[string]string{"file-lite-go.exe": "flat", "README.txt": "readme"},
			want:    "flat",
		},
		{
			name:    "nested layout",
			entries: map[string]string{"windows_amd64/file-lite-go.exe": "nested", "windows_amd64/README.txt": "readme"},
			want:    "nested",
		},
		{
			name:    "no binary",
			entries: map[string]string{"README.txt": "readme"},
			wantErr: true,
		},
		{
			name: "two binaries",
			entries: map[string]string{
				"file-lite-go.exe":               "one",
				"windows_amd64/file-lite-go.exe": "two",
			},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			archive := filepath.Join(dir, "release.zip")
			writeTestZip(t, archive, tc.entries)
			dest := filepath.Join(dir, "candidate.exe")

			err := extractReleaseBinary(archive, dest)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(dest)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tc.want {
				t.Fatalf("extracted %q, want %q", got, tc.want)
			}
		})
	}
}

func writeTestZip(t *testing.T, dest string, entries map[string]string) {
	t.Helper()
	file, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}
