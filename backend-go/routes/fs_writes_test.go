package routes

import (
	"encoding/json"
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

func restRequest(t *testing.T, e *echo.Echo, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) apierr.Payload {
	t.Helper()
	var payload apierr.Payload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("错误响应不是 JSON 对象（%v）：%s", err, rec.Body.String())
	}
	return payload
}

func TestPutDirectoryCreatesAndIsIdempotent(t *testing.T) {
	base := t.TempDir()
	dir := filepath.ToSlash(filepath.Join(base, "a", "b"))
	target := encodedEntryURL("/api/fs/directories", dir)

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut, target, "", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("首次创建 status = %d，期望 201：%s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(base, "a", "b")); err != nil {
		t.Fatalf("目录没有真的建出来：%v", err)
	}

	again := restRequest(t, e, http.MethodPut, target, "", nil)
	if again.Code != http.StatusOK {
		t.Fatalf("已存在时 status = %d，期望 200：%s", again.Code, again.Body.String())
	}
}

func TestPutDirectoryOnFileIsConflict(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut, encodedEntryURL("/api/fs/directories", filepath.ToSlash(file)), "", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
}

func TestPatchEntryRenamesOnly(t *testing.T) {
	dir := t.TempDir()
	from := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(from, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPatch,
		encodedEntryURL("/api/fs/entries", filepath.ToSlash(from)), `{"name":"b.txt"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); err != nil {
		t.Fatalf("新名字不存在：%v", err)
	}
	if _, err := os.Stat(from); !os.IsNotExist(err) {
		t.Fatal("旧名字仍然存在")
	}

	// 名字里带分隔符：这是改名，不是移动。
	to := filepath.Join(dir, "b.txt")
	bad := restRequest(t, e, http.MethodPatch,
		encodedEntryURL("/api/fs/entries", filepath.ToSlash(to)), `{"name":"../evil.txt"}`, nil)
	if bad.Code != http.StatusBadRequest || decodeError(t, bad).Code != apierr.CodeInvalidName {
		t.Fatalf("带分隔符的名字应回 400 invalid_name：%d %s", bad.Code, bad.Body.String())
	}
}

func TestPatchEntryConflict(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPatch,
		encodedEntryURL("/api/fs/entries", filepath.ToSlash(filepath.Join(dir, "a.txt"))), `{"name":"b.txt"}`, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
}

func TestPutContentCreatesThenReplaces(t *testing.T) {
	dir := t.TempDir()
	file := filepath.ToSlash(filepath.Join(dir, "a.txt"))
	target := encodedEntryURL("/api/fs/content", file)

	e := newRESTTestServer()
	created := restRequest(t, e, http.MethodPut, target, "hello", nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("首次写入 status = %d，期望 201：%s", created.Code, created.Body.String())
	}
	if location := created.Header().Get("Location"); location != "/api/fs/content/"+url.PathEscape(file) {
		t.Fatalf("Location = %q", location)
	}
	if body, _ := os.ReadFile(filepath.FromSlash(file)); string(body) != "hello" {
		t.Fatalf("落盘内容 = %q", body)
	}

	replaced := restRequest(t, e, http.MethodPut, target, "world", nil)
	if replaced.Code != http.StatusOK {
		t.Fatalf("覆盖写入 status = %d，期望 200：%s", replaced.Code, replaced.Body.String())
	}
	if body, _ := os.ReadFile(filepath.FromSlash(file)); string(body) != "world" {
		t.Fatalf("覆盖后内容 = %q", body)
	}
}

func TestPutContentPreconditions(t *testing.T) {
	dir := t.TempDir()
	file := filepath.ToSlash(filepath.Join(dir, "a.txt"))
	target := encodedEntryURL("/api/fs/content", file)

	e := newRESTTestServer()
	// 只新建：文件不存在时成功。
	created := restRequest(t, e, http.MethodPut, target, "one", map[string]string{"If-None-Match": "*"})
	if created.Code != http.StatusCreated {
		t.Fatalf("If-None-Match:* 首次写入 status = %d：%s", created.Code, created.Body.String())
	}
	// 文件已存在：412 且内容是原来的。
	conflict := restRequest(t, e, http.MethodPut, target, "two", map[string]string{"If-None-Match": "*"})
	if conflict.Code != http.StatusPreconditionFailed {
		t.Fatalf("If-None-Match:* 冲突 status = %d，期望 412：%s", conflict.Code, conflict.Body.String())
	}
	if decodeError(t, conflict).Code != apierr.CodePreconditionFailed {
		t.Fatalf("错误码不对：%s", conflict.Body.String())
	}
	if body, _ := os.ReadFile(filepath.FromSlash(file)); string(body) != "one" {
		t.Fatalf("412 之后文件不该被改动：%q", body)
	}

	// If-Match：版本一致才覆盖。
	head := requestREST(t, e, http.MethodHead, target)
	etag := head.Header().Get("ETag")
	if etag == "" {
		t.Fatal("HEAD 必须带 ETag")
	}
	ok := restRequest(t, e, http.MethodPut, target, "three", map[string]string{"If-Match": etag})
	if ok.Code != http.StatusOK {
		t.Fatalf("If-Match 命中 status = %d，期望 200：%s", ok.Code, ok.Body.String())
	}
	stale := restRequest(t, e, http.MethodPut, target, "four", map[string]string{"If-Match": etag})
	if stale.Code != http.StatusPreconditionFailed {
		t.Fatalf("过期 If-Match status = %d，期望 412：%s", stale.Code, stale.Body.String())
	}
	if body, _ := os.ReadFile(filepath.FromSlash(file)); string(body) != "three" {
		t.Fatalf("过期 If-Match 之后文件不该被改动：%q", body)
	}
}

func TestPutContentKeepBoth(t *testing.T) {
	dir := t.TempDir()
	file := filepath.ToSlash(filepath.Join(dir, "a.txt"))
	if err := os.WriteFile(filepath.FromSlash(file), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut,
		encodedEntryURL("/api/fs/content", file)+"?onConflict=keep-both", "incoming", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d，期望 201：%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Name != "a (1).txt" {
		t.Fatalf("保留两者应改名为 a (1).txt，得到 %q：%s", payload.Name, rec.Body.String())
	}
	if body, _ := os.ReadFile(filepath.FromSlash(file)); string(body) != "original" {
		t.Fatalf("原文件被覆盖了：%q", body)
	}
	if body, _ := os.ReadFile(filepath.Join(dir, "a (1).txt")); string(body) != "incoming" {
		t.Fatalf("新文件内容不对：%q", body)
	}
}

// 父目录不存在就是 404：PUT 不隐式造目录，文件夹上传由前端先建目录。
func TestPutContentMissingParent(t *testing.T) {
	dir := t.TempDir()
	file := filepath.ToSlash(filepath.Join(dir, "missing", "a.txt"))

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut, encodedEntryURL("/api/fs/content", file), "x", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d，期望 404：%s", rec.Code, rec.Body.String())
	}
	if decodeError(t, rec).Code != apierr.CodePathNotFound {
		t.Fatalf("错误码不对：%s", rec.Body.String())
	}
}

func TestPutContentOnDirectoryIsConflict(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatal(err)
	}

	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut, encodedEntryURL("/api/fs/content", filepath.ToSlash(sub)), "x", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
}

func TestQueryEntries(t *testing.T) {
	dir := t.TempDir()
	present := filepath.ToSlash(filepath.Join(dir, "yes.txt"))
	if err := os.WriteFile(filepath.FromSlash(present), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	absent := filepath.ToSlash(filepath.Join(dir, "no.txt"))

	e := newRESTTestServer()
	payload, err := json.Marshal(map[string]any{"paths": []string{present, absent}})
	if err != nil {
		t.Fatal(err)
	}
	rec := restRequest(t, e, http.MethodPost, "/api/fs/entry-queries", string(payload), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d：%s", rec.Code, rec.Body.String())
	}
	var parsed struct {
		Existing []string `json:"existing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Existing) != 1 || parsed.Existing[0] != present {
		t.Fatalf("existing = %v，期望只有 %q", parsed.Existing, present)
	}
}
