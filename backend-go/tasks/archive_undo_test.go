package tasks

import (
	"os"
	"path/filepath"
	"testing"

	"file-lite-go/sevenzip"
)

func TestExtractUndoRollsBackPartialOutput(t *testing.T) {
	dir := t.TempDir()
	original := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(original, []byte("hidden"), 0o644); err != nil {
		t.Fatal(err)
	}
	names := []sevenzip.ListedEntry{{Path: "secret.txt"}, {Path: "fresh.txt"}}
	undo := prepareExtract(dir, sevenzip.OverwriteAll, names, nil)

	if _, err := os.Stat(original); !os.IsNotExist(err) {
		t.Fatal("existing file should be parked before extract")
	}
	if err := os.WriteFile(original, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fresh.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}

	undo.rollback()

	body, err := os.ReadFile(original)
	if err != nil || string(body) != "hidden" {
		t.Fatalf("restored secret.txt = %q, %v", body, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "fresh.txt")); !os.IsNotExist(err) {
		t.Fatalf("fresh file should be removed, err=%v", err)
	}
}
