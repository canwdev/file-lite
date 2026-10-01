package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// newMeasurementCapture 是一个只收消息的假 WS 客户端，用来观察广播出去的测量事件。
func newMeasurementCapture() *sharedWSClient {
	return &sharedWSClient{
		send: make(chan []byte, 16),
		done: make(chan struct{}),
	}
}

func readMeasurementEvent(t *testing.T, client *sharedWSClient) measurementPayload {
	t.Helper()
	select {
	case raw := <-client.send:
		var payload measurementPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("unmarshal measurement payload: %v", err)
		}
		return payload
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for a measurement event")
		return measurementPayload{}
	}
}

// 文件不需要遍历：创建响应本身就带完整结果，也不会再推事件。
func TestMeasurementForFileIsImmediate(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newCommandTestServer()
	rec := restRequest(t, e, http.MethodPost, "/api/fs/measurements",
		fmt.Sprintf(`{"path":%q}`, filepath.ToSlash(file)), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d，期望 201：%s", rec.Code, rec.Body.String())
	}

	var payload measurementPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.IsDirectory {
		t.Error("IsDirectory = true，期望 false")
	}
	if !payload.Complete {
		t.Error("文件应当立即完成")
	}
	if payload.Size != 5 {
		t.Errorf("Size = %d，期望 5", payload.Size)
	}
	if payload.FileCount != nil || payload.FolderCount != nil {
		t.Errorf("文件的条目数应为 nil，得到 %v / %v", payload.FileCount, payload.FolderCount)
	}
	if payload.Name != "report.txt" {
		t.Errorf("Name = %q", payload.Name)
	}
	if payload.Birthtime == 0 || payload.LastModified == 0 {
		t.Errorf("时间戳 = %d / %d，期望非 0", payload.Birthtime, payload.LastModified)
	}
}

// 目录：先进度事件（大小未算完），再结果事件；子目录数不含被统计的根自身。
func TestMeasurementPushesProgressThenResult(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("12345"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "b.txt"), []byte("123"), 0644); err != nil {
		t.Fatal(err)
	}

	client := newMeasurementCapture()
	sharedWSRegisterClient(client)
	defer sharedWSUnregisterClient(client)

	e := newCommandTestServer()
	rec := restRequest(t, e, http.MethodPost, "/api/fs/measurements",
		fmt.Sprintf(`{"path":%q}`, filepath.ToSlash(dir)), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d，期望 201：%s", rec.Code, rec.Body.String())
	}

	progress := readMeasurementEvent(t, client)
	if progress.Scope != "measurements" || progress.Type != "progress" {
		t.Fatalf("首个事件 = %q/%q，期望 measurements/progress", progress.Scope, progress.Type)
	}
	if !progress.IsDirectory || progress.Complete {
		t.Fatalf("进度事件里目录应为未完成：%+v", progress)
	}
	if progress.Name != filepath.Base(dir) {
		t.Errorf("Name = %q，期望 %q", progress.Name, filepath.Base(dir))
	}

	result := readMeasurementEvent(t, client)
	if result.Type != "result" || !result.Complete {
		t.Fatalf("第二个事件应当是完整结果：%+v", result)
	}
	if result.ID != progress.ID {
		t.Errorf("两次事件的 id 应当一致：%q / %q", result.ID, progress.ID)
	}
	if result.Size != 8 {
		t.Errorf("Size = %d，期望 8", result.Size)
	}
	if result.FileCount == nil || *result.FileCount != 2 {
		t.Errorf("FileCount = %v，期望 2", result.FileCount)
	}
	if result.FolderCount == nil || *result.FolderCount != 1 {
		t.Errorf("FolderCount = %v，期望 1（不含根自身）", result.FolderCount)
	}
}

func TestMeasurementForMissingPath(t *testing.T) {
	e := newCommandTestServer()
	missing := filepath.ToSlash(filepath.Join(t.TempDir(), "missing"))
	rec := restRequest(t, e, http.MethodPost, "/api/fs/measurements",
		fmt.Sprintf(`{"path":%q}`, missing), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d，期望 404：%s", rec.Code, rec.Body.String())
	}
}
