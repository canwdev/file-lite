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
		"openWith": [".png", ".jpg"],
		"singleInstance": true,
		"version": " 1.2.0 "
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
	if !plugin.SingleInstance {
		t.Fatal("singleInstance = false, want true")
	}
	if plugin.Version != "1.2.0" {
		t.Fatalf("version = %q", plugin.Version)
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
	if plugin.SingleInstance {
		t.Fatal("singleInstance = true, want false")
	}
	if plugin.Version != "" {
		t.Fatalf("version = %q", plugin.Version)
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
	if plugin.SingleInstance {
		t.Fatal("singleInstance = true, want false")
	}
	if plugin.Version != "" {
		t.Fatalf("version = %q", plugin.Version)
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

func TestInjectSDK(t *testing.T) {
	withHead := InjectSDK([]byte("<html><head></head><body></body></html>"))
	headAt := strings.Index(string(withHead), "plugin-sdk.js")
	closeHead := strings.Index(string(withHead), "</head>")
	if headAt < 0 || headAt > closeHead {
		t.Fatalf("script not before </head>: %s", withHead)
	}
	again := InjectSDK(withHead)
	if strings.Count(string(again), "plugin-sdk.js") != 1 {
		t.Fatalf("duplicated: %s", again)
	}

	withBody := InjectSDK([]byte("<html><body></body></html>"))
	if strings.Index(string(withBody), "plugin-sdk.js") > strings.Index(string(withBody), "</body>") {
		t.Fatalf("script not before </body>: %s", withBody)
	}
}

func TestIsEntry(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "entry")
	writeFile(t, filepath.Join(dir, "paint", "help.html"), "help")
	plugin := byID(Scan(dir))["paint"]
	entry := filepath.Join(dir, "paint", "index.html")
	if !plugin.IsEntry(entry) {
		t.Fatal("index.html should be the entry")
	}
	if plugin.IsEntry(filepath.Join(dir, "paint", "help.html")) {
		t.Fatal("help.html should not be the entry")
	}
}

func TestEnsureReadme(t *testing.T) {
	dir := t.TempDir()
	if err := EnsureReadme(dir); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != string(readme) {
		t.Fatal("readme bytes differ from embed")
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := EnsureReadme(dir); err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(filepath.Join(dir, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(kept) != "keep" {
		t.Fatalf("overwrote existing readme: %s", kept)
	}
}

func TestScanCacheFollowsManifestAndListing(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "paint", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "paint", "manifest.json"), `{
		"name": "Paint",
		"openWith": [".png"]
	}`)

	first := Scan(dir)
	if len(first) != 1 || first[0].Name != "Paint" {
		t.Fatalf("first = %#v", first)
	}
	first[0].Name = "mutated"
	first[0].OpenWith[0] = ".mutated"

	cached := Scan(dir)
	if cached[0].Name != "Paint" || cached[0].OpenWith[0] != ".png" {
		t.Fatalf("cache aliased caller data: %#v", cached[0])
	}

	writeFile(t, filepath.Join(dir, "paint", "manifest.json"), `{
		"name": "Paint 2",
		"openWith": [".jpg"]
	}`)
	renamed := byID(Scan(dir))["paint"]
	if renamed.Name != "Paint 2" || len(renamed.OpenWith) != 1 || renamed.OpenWith[0] != ".jpg" {
		t.Fatalf("manifest edit not visible: %#v", renamed)
	}

	writeFile(t, filepath.Join(dir, "notes", "index.html"), "<html></html>")
	if _, ok := byID(Scan(dir))["notes"]; !ok {
		t.Fatal("added plugin should appear")
	}
}

func TestScanCacheFollowsRepairedManifest(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "broken", "index.html"), "<html></html>")
	writeFile(t, filepath.Join(dir, "broken", "manifest.json"), "{")

	if _, ok := byID(Scan(dir))["broken"]; ok {
		t.Fatal("broken plugin should be skipped")
	}
	writeFile(t, filepath.Join(dir, "broken", "manifest.json"), `{"name": "Fixed"}`)
	plugin := byID(Scan(dir))["broken"]
	if plugin.Name != "Fixed" {
		t.Fatalf("repaired plugin = %#v", plugin)
	}
}

func TestScanCacheFollowsAddedEntry(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "late"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := byID(Scan(dir))["late"]; ok {
		t.Fatal("folder without an entry should be skipped")
	}
	writeFile(t, filepath.Join(dir, "late", "index.html"), "<html></html>")
	if _, ok := byID(Scan(dir))["late"]; !ok {
		t.Fatal("entry added later should appear")
	}
}

func TestResponseETagSplitsInjectedHTML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "index.html")
	writeFile(t, path, "<html></html>")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	plain := ResponseETag(info, false)
	injected := ResponseETag(info, true)
	if plain == "" || injected == "" || plain == injected {
		t.Fatalf("plain = %q, injected = %q", plain, injected)
	}
	if ResponseETag(info, false) != plain {
		t.Fatal("etag changed without a file change")
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
