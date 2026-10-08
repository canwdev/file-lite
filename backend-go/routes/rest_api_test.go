package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/tasks"
)

// newCommandTestServer 注册任务 / 设置 / 测量这三类命令端点（不带认证中间件）。
func newCommandTestServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())

	e.GET("/api/settings", getSettings)
	e.GET("/api/settings/*", getSetting)
	e.PUT("/api/settings/*", putSetting)
	e.DELETE("/api/settings/*", deleteSetting)

	e.GET("/api/tasks", listTasksAPI)
	e.POST("/api/tasks", createTaskAPI)
	e.GET("/api/tasks/:id", getTaskAPI)
	e.DELETE("/api/tasks/:id", deleteTaskAPI)
	e.POST("/api/tasks/:id/retries", retryTaskAPI)
	e.POST("/api/tasks/:id/resolutions", resolveTaskAPI)

	fs := e.Group("/api/fs")
	fs.POST("/measurements", createMeasurement)
	fs.GET("/measurements/*", getMeasurement)
	fs.DELETE("/measurements/*", deleteMeasurement)

	return e
}

func TestSettingsRESTRoundTrip(t *testing.T) {
	e := newCommandTestServer()
	key := "test.rest.roundtrip"

	// 未设置时回 null，而不是 404：调用方不必把「没设置」当成错误处理。
	unset := restRequest(t, e, http.MethodGet, "/api/settings/"+key, "", nil)
	if unset.Code != http.StatusOK {
		t.Fatalf("未设置的键 status = %d，期望 200：%s", unset.Code, unset.Body.String())
	}
	var unsetPayload struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	}
	if err := json.Unmarshal(unset.Body.Bytes(), &unsetPayload); err != nil {
		t.Fatal(err)
	}
	if unsetPayload.Value != nil {
		t.Fatalf("未设置的键应当回 null，得到 %v", unsetPayload.Value)
	}

	put := restRequest(t, e, http.MethodPut, "/api/settings/"+key, `{"value":{"theme":"dark"}}`, nil)
	if put.Code != http.StatusOK {
		t.Fatalf("PUT status = %d，期望 200：%s", put.Code, put.Body.String())
	}

	get := restRequest(t, e, http.MethodGet, "/api/settings/"+key, "", nil)
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d：%s", get.Code, get.Body.String())
	}
	var getPayload struct {
		Value map[string]any `json:"value"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &getPayload); err != nil {
		t.Fatal(err)
	}
	if getPayload.Value["theme"] != "dark" {
		t.Fatalf("值没写进去：%s", get.Body.String())
	}

	del := restRequest(t, e, http.MethodDelete, "/api/settings/"+key, "", nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d，期望 204：%s", del.Code, del.Body.String())
	}
	after := restRequest(t, e, http.MethodGet, "/api/settings/"+key, "", nil)
	if err := json.Unmarshal(after.Body.Bytes(), &unsetPayload); err != nil {
		t.Fatal(err)
	}
	if unsetPayload.Value != nil {
		t.Fatalf("删除后应当回 null，得到 %v", unsetPayload.Value)
	}
}

func TestTaskRESTLifecycle(t *testing.T) {
	stopTaskManager()
	fileops.SetMounts(visibleDrives())
	startTaskManager()
	defer stopTaskManager()

	dir := t.TempDir()
	src := filepath.ToSlash(filepath.Join(dir, "a.txt"))
	if err := os.WriteFile(filepath.FromSlash(src), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	destDir := filepath.Join(dir, "out")
	if err := os.Mkdir(destDir, 0755); err != nil {
		t.Fatal(err)
	}

	e := newCommandTestServer()
	body := fmt.Sprintf(`{"kind":"copy","fromPaths":["%s"],"toPath":"%s"}`, src, filepath.ToSlash(destDir))
	created := restRequest(t, e, http.MethodPost, "/api/tasks", body, nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("创建任务 status = %d，期望 201：%s", created.Code, created.Body.String())
	}
	var snap tasks.Snapshot
	if err := json.Unmarshal(created.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	if snap.ID == "" || created.Header().Get("Location") != "/api/tasks/"+snap.ID {
		t.Fatalf("响应缺少 id 或 Location：%s", created.Body.String())
	}

	fetched := restRequest(t, e, http.MethodGet, "/api/tasks/"+snap.ID, "", nil)
	if fetched.Code != http.StatusOK {
		t.Fatalf("读取任务 status = %d：%s", fetched.Code, fetched.Body.String())
	}

	// 任务在后台跑：等文件真的出现，而不是假设它同步完成。
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(destDir, "a.txt")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("任务没有在 5s 内完成复制")
		}
		time.Sleep(10 * time.Millisecond)
	}

	removed := restRequest(t, e, http.MethodDelete, "/api/tasks/"+snap.ID, "", nil)
	if removed.Code != http.StatusNoContent {
		t.Fatalf("删除任务 status = %d，期望 204：%s", removed.Code, removed.Body.String())
	}
	again := restRequest(t, e, http.MethodDelete, "/api/tasks/"+snap.ID, "", nil)
	if again.Code != http.StatusNoContent {
		t.Fatalf("再次删除任务 status = %d，期望 204：%s", again.Code, again.Body.String())
	}
	gone := restRequest(t, e, http.MethodGet, "/api/tasks/"+snap.ID, "", nil)
	if gone.Code != http.StatusNotFound || decodeError(t, gone).Code != apierr.CodeTaskNotFound {
		t.Fatalf("删除后应当 404 task_not_found：%d %s", gone.Code, gone.Body.String())
	}
}

func TestTaskRESTValidation(t *testing.T) {
	stopTaskManager()
	startTaskManager()
	defer stopTaskManager()

	e := newCommandTestServer()

	unknownKind := restRequest(t, e, http.MethodPost, "/api/tasks", `{"kind":"teleport","fromPaths":["/tmp"]}`, nil)
	if unknownKind.Code != http.StatusBadRequest || decodeError(t, unknownKind).Code != apierr.CodeUnsupportedTaskKind {
		t.Fatalf("未知 kind 应回 400 unsupported_task_kind：%d %s", unknownKind.Code, unknownKind.Body.String())
	}

	missing := restRequest(t, e, http.MethodPost, "/api/tasks", `{"kind":"copy"}`, nil)
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("缺少 fromPaths 应回 400：%d %s", missing.Code, missing.Body.String())
	}

	notFound := restRequest(t, e, http.MethodGet, "/api/tasks/t_nope", "", nil)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("未知任务应回 404：%d", notFound.Code)
	}

	// 没有等决策的任务：回答冲突是 409，不是 404（任务确实存在）。
	dir := t.TempDir()
	src := filepath.ToSlash(filepath.Join(dir, "a.txt"))
	if err := os.WriteFile(filepath.FromSlash(src), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"kind":"copy","fromPaths":["%s"],"toPath":"%s"}`, src, filepath.ToSlash(dir))
	created := restRequest(t, e, http.MethodPost, "/api/tasks", body, nil)
	var snap tasks.Snapshot
	if err := json.Unmarshal(created.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	resolved := restRequest(t, e, http.MethodPost, "/api/tasks/"+snap.ID+"/resolutions", `{"policy":"overwrite"}`, nil)
	if resolved.Code != http.StatusConflict && resolved.Code != http.StatusNoContent {
		t.Fatalf("对未等待决策的任务回 %d，期望 409 或 204：%s", resolved.Code, resolved.Body.String())
	}
}

