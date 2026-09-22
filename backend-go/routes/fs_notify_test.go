package routes

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/types"
)

func newWriteServer() *echo.Echo {
	e := echo.New()
	e.POST("/api/files/upload-file", uploadFile)
	e.POST("/api/files/create-dir", createDirectory)
	e.POST("/api/files/rename", renamePath)
	return e
}

func listenFSChanges(t *testing.T) *sharedWSClient {
	t.Helper()
	client := &sharedWSClient{
		send: make(chan []byte, 8),
		done: make(chan struct{}),
	}
	sharedWSRegisterClient(client)
	t.Cleanup(func() { sharedWSUnregisterClient(client) })
	return client
}

type fsChangedPayload struct {
	Scope   string        `json:"scope"`
	Type    string        `json:"type"`
	Paths   []string      `json:"paths"`
	Changes []fsDirChange `json:"changes"`
}

func takeFSChanged(t *testing.T, client *sharedWSClient) fsChangedPayload {
	t.Helper()
	select {
	case raw := <-client.send:
		var payload fsChangedPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("unmarshal fs changed: %v (%s)", err, raw)
		}
		if payload.Scope != "fs" || payload.Type != "changed" {
			t.Fatalf("payload = %+v, want fs/changed", payload)
		}
		return payload
	default:
		t.Fatal("no fs changed message")
		return fsChangedPayload{}
	}
}

func assertNoFSChanged(t *testing.T, client *sharedWSClient) {
	t.Helper()
	select {
	case raw := <-client.send:
		t.Fatalf("unexpected fs message: %s", raw)
	default:
	}
}

func entryNamed(t *testing.T, entries []types.Entry, name string) types.Entry {
	t.Helper()
	for _, entry := range entries {
		if entry.Name == name {
			return entry
		}
	}
	t.Fatalf("no entry %q in %+v", name, entries)
	return types.Entry{}
}

func TestUploadBroadcastsAddedFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := uploadRequest(t, e, target, "a.txt", "hello", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}

	payload := takeFSChanged(t, client)
	change := changeForDir(t, payload.Changes, dir)
	added := entryNamed(t, change.Added, "a.txt")
	if added.IsDirectory {
		t.Fatalf("added entry is a directory")
	}
	if added.Size == nil || *added.Size != 5 {
		t.Fatalf("size = %v, want 5", added.Size)
	}
	if len(change.Updated) != 0 || len(change.Removed) != 0 {
		t.Fatalf("change = %+v, want only added", change)
	}
	assertNoFSChanged(t, client)
}

func TestUploadOverwriteBroadcastsUpdate(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := uploadRequest(t, e, target, "a.txt", "newer", "overwrite")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}

	payload := takeFSChanged(t, client)
	change := changeForDir(t, payload.Changes, dir)
	updated := entryNamed(t, change.Updated, "a.txt")
	if updated.Size == nil || *updated.Size != 5 {
		t.Fatalf("size = %v, want 5", updated.Size)
	}
	if len(change.Added) != 0 {
		t.Fatalf("overwrite must not be reported as added: %+v", change.Added)
	}
}

func TestUploadConflictDoesNotBroadcast(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(target, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := uploadRequest(t, e, target, "a.txt", "newer", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	assertNoFSChanged(t, client)
}

func TestUploadBroadcastsCreatedAncestors(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "new", "child", "a.txt")
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := uploadRequest(t, e, target, "a.txt", "hello", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}

	payload := takeFSChanged(t, client)
	parent := changeForDir(t, payload.Changes, dir)
	folder := entryNamed(t, parent.Added, "new")
	if !folder.IsDirectory {
		t.Fatalf("new = %+v, want a directory", folder)
	}
	mid := changeForDir(t, payload.Changes, filepath.Join(dir, "new"))
	child := entryNamed(t, mid.Added, "child")
	if !child.IsDirectory {
		t.Fatalf("child = %+v, want a directory", child)
	}
	leaf := changeForDir(t, payload.Changes, filepath.Join(dir, "new", "child"))
	file := entryNamed(t, leaf.Added, "a.txt")
	if file.IsDirectory || file.Size == nil || *file.Size != 5 {
		t.Fatalf("file = %+v, want a 5-byte file", file)
	}
}

func TestCreateDirBroadcastsEachNewLevel(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a", "b")
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := postJSON(t, e, "/api/files/create-dir", map[string]string{"path": target})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	payload := takeFSChanged(t, client)
	parent := changeForDir(t, payload.Changes, dir)
	if !entryNamed(t, parent.Added, "a").IsDirectory {
		t.Fatal("a is not a directory")
	}
	inner := changeForDir(t, payload.Changes, filepath.Join(dir, "a"))
	if !entryNamed(t, inner.Added, "b").IsDirectory {
		t.Fatal("b is not a directory")
	}

	again := postJSON(t, e, "/api/files/create-dir", map[string]string{"path": target})
	if again.Code != http.StatusOK {
		t.Fatalf("existed status = %d (%s)", again.Code, again.Body.String())
	}
	assertNoFSChanged(t, client)
}

func TestRenameBroadcastsRemoveAndAdd(t *testing.T) {
	dir := t.TempDir()
	from := filepath.Join(dir, "a.txt")
	to := filepath.Join(dir, "b.txt")
	if err := os.WriteFile(from, []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := postJSON(t, e, "/api/files/rename", map[string]string{
		"fromPath": from,
		"toPath":   to,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	payload := takeFSChanged(t, client)
	change := changeForDir(t, payload.Changes, dir)
	if len(change.Removed) != 1 || change.Removed[0] != "a.txt" {
		t.Fatalf("removed = %v, want [a.txt]", change.Removed)
	}
	added := entryNamed(t, change.Added, "b.txt")
	if added.Size == nil || *added.Size != 2 {
		t.Fatalf("size = %v, want 2", added.Size)
	}
	if len(payload.Changes) != 1 {
		t.Fatalf("same-dir rename produced %d dirs, want 1", len(payload.Changes))
	}
}

func TestRenameAcrossDirectories(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	if err := os.Mkdir(src, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(dst, 0755); err != nil {
		t.Fatal(err)
	}
	from := filepath.Join(src, "a.txt")
	to := filepath.Join(dst, "a.txt")
	if err := os.WriteFile(from, []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}
	client := listenFSChanges(t)
	e := newWriteServer()

	rec := postJSON(t, e, "/api/files/rename", map[string]string{
		"fromPath": from,
		"toPath":   to,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	payload := takeFSChanged(t, client)
	srcChange := changeForDir(t, payload.Changes, src)
	if len(srcChange.Removed) != 1 || srcChange.Removed[0] != "a.txt" {
		t.Fatalf("src removed = %v", srcChange.Removed)
	}
	if len(srcChange.Added) != 0 {
		t.Fatalf("src added = %+v, want none", srcChange.Added)
	}
	dstChange := changeForDir(t, payload.Changes, dst)
	if entryNamed(t, dstChange.Added, "a.txt").IsDirectory {
		t.Fatal("moved entry is a directory")
	}
	if len(dstChange.Removed) != 0 {
		t.Fatalf("dst removed = %v, want none", dstChange.Removed)
	}
}
