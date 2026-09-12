package routes

import (
	"os"
	"path/filepath"

	"file-lite-go/fileops"
	"file-lite-go/tasks"
	"file-lite-go/types"
)

// fsDirChange 描述一个目录里发生的条目级变化，供客户端原地打补丁。
// added / updated 都是「最终应该出现在这个目录里的条目」，客户端按名字 upsert 即可；
// 区分只为了语义：更新已有条目（例如 overwrite）与新建。
type fsDirChange struct {
	Dir     string        `json:"dir"`
	Added   []types.Entry `json:"added,omitempty"`
	Updated []types.Entry `json:"updated,omitempty"`
	Removed []string      `json:"removed,omitempty"`
}

// maxChangeEntries 是一次变更集里条目的上限。超过就只发 paths，让前端退回整目录刷新，
// 避免「把一万个条目粘进同一个目录」时把 WS 消息撑爆。
const maxChangeEntries = 2000

// dirChangesForTask 把一次任务的顶层结果翻译成「哪些目录增减了哪些条目」。
//
// 只用顶层结果（不受 done 的 200 条 / 引擎的 500 条上限约束）：
// 目录下的子文件变化不影响当前目录的列表，改了哪些顶层名字才是列表要画的。
func dirChangesForTask(snap tasks.Snapshot, topLevel []fileops.ItemResult) []fsDirChange {
	if len(topLevel) > maxChangeEntries {
		return nil
	}
	byDir := map[string]*fsDirChange{}
	order := make([]string, 0, len(topLevel))

	dirOf := func(dir string) *fsDirChange {
		dir = filepath.Clean(dir)
		if c, ok := byDir[dir]; ok {
			return c
		}
		c := &fsDirChange{Dir: dir}
		byDir[dir] = c
		order = append(order, dir)
		return c
	}

	for _, r := range topLevel {
		switch r.Status {
		case fileops.StatusCopied, fileops.StatusMoved, fileops.StatusReplaced, fileops.StatusRenamed:
			if r.ToPath == "" {
				continue
			}
			entry, ok := statEntry(r.ToPath)
			if !ok {
				continue
			}
			destDir := filepath.Dir(r.ToPath)
			c := dirOf(destDir)
			if r.Status == fileops.StatusReplaced {
				c.Updated = append(c.Updated, entry)
			} else {
				c.Added = append(c.Added, entry)
			}
			// move 会把源从原目录拿掉；copy / duplicate 源不动。
			if snap.Kind == tasks.KindMove {
				srcDir := filepath.Clean(filepath.Dir(r.FromPath))
				if srcDir != filepath.Clean(destDir) {
					src := dirOf(srcDir)
					src.Removed = append(src.Removed, filepath.Base(r.FromPath))
				}
			}
		case fileops.StatusDeleted:
			c := dirOf(filepath.Dir(r.FromPath))
			c.Removed = append(c.Removed, filepath.Base(r.FromPath))
		}
	}

	out := make([]fsDirChange, 0, len(order))
	for _, dir := range order {
		change := byDir[dir]
		if len(change.Added) == 0 && len(change.Updated) == 0 && len(change.Removed) == 0 {
			continue
		}
		change.Added = dedupeEntries(change.Added)
		change.Updated = dedupeEntries(change.Updated)
		change.Removed = dedupeStrings(change.Removed)
		out = append(out, *change)
	}
	return out
}

// statEntry 读一个路径的列表条目形态。失败时调用方回退到整目录刷新。
func statEntry(path string) (types.Entry, bool) {
	li, err := os.Lstat(path)
	if err != nil {
		return types.Entry{}, false
	}
	st, err := os.Stat(path)
	if err != nil {
		return types.Entry{}, false
	}
	return entryFromStat(filepath.Base(path), st, path, li.Mode()&os.ModeSymlink != 0), true
}

func dedupeEntries(entries []types.Entry) []types.Entry {
	if len(entries) < 2 {
		return entries
	}
	seen := make(map[string]struct{}, len(entries))
	out := entries[:0]
	for _, e := range entries {
		if _, ok := seen[e.Name]; ok {
			continue
		}
		seen[e.Name] = struct{}{}
		out = append(out, e)
	}
	return out
}

func dedupeStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	seen := make(map[string]struct{}, len(values))
	out := values[:0]
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
