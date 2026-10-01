package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
)

// newRESTTestServer 注册 REST 文件路由（不带认证中间件），用于契约测试。
func newRESTTestServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	e.GET("/api/volumes", getDrives)
	fs := e.Group("/api/fs")
	fs.GET("/directories/*", listDirectory)
	fs.PUT("/directories/*", putDirectory)
	fs.GET("/entries/*", getEntry)
	fs.PATCH("/entries/*", patchEntry)
	fs.POST("/entry-queries", queryEntries)
	fs.GET("/content/*", getContent)
	fs.HEAD("/content/*", getContent)
	fs.PUT("/content/*", putContent)
	fs.GET("/downloads", getDownloads)
	return e
}

// encodedEntryURL 按契约把 canonical 路径编码进 URL：整个路径段百分号编码，
// 因此路径里的 "/" 不会变成目录分隔符。
func encodedEntryURL(base, path string) string {
	return base + "/" + url.PathEscape(path)
}

func requestREST(t *testing.T, e *echo.Echo, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func decodeList(t *testing.T, rec *httptest.ResponseRecorder) listResponse {
	t.Helper()
	return decodeListBody(t, rec.Body.Bytes())
}

func decodeListBody(t *testing.T, body []byte) listResponse {
	t.Helper()
	var parsed listResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("列表响应不是 JSON 对象（%v）：%s", err, body)
	}
	return parsed
}

func TestListDirectoryShape(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}

	parsed := decodeList(t, rec)
	if parsed.Path != filepath.ToSlash(dir) {
		t.Errorf("path = %q，期望 %q", parsed.Path, filepath.ToSlash(dir))
	}
	if parsed.Total != 2 || len(parsed.Entries) != 2 {
		t.Fatalf("total=%d entries=%d，期望各 2：%s", parsed.Total, len(parsed.Entries), rec.Body.String())
	}
	if parsed.Limit != listDefaultLimit {
		t.Errorf("limit = %d，期望默认值 %d", parsed.Limit, listDefaultLimit)
	}
	for _, entry := range parsed.Entries {
		want := filepath.ToSlash(filepath.Join(dir, entry.Name))
		if entry.Path != want {
			t.Errorf("%s 的 path = %q，期望 %q", entry.Name, entry.Path, want)
		}
		if strings.Contains(entry.Path, "%") {
			t.Errorf("path 不该带百分号编码：%q", entry.Path)
		}
	}
}

// 带空格与中文的目录名必须能通过 URL 段原样到达 handler。
func TestListDirectoryEncodedPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "空 格 dir")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a b.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}
	parsed := decodeList(t, rec)
	if parsed.Path != filepath.ToSlash(dir) || parsed.Total != 1 {
		t.Fatalf("path=%q total=%d：%s", parsed.Path, parsed.Total, rec.Body.String())
	}
}

func TestListDirectoryPagination(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt", "e.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	e := newRESTTestServer()
	target := encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir)) + "?offset=2&limit=2"
	parsed := decodeList(t, requestREST(t, e, http.MethodGet, target))

	if parsed.Total != 5 {
		t.Errorf("total = %d，期望 5", parsed.Total)
	}
	if parsed.Offset != 2 || parsed.Limit != 2 {
		t.Errorf("offset/limit = %d/%d，期望 2/2", parsed.Offset, parsed.Limit)
	}
	if len(parsed.Entries) != 2 {
		t.Fatalf("本页条目数 = %d，期望 2", len(parsed.Entries))
	}

	// 越过末尾：200 + 空页，而不是错误。
	parsed = decodeList(t, requestREST(t, e, http.MethodGet,
		encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir))+"?offset=99"))
	if parsed.Total != 5 || len(parsed.Entries) != 0 {
		t.Fatalf("越界页应当为空但保留 total=%d", parsed.Total)
	}
}

// 非递归列表始终带隐藏项（由前端过滤），showHidden 只影响递归遍历。
func TestListDirectoryHiddenStaysInFlatList(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".secret"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	parsed := decodeList(t, requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir))))
	if parsed.Total != 1 || !parsed.Entries[0].Hidden {
		t.Fatalf("隐藏项应当保留并标记 hidden：%+v", parsed.Entries)
	}
}

func TestListDirectoryRecursiveShape(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "a", "b"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a", "b", "two.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	target := encodedEntryURL("/api/fs/directories", filepath.ToSlash(dir)) + "?recursive=1"
	parsed := decodeList(t, requestREST(t, e, http.MethodGet, target))

	if parsed.Total != 1 || len(parsed.Entries) != 1 {
		t.Fatalf("递归列表应当只有 1 个文件：%s", rec2String(parsed))
	}
	entry := parsed.Entries[0]
	if entry.Name != "two.txt" {
		t.Errorf("name = %q，期望 basename two.txt", entry.Name)
	}
	if entry.RelativePath != "a/b/two.txt" {
		t.Errorf("relativePath = %q，期望 a/b/two.txt", entry.RelativePath)
	}
	if entry.Path != filepath.ToSlash(filepath.Join(dir, "a", "b", "two.txt")) {
		t.Errorf("path = %q 不是 canonical 完整路径", entry.Path)
	}
}

