package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

// newUploadServer 注册上传（PUT content）与存在性预检（POST entry-queries）两个端点。
// 不加载 config：路径不再有访问范围限制，测试直接用 t.TempDir() 下的绝对路径。
func newUploadServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	fs := e.Group("/api/fs")
	fs.PUT("/content/*", putContent)
	fs.POST("/entry-queries", queryEntries)
	return e
}

// putContentRequest 发一个 PUT /api/fs/content/{path}，请求体就是文件字节本身。
//
// onConflict 用新契约表达同名策略（docs/design/api.md §6）：
//   - "" / "overwrite"  不带前置条件：覆盖已存在文件，不存在则新建
//   - "error"           If-None-Match: *，只新建；已存在回 412
//   - "keep-both"       ?onConflict=keep-both，已存在时改写成 "name (1).ext"
func putContentRequest(t *testing.T, e *echo.Echo, path, content, onConflict string) *httptest.ResponseRecorder {
	t.Helper()
	target := encodedEntryURL("/api/fs/content", filepath.ToSlash(path))
	if onConflict == "keep-both" {
		target += "?onConflict=keep-both"
	}
	req := httptest.NewRequest(http.MethodPut, target, strings.NewReader(content))
	req.Header.Set(echo.HeaderContentType, "application/octet-stream")
	if onConflict == "error" {
		req.Header.Set("If-None-Match", "*")
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func existsRequest(t *testing.T, e *echo.Echo, paths []string) map[string][]string {
	t.Helper()
	body, err := json.Marshal(map[string][]string{"paths": paths})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/fs/entry-queries", strings.NewReader(string(body)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	var out map[string][]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
	}
	return out
}

func readText(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// TestUploadCreateOnlyPreconditionRefusesToOverwrite 是这条契约的核心：
// 「别覆盖我的文件」由标准前置条件 If-None-Match: * 表达，命中时回 412 而不是静默截断。
func TestUploadCreateOnlyPreconditionRefusesToOverwrite(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	rec := putContentRequest(t, e, target, "replacement", "error")
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, target); got != "original" {
		t.Fatalf("existing file must be untouched, got %q", got)
	}
	// 冲突时不能留下临时文件
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".fl-part-") {
			t.Fatalf("leftover temp file: %s", entry.Name())
		}
	}
}

func TestUploadOverwriteReplaces(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	rec := putContentRequest(t, e, target, "replacement", "overwrite")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, target); got != "replacement" {
		t.Fatalf("expected replacement, got %q", got)
	}
}

func TestUploadKeepBothRenames(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	rec := putContentRequest(t, e, target, "incoming", "keep-both")
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["name"] != "a (1).txt" {
		t.Fatalf("expected renamed upload, got %v", body["name"])
	}
	if got := readText(t, target); got != "original" {
		t.Fatalf("existing file must be untouched, got %q", got)
	}
	if got := readText(t, filepath.Join(dir, "a (1).txt")); got != "incoming" {
		t.Fatalf("unexpected renamed content %q", got)
	}
}

func TestUploadFreshFileStillWorks(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "fresh.txt")

	e := newUploadServer()
	rec := putContentRequest(t, e, target, "hello", "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, target); got != "hello" {
		t.Fatalf("unexpected content %q", got)
	}
}

func TestUploadRejectsReservedTempName(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, ".fl-part-evil")

	e := newUploadServer()
	rec := putContentRequest(t, e, target, "x", "overwrite")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// 文件名中间的点是合法的：这个名字里有两连点，曾经被 ".." 检查一概拒绝，
// 报 Invalid filename，文件根本传不上来。
func TestUploadAcceptsDotsInsideFilename(t *testing.T) {
	const name = "176. ONE OK ROCK - C.h.a.o.s.m.y.t.h..mp3"
	dir := t.TempDir()

	e := newUploadServer()
	rec := putContentRequest(t, e, filepath.Join(dir, name), "audio", "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, filepath.Join(dir, name)); got != "audio" {
		t.Fatalf("unexpected content %q", got)
	}
}

// 直接盯住文件名清洗本身：名字中间的点合法，纯点名和带分隔符的名字必须拒绝。
func TestSanitizeUploadFilename(t *testing.T) {
	accepted := map[string]string{
		"176. ONE OK ROCK - C.h.a.o.s.m.y.t.h..mp3": "176. ONE OK ROCK - C.h.a.o.s.m.y.t.h..mp3",
		"..hidden.txt":     "..hidden.txt",
		"a..b":             "a..b",
		"ends with dots..": "ends with dots_",
	}
	for name, want := range accepted {
		got, err := sanitizeUploadFilename(name)
		if err != nil {
			t.Errorf("%q must be accepted: %v", name, err)
			continue
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", name, got, want)
		}
	}
	for _, name := range []string{"", ".", "..", "a/b", `a\b`, "sub/../evil.txt", `..\evil.txt`} {
		if got, err := sanitizeUploadFilename(name); err == nil {
			t.Errorf("%q must be rejected, got %q", name, got)
		}
	}
}

func TestEntryQueriesReportsOnlyExisting(t *testing.T) {
	dir := t.TempDir()
	present := filepath.Join(dir, "present.txt")
	missing := filepath.Join(dir, "missing.txt")
	if err := os.WriteFile(present, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	out := existsRequest(t, e, []string{filepath.ToSlash(present), filepath.ToSlash(missing)})
	if len(out["existing"]) != 1 || out["existing"][0] != filepath.ToSlash(present) {
		t.Fatalf("expected only the present path, got %v", out["existing"])
	}
}

// TestStartTaskManagerDoesNotDeadlock 锁住一个曾经把服务端启动整个卡死的 bug：
// startTaskManager 持有 taskManagerMu 时又调用了同样加锁的函数。
// 现在全局可变状态只剩 taskManager 本身，但这道保险留着——
// 启动路径一旦死锁，整个服务起不来，代价太大。
func TestStartTaskManagerDoesNotDeadlock(t *testing.T) {
	done := make(chan struct{})
	go func() {
		startTaskManager()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("startTaskManager deadlocked")
	}
	if currentTaskManager() == nil {
		t.Fatal("task manager should be available after start")
	}
	stopTaskManager()
}