func TestMeasurementREST(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newCommandTestServer()
	body := fmt.Sprintf(`{"path":%q}`, filepath.ToSlash(dir))
	created := restRequest(t, e, http.MethodPost, "/api/fs/measurements", body, nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("创建测量 status = %d，期望 201：%s", created.Code, created.Body.String())
	}
	var payload measurementPayload
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ID == "" || !payload.IsDirectory {
		t.Fatalf("响应不对：%s", created.Body.String())
	}

	// 统计在后台跑：轮询直到 complete。
	var result measurementPayload
	deadline := time.Now().Add(5 * time.Second)
	for {
		rec := restRequest(t, e, http.MethodGet, "/api/fs/measurements/"+payload.ID, "", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("读取测量 status = %d：%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Complete {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("测量没有在 5s 内完成")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if result.Size != 5 || result.FileCount == nil || *result.FileCount != 1 || result.FolderCount == nil || *result.FolderCount != 1 {
		t.Fatalf("统计结果不对：%+v", result)
	}

	removed := restRequest(t, e, http.MethodDelete, "/api/fs/measurements/"+payload.ID, "", nil)
	if removed.Code != http.StatusNoContent {
		t.Fatalf("删除测量 status = %d，期望 204：%s", removed.Code, removed.Body.String())
	}
	gone := restRequest(t, e, http.MethodGet, "/api/fs/measurements/"+payload.ID, "", nil)
	if gone.Code != http.StatusNotFound {
		t.Fatalf("删除后应当 404：%d", gone.Code)
	}
}