func TestListDirectoryOnFileIsConflict(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/directories", filepath.ToSlash(file)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
	var payload apierr.Payload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != apierr.CodeConflict {
		t.Fatalf("code = %q，期望 %q", payload.Code, apierr.CodeConflict)
	}
}

func TestGetEntryShape(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/entries", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}
	var parsed struct {
		Path  string      `json:"path"`
		Entry interface{} `json:"entry"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是对象：%s", rec.Body.String())
	}
	if parsed.Path != filepath.ToSlash(file) || parsed.Entry == nil {
		t.Fatalf("响应缺少 path/entry：%s", rec.Body.String())
	}

	missing := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/entries", filepath.ToSlash(filepath.Join(dir, "nope.txt"))))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("缺失路径 status = %d，期望 404", missing.Code)
	}
}

func TestContentConditionalAndRange(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	target := encodedEntryURL("/api/fs/content", filepath.ToSlash(file))

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, target)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("content 响应必须带 ETag")
	}
	if rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("Accept-Ranges = %q，期望 bytes", rec.Header().Get("Accept-Ranges"))
	}
	if body, _ := io.ReadAll(rec.Body); string(body) != "0123456789" {
		t.Fatalf("body = %q", body)
	}

	// 条件请求：命中 304。
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("If-None-Match", etag)
	rec304 := httptest.NewRecorder()
	e.ServeHTTP(rec304, req)
	if rec304.Code != http.StatusNotModified {
		t.Fatalf("If-None-Match 命中应返回 304，得到 %d", rec304.Code)
	}

	// Range：媒体拖动依赖它。
	req = httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Range", "bytes=0-3")
	recRange := httptest.NewRecorder()
	e.ServeHTTP(recRange, req)
	if recRange.Code != http.StatusPartialContent {
		t.Fatalf("Range 请求应返回 206，得到 %d", recRange.Code)
	}
	if body, _ := io.ReadAll(recRange.Body); string(body) != "0123" {
		t.Fatalf("Range body = %q，期望 0123", body)
	}
}

// 目录不能用 content 端点下载：这是 409，不是 404——路径存在，只是类型不对。
func TestContentOnDirectoryIsConflict(t *testing.T) {
	dir := t.TempDir()
	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(dir)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
}

func TestContentAttachmentDisposition(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a b.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet,
		encodedEntryURL("/api/fs/content", filepath.ToSlash(file))+"?disposition=attachment")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	disposition := rec.Header().Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment") {
		t.Fatalf("Content-Disposition = %q，期望 attachment", disposition)
	}
	if !strings.Contains(disposition, "filename*=UTF-8''a%20b.txt") {
		t.Fatalf("附件名没有按 RFC 5987 编码：%q", disposition)
	}
}

// 单选下载：文件直接给字节，目录才打包。下载按钮并不知道目标是哪种，
// 所以这个判断必须在服务端做（曾经单选目录被当成文件，直接 409）。
func TestDownloadsSingleFileOrDirectory(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()

	fileRec := requestREST(t, e, http.MethodGet, "/api/fs/downloads?paths="+url.QueryEscape(filepath.ToSlash(file)))
	if fileRec.Code != http.StatusOK {
		t.Fatalf("单文件下载 status = %d，期望 200：%s", fileRec.Code, fileRec.Body.String())
	}
	if got := fileRec.Header().Get("Content-Type"); strings.Contains(got, "zip") {
		t.Fatalf("单文件不该被压成 zip，Content-Type = %q", got)
	}
	if body, _ := io.ReadAll(fileRec.Body); string(body) != "hello" {
		t.Fatalf("单文件下载内容 = %q", body)
	}
	if disposition := fileRec.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "attachment") {
		t.Fatalf("Content-Disposition = %q，期望 attachment", disposition)
	}

	dirRec := requestREST(t, e, http.MethodGet, "/api/fs/downloads?paths="+url.QueryEscape(filepath.ToSlash(dir)))
	if dirRec.Code != http.StatusOK {
		t.Fatalf("目录下载 status = %d，期望 200：%s", dirRec.Code, dirRec.Body.String())
	}
	if got := dirRec.Header().Get("Content-Type"); !strings.Contains(got, "zip") {
		t.Fatalf("目录应当打包成 zip，Content-Type = %q", got)
	}
}

func rec2String(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}
