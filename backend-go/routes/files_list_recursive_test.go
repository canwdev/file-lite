package routes

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"file-lite-go/types"
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
		filepath.Join(dir, "root.txt"):               "root",
		filepath.Join(dir, "a", "one.txt"):           "one",
		filepath.Join(dir, "a", "b", "two.txt"):      "two",
		filepath.Join(dir, ".hidden", "secret.txt"): "secret",
		filepath.Join(dir, "a", ".skip"):            "skip",
	} {
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}

	e := newFilesServer()
	target := "/api/files/list?path=" + url.QueryEscape(filepath.ToSlash(dir)) + "&recursive=1"
	code, body := getJSON(t, e, target)
	if code != 200 {
		t.Fatalf("recursive list 应返回 200，得到 %d：%s", code, body)
	}
	var entries []types.Entry
	if err := json.Unmarshal(body, &entries); err != nil {
		t.Fatalf("响应不是条目数组: %v", err)
	}
	got := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDirectory {
			t.Fatalf("平铺列表不应包含目录 %q", entry.Name)
		}
		got[entry.Name] = true
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
	entries = nil
	if err := json.Unmarshal(body, &entries); err != nil {
		t.Fatalf("响应不是条目数组: %v", err)
	}
	got = map[string]bool{}
	for _, entry := range entries {
		got[entry.Name] = true
	}
	if !got[".hidden/secret.txt"] || !got["a/.skip"] {
		t.Fatalf("showHidden 应包含隐藏文件，得到 %#v", got)
	}
}
