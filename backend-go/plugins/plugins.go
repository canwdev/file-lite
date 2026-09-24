package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"file-lite-go/config"
	"file-lite-go/utils"
)

var (
	idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	ErrEscape = errors.New("path escapes plugin root")
)

type Manifest struct {
	Name           string   `json:"name"`
	Entry          string   `json:"entry"`
	Icon           string   `json:"icon"`
	OpenWith       []string `json:"openWith"`
	SingleInstance bool     `json:"singleInstance"`
	Version        string   `json:"version"`
}

type Plugin struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	EntryURL       string   `json:"entryUrl"`
	IconEmoji      string   `json:"iconEmoji"`
	IconURL        string   `json:"iconUrl"`
	OpenWith       []string `json:"openWith"`
	SingleInstance bool     `json:"singleInstance"`
	Version        string   `json:"version"`

	Root     string `json:"-"`
	EntryRel string `json:"-"`
	File     bool   `json:"-"`
	FilePath string `json:"-"`
}

func Dir() string {
	return filepath.Join(config.DataBaseDir(), "plugins")
}

func ValidID(id string) bool {
	return idPattern.MatchString(id)
}

// Scan lists plugins under dir. The result is reused until the directory listing,
// a plugin directory, or a manifest.json changes. File bodies are not cached.
func Scan(dir string) []Plugin {
	key := filepath.Clean(dir)
	scanMu.Lock()
	defer scanMu.Unlock()

	stamp, ok := directoryStamp(dir)
	if !ok {
		delete(scanCache, key)
		return scanDir(dir)
	}
	if ent, hit := scanCache[key]; hit && ent.stamp == stamp {
		return clonePlugins(ent.list)
	}
	list := scanDir(dir)
	after, afterOK := directoryStamp(dir)
	if scanCache == nil {
		scanCache = map[string]scanCacheEntry{}
	}
	if afterOK && after == stamp {
		scanCache[key] = scanCacheEntry{stamp: stamp, list: clonePlugins(list)}
	} else {
		delete(scanCache, key)
	}
	return clonePlugins(list)
}

func scanDir(dir string) []Plugin {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			utils.LogWarnf("scan plugins %s: %v", dir, err)
		}
		return nil
	}

	dirs := map[string]struct{}{}
	var dirEntries []os.DirEntry
	var files []os.DirEntry
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if entry.IsDir() {
			dirs[name] = struct{}{}
			dirEntries = append(dirEntries, entry)
			continue
		}
		files = append(files, entry)
	}

	out := make([]Plugin, 0)
	for _, entry := range dirEntries {
		id := entry.Name()
		if !ValidID(id) {
			utils.LogWarnf("skip plugin %s: invalid id", id)
			continue
		}
		plugin, ok := loadDirPlugin(filepath.Join(dir, id), id)
		if ok {
			out = append(out, plugin)
		}
	}
	for _, entry := range files {
		name := entry.Name()
		ext := filepath.Ext(name)
		if !strings.EqualFold(ext, ".html") {
			continue
		}
		id := strings.TrimSuffix(name, ext)
		if _, exists := dirs[id]; exists {
			continue
		}
		if !ValidID(id) {
			utils.LogWarnf("skip plugin %s: invalid id", name)
			continue
		}
		out = append(out, loadFilePlugin(filepath.Join(dir, name), id, name))
	}

	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func Find(dir, id string) (Plugin, bool) {
	if !ValidID(id) {
		return Plugin{}, false
	}
	for _, plugin := range Scan(dir) {
		if plugin.ID == id {
			return plugin, true
		}
	}
	return Plugin{}, false
}

type scanCacheEntry struct {
	stamp string
	list  []Plugin
}

var (
	scanMu    sync.Mutex
	scanCache map[string]scanCacheEntry
)

// directoryStamp is a cheap fingerprint of the inputs Scan turns into plugin
// metadata. It covers the directory listing, each plugin directory's mtime
// (add or remove a file inside it), and each manifest's mtime and size
// (editing manifest.json does not change the directory mtime).
func directoryStamp(dir string) (string, bool) {
	info, err := os.Stat(dir)
	if err != nil {
		return "", false
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	var b strings.Builder
	fmt.Fprintf(&b, "dir:%d\n", info.ModTime().UnixNano())
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if entry.IsDir() {
			mt := int64(0)
			if fi, infoErr := entry.Info(); infoErr == nil {
				mt = fi.ModTime().UnixNano()
			}
			fmt.Fprintf(&b, "d %s %d %s\n", name, mt, manifestStamp(filepath.Join(dir, name, "manifest.json")))
			continue
		}
		fmt.Fprintf(&b, "f %s\n", name)
	}
	return b.String(), true
}

func manifestStamp(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return "-"
	}
	return fmt.Sprintf("%d:%d", fi.ModTime().UnixNano(), fi.Size())
}

func clonePlugins(in []Plugin) []Plugin {
	if in == nil {
		return nil
	}
	out := make([]Plugin, len(in))
	for i, p := range in {
		out[i] = p
		if p.OpenWith != nil {
			copied := make([]string, len(p.OpenWith))
			copy(copied, p.OpenWith)
			out[i].OpenWith = copied
		}
	}
	return out
}

