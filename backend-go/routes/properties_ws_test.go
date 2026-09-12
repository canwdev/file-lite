package routes

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestPropertiesClient() *sharedWSClient {
	return &sharedWSClient{
		send: make(chan []byte, 16),
		done: make(chan struct{}),
	}
}

func readPropertiesPayload(t *testing.T, client *sharedWSClient) propertiesWSPayload {
	t.Helper()
	select {
	case raw := <-client.send:
		var payload propertiesWSPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("unmarshal properties payload: %v", err)
		}
		return payload
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for a properties message")
		return propertiesWSPayload{}
	}
}

func getProperties(t *testing.T, client *sharedWSClient, requestID, path string) {
	t.Helper()
	handleSharedWSPropertiesMessage(client, sharedWSPropertiesClientMessage{
		Scope:     "properties",
		Type:      "get",
		RequestID: requestID,
		Path:      path,
	})
}

func TestPropertiesForFileReturnsSizeImmediately(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(file, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	client := newTestPropertiesClient()
	getProperties(t, client, "r1", file)

	payload := readPropertiesPayload(t, client)
	if payload.Type != "result" {
		t.Fatalf("Type = %q, want result (a file needs no background scan)", payload.Type)
	}
	if payload.RequestID != "r1" {
		t.Errorf("RequestID = %q, want r1", payload.RequestID)
	}
	if payload.IsDirectory {
		t.Errorf("IsDirectory = true, want false")
	}
	if payload.Size != 5 {
		t.Errorf("Size = %d, want 5", payload.Size)
	}
	if payload.FileCount != nil || payload.FolderCount != nil {
		t.Errorf("file / folder counts = %v / %v, want nil for a file", payload.FileCount, payload.FolderCount)
	}
	if !payload.Complete {
		t.Errorf("Complete = false, want true")
	}
	if payload.Birthtime == 0 || payload.LastModified == 0 {
		t.Errorf("timestamps = %d / %d, want non-zero", payload.Birthtime, payload.LastModified)
	}
}

func TestPropertiesForDirectoryPushesMetaThenResult(t *testing.T) {
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

	client := newTestPropertiesClient()
	getProperties(t, client, "r2", dir)

	meta := readPropertiesPayload(t, client)
	if meta.Type != "meta" {
		t.Fatalf("first message Type = %q, want meta", meta.Type)
	}
	if !meta.IsDirectory {
		t.Errorf("IsDirectory = false, want true")
	}
	if meta.Name != filepath.Base(dir) {
		t.Errorf("Name = %q, want %q", meta.Name, filepath.Base(dir))
	}

	result := readPropertiesPayload(t, client)
	if result.Type != "result" {
		t.Fatalf("second message Type = %q, want result", result.Type)
	}
	if result.Size != 8 {
		t.Errorf("Size = %d, want 8", result.Size)
	}
	if result.FileCount == nil || *result.FileCount != 2 {
		t.Errorf("FileCount = %v, want 2", result.FileCount)
	}
	if result.FolderCount == nil || *result.FolderCount != 1 {
		t.Errorf("FolderCount = %v, want 1 (root itself excluded)", result.FolderCount)
	}
	if !result.Complete {
		t.Errorf("Complete = false, want true")
	}
}

func TestPropertiesForMissingPathPushesError(t *testing.T) {
	client := newTestPropertiesClient()
	getProperties(t, client, "r3", filepath.Join(t.TempDir(), "missing"))

	select {
	case raw := <-client.send:
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["scope"] != "properties" || payload["type"] != "error" {
			t.Fatalf("payload = %v, want a properties error", payload)
		}
		if payload["requestId"] != "r3" {
			t.Errorf("requestId = %v, want r3", payload["requestId"])
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for an error message")
	}
}
