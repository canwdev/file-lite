package routes

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListRecursiveFlattensFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "a", "b"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, ".hidden"), 0755); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{
		filepath.Join(dir, "root.txt"):              "root",
		filepath.Join(dir, "a", "one.txt"):          "one",
		filepath.Join(dir, "a", "b", "two.txt"):     "two",
		filepath.Join(dir, ".hidden", "secret.txt"): "secret",
		filepath.Join(dir, "a", ".skip"):            "skip",
	} {
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}

	e := newRESTTestServer()
	// 递归模式：目录自身不出现，name 恒为 basename，相对路径在 relativePath 里。
	target := encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir)) + "?recursive=1"
	code, body := getJSON(t, e, target)
	if code != 200 {
		t.Fatalf("recursive list 应返回 200，得到 %d：%s", code, body)
	}
	parsed := decodeListBody(t, body)
	got := map[string]bool{}
	for _, entry := range parsed.Entries {
		if entry.IsDirectory {
			t.Fatalf("平铺列表不应包含目录 %q", entry.Name)
		}
		got[entry.RelativePath] = true
	}
	for _, name := range []string{"root.txt", "a/one.txt", "a/b/two.txt"} {
		if !got[name] {
			t.Errorf("缺少 %s", name)
		}
	}
	for _, name := range []string{".hidden/secret.txt", "a/.skip", "a", "a/b"} {
		if got[name] {
			t.Errorf("不应出现 %s", name)
		}
	}

	code, body = getJSON(t, e, target+"&showHidden=1")
	if code != 200 {
		t.Fatalf("showHidden recursive list 应返回 200，得到 %d：%s", code, body)
	}
	parsed = decodeListBody(t, body)
	got = map[string]bool{}
	for _, entry := range parsed.Entries {
		got[entry.RelativePath] = true
	}
	if !got[".hidden/secret.txt"] || !got["a/.skip"] {
		t.Fatalf("showHidden 应包含隐藏文件，得到 %#v", got)
	}
}
