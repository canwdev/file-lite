package routes

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"file-lite-go/types"
)

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
	e := newRESTTestServer()

	rec := putContentRequest(t, e, target, "hello", "")
	if rec.Code != http.StatusCreated {
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
	e := newRESTTestServer()

	rec := putContentRequest(t, e, target, "newer", "overwrite")
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
	e := newRESTTestServer()

	rec := putContentRequest(t, e, target, "newer", "error")
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	assertNoFSChanged(t, client)
}

func TestCreateDirBroadcastsEachNewLevel(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "a", "b")
	client := listenFSChanges(t)
	e := newRESTTestServer()

	rec := restRequest(t, e, http.MethodPut, encodedEntryURL("/api/fs/directories", filepath.ToSlash(target)), "", nil)
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

	again := restRequest(t, e, http.MethodPut, encodedEntryURL("/api/fs/directories", filepath.ToSlash(target)), "", nil)
	if again.Code != http.StatusOK {
		t.Fatalf("existed status = %d (%s)", again.Code, again.Body.String())
	}
	assertNoFSChanged(t, client)
}

func TestRenameBroadcastsRemoveAndAdd(t *testing.T) {
	dir := t.TempDir()
	from := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(from, []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}
	client := listenFSChanges(t)
	e := newRESTTestServer()

	rec := restRequest(t, e, http.MethodPatch,
		encodedEntryURL("/api/fs/entries", filepath.ToSlash(from)), `{"name":"b.txt"}`, nil)
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
