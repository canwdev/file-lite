package routes

import (
	"os"
	"path/filepath"
	"testing"

	"file-lite-go/fileops"
	"file-lite-go/tasks"
)

func changeForDir(t *testing.T, changes []fsDirChange, dir string) fsDirChange {
	t.Helper()
	for _, c := range changes {
		if filepath.Clean(c.Dir) == filepath.Clean(dir) {
			return c
		}
	}
	t.Fatalf("no change for dir %s in %+v", dir, changes)
	return fsDirChange{}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestDirChangesCopyAddsDestinationEntry(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	dst := filepath.Join(base, "dst")
	mustWrite(t, filepath.Join(src, "a.txt"), "alpha")
	mustWrite(t, filepath.Join(dst, "a.txt"), "alpha")

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindCopy, ToPath: dst}, []fileops.ItemResult{
		{FromPath: filepath.Join(src, "a.txt"), ToPath: filepath.Join(dst, "a.txt"), Status: fileops.StatusCopied},
	})

	c := changeForDir(t, changes, dst)
	if len(c.Added) != 1 || c.Added[0].Name != "a.txt" || c.Added[0].IsDirectory {
		t.Fatalf("expected a.txt added to %s, got %+v", dst, c)
	}
	if len(c.Removed) != 0 || len(c.Updated) != 0 {
		t.Fatalf("copy should not remove or update, got %+v", c)
	}
}

func TestDirChangesOverwriteIsUpdate(t *testing.T) {
	base := t.TempDir()
	dst := filepath.Join(base, "dst")
	mustWrite(t, filepath.Join(dst, "a.txt"), "new")

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindCopy, ToPath: dst}, []fileops.ItemResult{
		{FromPath: filepath.Join(base, "src", "a.txt"), ToPath: filepath.Join(dst, "a.txt"), Status: fileops.StatusReplaced},
	})

	c := changeForDir(t, changes, dst)
	if len(c.Updated) != 1 || c.Updated[0].Name != "a.txt" {
		t.Fatalf("expected a.txt updated, got %+v", c)
	}
}

func TestDirChangesKeepBothAddsRenamedEntry(t *testing.T) {
	base := t.TempDir()
	dst := filepath.Join(base, "dst")
	mustWrite(t, filepath.Join(dst, "a (1).txt"), "alpha")

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindCopy, ToPath: dst}, []fileops.ItemResult{
		{FromPath: filepath.Join(base, "src", "a.txt"), ToPath: filepath.Join(dst, "a (1).txt"), Status: fileops.StatusRenamed},
	})

	c := changeForDir(t, changes, dst)
	if len(c.Added) != 1 || c.Added[0].Name != "a (1).txt" {
		t.Fatalf("expected renamed entry added, got %+v", c)
	}
}

func TestDirChangesMoveRemovesSourceAndAddsDestination(t *testing.T) {
	base := t.TempDir()
	srcDir := filepath.Join(base, "src")
	dstDir := filepath.Join(base, "dst")
	mustWrite(t, filepath.Join(dstDir, "a.txt"), "alpha")

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindMove, ToPath: dstDir}, []fileops.ItemResult{
		{FromPath: filepath.Join(srcDir, "a.txt"), ToPath: filepath.Join(dstDir, "a.txt"), Status: fileops.StatusMoved},
	})

	dstChange := changeForDir(t, changes, dstDir)
	if len(dstChange.Added) != 1 || dstChange.Added[0].Name != "a.txt" {
		t.Fatalf("expected a.txt added to dst, got %+v", dstChange)
	}
	srcChange := changeForDir(t, changes, srcDir)
	if len(srcChange.Removed) != 1 || srcChange.Removed[0] != "a.txt" {
		t.Fatalf("expected a.txt removed from src, got %+v", srcChange)
	}
}

func TestDirChangesDeleteRemovesEntry(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "dir")

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindDelete}, []fileops.ItemResult{
		{FromPath: filepath.Join(dir, "gone.txt"), Status: fileops.StatusDeleted},
	})

	c := changeForDir(t, changes, dir)
	if len(c.Removed) != 1 || c.Removed[0] != "gone.txt" {
		t.Fatalf("expected gone.txt removed, got %+v", c)
	}
}

func TestDirChangesDirectoryCopyAddsDirectoryEntry(t *testing.T) {
	base := t.TempDir()
	dst := filepath.Join(base, "dst")
	if err := os.MkdirAll(filepath.Join(dst, "big"), 0755); err != nil {
		t.Fatal(err)
	}

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindCopy, ToPath: dst}, []fileops.ItemResult{
		{FromPath: filepath.Join(base, "src", "big"), ToPath: filepath.Join(dst, "big"), Status: fileops.StatusCopied},
	})

	c := changeForDir(t, changes, dst)
	if len(c.Added) != 1 || c.Added[0].Name != "big" || !c.Added[0].IsDirectory {
		t.Fatalf("expected directory big added, got %+v", c)
	}
}

func TestDirChangesSkippedAndFailedProduceNoChange(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "dir")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	changes := dirChangesForTask(tasks.Snapshot{Kind: tasks.KindCopy, ToPath: dir}, []fileops.ItemResult{
		{FromPath: filepath.Join(base, "src", "a.txt"), ToPath: filepath.Join(dir, "a.txt"), Status: fileops.StatusSkipped},
		{FromPath: filepath.Join(base, "src", "b.txt"), ToPath: filepath.Join(dir, "b.txt"), Status: fileops.StatusFailed},
		{FromPath: filepath.Join(base, "src", "c.txt"), ToPath: filepath.Join(dir, "c.txt"), Status: fileops.StatusConflict},
	})

	if len(changes) != 0 {
		t.Fatalf("non-success statuses must not produce changes, got %+v", changes)
	}
}
