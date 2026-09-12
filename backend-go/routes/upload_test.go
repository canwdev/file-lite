package routes

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

// newUploadServer 注册上传与存在性检查两个端点。
// 不加载 config，因此 safeBaseDir 为空、IsPathSafe 放行任意路径。
func newUploadServer() *echo.Echo {
	e := echo.New()
	e.POST("/api/files/upload-file", uploadFile)
	e.POST("/api/files/exists", existsPaths)
	return e
}

func uploadRequest(t *testing.T, e *echo.Echo, path, filename, content, onConflict string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	url := "/api/files/upload-file?path=" + path
	if onConflict != "" {
		url += "&onConflict=" + onConflict
	}
	req := httptest.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set(echo.HeaderContentType, writer.FormDataContentType())
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
	req := httptest.NewRequest(http.MethodPost, "/api/files/exists", bytes.NewReader(body))
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

// TestUploadDefaultRefusesToOverwrite 是这次修复的核心：
// 缺省的 onConflict 必须拒绝同名写入，绝不静默截断用户已有的文件。
func TestUploadDefaultRefusesToOverwrite(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	rec := uploadRequest(t, e, target, "a.txt", "replacement", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, target); got != "original" {
		t.Fatalf("existing file must be untouched, got %q", got)
	}
	// 冲突时不能留下临时文件
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if len(entry.Name()) > 9 && entry.Name()[:9] == ".fl-part-" {
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
	rec := uploadRequest(t, e, target, "a.txt", "replacement", "overwrite")
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
	rec := uploadRequest(t, e, target, "a.txt", "incoming", "keep-both")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
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
	rec := uploadRequest(t, e, target, "fresh.txt", "hello", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := readText(t, target); got != "hello" {
		t.Fatalf("unexpected content %q", got)
	}
}

func TestUploadRejectsReservedTempName(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, ".fl-part-evil")

	e := newUploadServer()
	rec := uploadRequest(t, e, target, ".fl-part-evil", "x", "overwrite")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestExistsPathsReportsOnlyExisting(t *testing.T) {
	dir := t.TempDir()
	present := filepath.Join(dir, "present.txt")
	missing := filepath.Join(dir, "missing.txt")
	if err := os.WriteFile(present, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newUploadServer()
	out := existsRequest(t, e, []string{present, missing})
	if len(out["existing"]) != 1 || out["existing"][0] != present {
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
