package plugins

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func byID(list []Plugin) map[string]Plugin {
	out := map[string]Plugin{}
	for _, plugin := range list {
		out[plugin.ID] = plugin
	}
	return out
}

func TestScanDirPluginWithManifest(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "jspaint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "jspaint", "manifest.json"), `{
		"name": "JS Paint",
		"entry": "index.html",
		"icon": "🎨",
		"openWith": [".png", ".jpg"]
	}`)

	got := byID(Scan(dir))
	plugin, ok := got["jspaint"]
	if !ok {
		t.Fatal("expected jspaint")
	}
	if plugin.Name != "JS Paint" {
		t.Fatalf("name = %q", plugin.Name)
	}
	if plugin.EntryURL != "/plugins/jspaint/index.html" {
		t.Fatalf("entryUrl = %q", plugin.EntryURL)
	}
	if plugin.IconEmoji != "🎨" {
		t.Fatalf("iconEmoji = %q", plugin.IconEmoji)
	}
	if plugin.IconURL != "" {
		t.Fatalf("iconUrl = %q, want empty", plugin.IconURL)
	}
	if len(plugin.OpenWith) != 2 {
		t.Fatalf("openWith = %v", plugin.OpenWith)
	}
}

func TestScanDirPluginDefaults(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "notes", "index.html"), "<html></html>")

	plugin := byID(Scan(dir))["notes"]
	if plugin.ID == "" {
		t.Fatal("expected notes")
	}
	if plugin.Name != "notes" {
		t.Fatalf("name = %q", plugin.Name)
	}
	if plugin.EntryURL != "/plugins/notes/index.html" {
		t.Fatalf("entryUrl = %q", plugin.EntryURL)
	}
	if plugin.IconEmoji != "" || plugin.IconURL != "" {
		t.Fatalf("icons = %q %q", plugin.IconEmoji, plugin.IconURL)
	}
	if plugin.OpenWith == nil || len(plugin.OpenWith) != 0 {
		t.Fatalf("openWith = %#v", plugin.OpenWith)
	}
}

func TestScanSingleFilePlugin(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "excel-to-json.html"), "<html></html>")

	plugin := byID(Scan(dir))["excel-to-json"]
	if plugin.ID == "" {
		t.Fatal("expected excel-to-json")
	}
	if !plugin.File {
		t.Fatal("expected file plugin")
	}
	if plugin.Name != "excel-to-json" {
		t.Fatalf("name = %q", plugin.Name)
	}
	if plugin.EntryURL != "/plugins/excel-to-json.html" {
		t.Fatalf("entryUrl = %q", plugin.EntryURL)
	}
}

func TestScanFolderWinsOverSameNameFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "markdown-editor", "index.html"), "folder")
	writeFile(t, filepath.Join(dir, "markdown-editor.html"), "file")

	list := Scan(dir)
	if len(list) != 1 {
		t.Fatalf("len = %d, want 1", len(list))
	}
	if list[0].ID != "markdown-editor" || list[0].File {
		t.Fatalf("got %#v", list[0])
	}
	abs, err := list[0].Resolve("index.html")
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "folder" {
		t.Fatalf("served %q", body)
	}
}

func TestScanSkipsBadManifest(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "broken", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "broken", "manifest.json"), "{")
	writeFile(t, filepath.Join(dir, "ok", "index.html"), "<html></html>")

	got := byID(Scan(dir))
	if _, exists := got["broken"]; exists {
		t.Fatal("broken plugin should be skipped")
	}
	if _, exists := got["ok"]; !exists {
		t.Fatal("ok plugin should remain")
	}
}

func TestScanSkipsInvalidID(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "has space", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "ok", "index.html"), "<html></html>")

	got := byID(Scan(dir))
	if _, exists := got["has space"]; exists {
		t.Fatal("invalid id should be skipped")
	}
	if _, exists := got["ok"]; !exists {
		t.Fatal("ok plugin should remain")
	}
}

func TestScanMissingDirIsEmpty(t *testing.T) {
	if list := Scan(filepath.Join(t.TempDir(), "missing")); list != nil {
		t.Fatalf("got %#v", list)
	}
}

func TestIconRelativePath(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "paint", "images", "icon.png"), "png")
	writeFile(t, filepath.Join(dir, "paint", "manifest.json"), `{
		"icon": "images/icon.png"
	}`)

	plugin := byID(Scan(dir))["paint"]
	if plugin.IconURL != "/plugins/paint/images/icon.png" {
		t.Fatalf("iconUrl = %q", plugin.IconURL)
	}
	if plugin.IconEmoji != "" {
		t.Fatalf("iconEmoji = %q", plugin.IconEmoji)
	}
}

func TestIconFilenameExtension(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "paint", "icon.svg"), "<svg></svg>")
	writeFile(t, filepath.Join(dir, "paint", "manifest.json"), `{"icon": "icon.svg"}`)

	plugin := byID(Scan(dir))["paint"]
	if plugin.IconURL != "/plugins/paint/icon.svg" {
		t.Fatalf("iconUrl = %q", plugin.IconURL)
	}
}

func TestIconEscapeIgnored(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "paint", "manifest.json"), `{"icon": "../secret.png"}`)

	plugin := byID(Scan(dir))["paint"]
	if plugin.ID == "" {
		t.Fatal("plugin should still load")
	}
	if plugin.IconURL != "" || plugin.IconEmoji != "" {
		t.Fatalf("escaped icon should be dropped, got %q %q", plugin.IconEmoji, plugin.IconURL)
	}
}

func TestResolveRejectsDotDot(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "secret.txt"), "nope")

	plugin := byID(Scan(dir))["paint"]
	for _, rel := range []string{"../secret.txt", "..\\secret.txt", "foo/../../secret.txt"} {
		_, err := plugin.Resolve(rel)
		if !errors.Is(err, ErrEscape) {
			t.Fatalf("resolve %q: err = %v, want ErrEscape", rel, err)
		}
	}
}

func TestResolveServesEntryAndNestedFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "entry")
	writeFile(t, filepath.Join(dir, "paint", "src", "app.js"), "js")

	plugin := byID(Scan(dir))["paint"]
	empty, err := plugin.Resolve("")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(empty) != "index.html" {
		t.Fatalf("empty path served %s", empty)
	}
	nested, err := plugin.Resolve("src/app.js")
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(nested)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "js" {
		t.Fatalf("nested body = %q", body)
	}
}

func TestIndexHtmlUsesPluginsRoot(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "index.html"), "catalog")
	writeFile(t, filepath.Join(dir, "qr.html"), "qr")

	plugin := byID(Scan(dir))["index"]
	if plugin.EntryURL != "/plugins/index.html" {
		t.Fatalf("entryUrl = %q", plugin.EntryURL)
	}

	index, err := ResolveRootFile(dir, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(index)
	if string(body) != "catalog" {
		t.Fatalf("index = %q", body)
	}
	qr, err := ResolveRootFile(dir, "qr.html")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = os.ReadFile(qr)
	if string(body) != "qr" {
		t.Fatalf("qr = %q", body)
	}
}

func TestResolveRootFileRejectsDotDot(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "index.html"), "ok")
	if _, err := ResolveRootFile(dir, "../secret"); !errors.Is(err, ErrEscape) {
		t.Fatalf("err = %v", err)
	}
	if _, err := ResolveRootFile(dir, "a/b.html"); !errors.Is(err, ErrEscape) {
		t.Fatalf("err = %v", err)
	}
}

func TestFindInvalidID(t *testing.T) {
	if _, ok := Find(t.TempDir(), "../x"); ok {
		t.Fatal("invalid id should not match")
	}
	if _, ok := Find(t.TempDir(), ""); ok {
		t.Fatal("empty id should not match")
	}
}

func TestValidID(t *testing.T) {
	ok := []string{"a", "jspaint", "excel-to-json", "A1._-z", strings.Repeat("x", 64)}
	for _, id := range ok {
		if !ValidID(id) {
			t.Fatalf("%q should be valid", id)
		}
	}
	bad := []string{"", "-no", ".hidden", "has space", "has/slash", strings.Repeat("x", 65)}
	for _, id := range bad {
		if ValidID(id) {
			t.Fatalf("%q should be invalid", id)
		}
	}
}
