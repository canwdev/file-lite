package routes

import (
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

// TestDownloadResolvesSpecialFilenames 锁住一个真实报过的 bug：
// 含 "+" 的文件名下载必然 404，浏览器于是把错误 JSON 存成 download.json。
//
// 根因是下载路径被解码了两次：c.QueryParams() 已经解过一次，代码里又调了一次
// url.QueryUnescape，而第二次解码会把文件名里的 "+" 变成空格。
// 下面用的正是前端 encodeURIComponent 的等价编码——只编码一次。
func TestDownloadResolvesSpecialFilenames(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		"039.+Vexento+-+Borealis.mp3",
		"a b.txt",
		"100%.txt",
		"中文 文件.txt",
	}

	e := echo.New()
	e.GET("/api/files/download", downloadPath)

	for _, name := range names {
		full := filepath.Join(dir, name)
		if err := os.WriteFile(full, []byte("payload"), 0644); err != nil {
			t.Fatal(err)
		}

		target := "/api/files/download?path=" + url.QueryEscape(full)
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d (%s)", name, rec.Code, rec.Body.String())
		}
		if got := rec.Body.String(); got != "payload" {
			t.Fatalf("%s: unexpected body %q", name, got)
		}
		_, params, err := mime.ParseMediaType(rec.Header().Get("Content-Disposition"))
		if err != nil {
			t.Fatalf("%s: unparseable Content-Disposition: %v", name, err)
		}
		if got := params["filename"]; got != name {
			t.Fatalf("%s: browser would save it as %q", name, got)
		}
	}
}

// TestDownloadMultiPartQuery 覆盖多选打包：qs 用 repeat 形式，同样只编码一次。
func TestDownloadMultiPartQuery(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "one+one.txt")
	second := filepath.Join(dir, "two two.txt")
	for _, p := range []string{first, second} {
		if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	e := echo.New()
	e.GET("/api/files/download", downloadPath)
	target := "/api/files/download?paths=" + url.QueryEscape(first) + "&paths=" + url.QueryEscape(second)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("expected a zip, got %q", ct)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, ".zip") {
		t.Fatalf("expected a zip filename, got %q", got)
	}
}