func (p Plugin) Resolve(urlPath string) (string, error) {
	raw := strings.TrimPrefix(strings.ReplaceAll(urlPath, "\\", "/"), "/")
	if raw == "." {
		raw = ""
	}

	if p.File {
		if raw == "" || raw == p.EntryRel || raw == "index.html" {
			return p.FilePath, nil
		}
		if strings.Contains(raw, "..") {
			return "", ErrEscape
		}
		return "", os.ErrNotExist
	}

	if raw == "" {
		raw = p.EntryRel
	}
	if !isSafeRel(raw) {
		return "", ErrEscape
	}
	abs := filepath.Join(p.Root, filepath.FromSlash(path.Clean(raw)))
	if !within(p.Root, abs) {
		return "", ErrEscape
	}
	return abs, nil
}

func loadDirPlugin(root, id string) (Plugin, bool) {
	name := id
	entry := "index.html"
	icon := ""
	openWith := []string{}
	singleInstance := false
	version := ""

	manifestPath := filepath.Join(root, "manifest.json")
	body, err := os.ReadFile(manifestPath)
	if err == nil {
		var manifest Manifest
		if unmarshalErr := json.Unmarshal(body, &manifest); unmarshalErr != nil {
			utils.LogWarnf("skip plugin %s: bad manifest: %v", id, unmarshalErr)
			return Plugin{}, false
		}
		if strings.TrimSpace(manifest.Name) != "" {
			name = strings.TrimSpace(manifest.Name)
		}
		if strings.TrimSpace(manifest.Entry) != "" {
			entry = strings.TrimSpace(manifest.Entry)
		}
		icon = strings.TrimSpace(manifest.Icon)
		if manifest.OpenWith != nil {
			openWith = manifest.OpenWith
		}
		singleInstance = manifest.SingleInstance
		version = strings.TrimSpace(manifest.Version)
	} else if !os.IsNotExist(err) {
		utils.LogWarnf("skip plugin %s: read manifest: %v", id, err)
		return Plugin{}, false
	}

	entry = strings.ReplaceAll(entry, "\\", "/")
	if !isSafeRel(entry) {
		utils.LogWarnf("skip plugin %s: entry escapes plugin root", id)
		return Plugin{}, false
	}
	entryPath := filepath.Join(root, filepath.FromSlash(entry))
	info, err := os.Stat(entryPath)
	if err != nil || info.IsDir() {
		utils.LogWarnf("skip plugin %s: missing entry %s", id, entry)
		return Plugin{}, false
	}

	plugin := Plugin{
		ID:             id,
		Name:           name,
		EntryURL:       "/plugins/" + id + "/" + entry,
		OpenWith:       openWith,
		SingleInstance: singleInstance,
		Version:        version,
		Root:           root,
		EntryRel:       entry,
	}
	applyIcon(&plugin, icon)
	return plugin, true
}

func loadFilePlugin(filePath, id, filename string) Plugin {
	plugin := Plugin{
		ID:             id,
		Name:           id,
		EntryURL:       "/plugins/" + filename,
		OpenWith:       []string{},
		SingleInstance: false,
		Version:        "",
		Root:           filepath.Dir(filePath),
		EntryRel:       filename,
		File:           true,
		FilePath:       filePath,
	}
	return plugin
}

// ResolveRootFile 解析插件目录根下的一个文件（/plugins/index.html、/plugins/qr.html）。
// 单文件插件不套 /plugins/{id}/，这样 index.html 的相对路径能访问同目录其它文件。
func ResolveRootFile(dir, name string) (string, error) {
	if name == "" || name == "." {
		name = "index.html"
	}
	if strings.Contains(name, "..") || strings.ContainsAny(name, "/\\") {
		return "", ErrEscape
	}
	abs := filepath.Join(dir, name)
	if !within(dir, abs) {
		return "", ErrEscape
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", os.ErrNotExist
	}
	return abs, nil
}

func applyIcon(plugin *Plugin, icon string) {
	if icon == "" {
		return
	}
	if !isIconPath(icon) {
		plugin.IconEmoji = icon
		return
	}
	rel := strings.ReplaceAll(icon, "\\", "/")
	if !isSafeRel(rel) {
		utils.LogWarnf("plugin %s: icon escapes plugin root", plugin.ID)
		return
	}
	abs := filepath.Join(plugin.Root, filepath.FromSlash(rel))
	if !within(plugin.Root, abs) {
		utils.LogWarnf("plugin %s: icon escapes plugin root", plugin.ID)
		return
	}
	plugin.IconURL = "/plugins/" + plugin.ID + "/" + rel
}

func isIconPath(icon string) bool {
	if strings.ContainsAny(icon, "/\\") {
		return true
	}
	return filepath.Ext(icon) != ""
}

func isSafeRel(rel string) bool {
	if rel == "" || rel == "." {
		return false
	}
	normalized := strings.ReplaceAll(rel, "\\", "/")
	if path.IsAbs(normalized) || filepath.IsAbs(rel) {
		return false
	}
	for _, part := range strings.Split(normalized, "/") {
		if part == ".." {
			return false
		}
	}
	return true
}

func within(root, abs string) bool {
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
