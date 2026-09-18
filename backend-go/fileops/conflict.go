package fileops

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// Policy 是冲突处理策略。
type Policy string

const (
	// PolicyAsk 暂停任务并等待用户决策。
	PolicyAsk Policy = "ask"
	// PolicyOverwrite 用源替换目标（对应资源管理器的 Replace）。
	PolicyOverwrite Policy = "overwrite"
	// PolicySkip 保留目标，跳过该项。
	PolicySkip Policy = "skip"
	// PolicyKeepBoth 保留双方，源以新名字落盘。
	PolicyKeepBoth Policy = "keep-both"
)

// NormalizePolicy 把外部字符串归一化为合法策略，未知值回落到 PolicyAsk。
func NormalizePolicy(raw string) Policy {
	switch Policy(raw) {
	case PolicyOverwrite, PolicySkip, PolicyKeepBoth, PolicyAsk:
		return Policy(raw)
	default:
		return PolicyAsk
	}
}

// ConflictKind 描述冲突类型，决定前端弹窗的措辞。
type ConflictKind string

const (
	ConflictFileVsFile ConflictKind = "file-vs-file"
	ConflictFileVsDir  ConflictKind = "file-vs-dir"
	ConflictDirVsFile  ConflictKind = "dir-vs-file"
)

// Conflict 是一个待决策的冲突项。
// 目录 vs 目录不构成冲突——按 Windows 资源管理器语义直接静默合并，
// 冲突在内部的叶子节点上再判定。
type Conflict struct {
	// RelativePath 是相对于目标目录的路径，"" 表示源本身与目标同名。
	RelativePath      string       `json:"relativePath"`
	Kind              ConflictKind `json:"kind"`
	SourceIsDirectory bool         `json:"sourceIsDirectory"`
	DestIsDirectory   bool         `json:"destIsDirectory"`
	SourceSize        *int64       `json:"sourceSize,omitempty"`
	DestSize          *int64       `json:"destSize,omitempty"`
	SourceMtime       int64        `json:"sourceMtime,omitempty"`
	DestMtime         int64        `json:"destMtime,omitempty"`
}

// classifyConflict 判断源与目标是否构成需要用户决策的冲突。
// 返回 ok=false 表示不是冲突：目标不存在，或者双方都是目录（静默合并）。
func classifyConflict(srcPath, dstPath string) (Conflict, bool) {
	srcInfo, err := lstat(srcPath)
	if err != nil {
		return Conflict{}, false
	}
	dstInfo, err := lstat(dstPath)
	if err != nil {
		return Conflict{}, false
	}
	srcDir := srcInfo.IsDir()
	dstDir := dstInfo.IsDir()
	if srcDir && dstDir {
		return Conflict{}, false
	}

	c := Conflict{SourceIsDirectory: srcDir, DestIsDirectory: dstDir}
	switch {
	case !srcDir && !dstDir:
		c.Kind = ConflictFileVsFile
	case !srcDir && dstDir:
		c.Kind = ConflictFileVsDir
	default:
		c.Kind = ConflictDirVsFile
	}
	size := srcInfo.Size()
	c.SourceSize = &size
	destSize := dstInfo.Size()
	c.DestSize = &destSize
	c.SourceMtime = srcInfo.ModTime().UnixMilli()
	c.DestMtime = dstInfo.ModTime().UnixMilli()
	return c, true
}

// UniquePath 返回一个不与现有文件冲突的路径：name (1).ext、name (2).ext ……
// 超过上限后回落到带时间戳的名字。
//
// 目标路径可能是 canonical 形式（上传走的是 VFS 路径）。在 Windows 上
// filepath.Dir("D:/a/b.txt") 会返回 "."——盘符 + 正斜杠不是 filepath 认得的形态——
// 于是唯一化会算到当前工作目录里去。所以按形态分流（见 splitPath）。
func UniquePath(p string) string {
	join, dir, base, ext := pathOpsFor(p)

	for i := 1; i < 1000; i++ {
		candidate := join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if !ExistsAt(candidate) {
			return candidate
		}
	}
	return join(dir, fmt.Sprintf("%s (%d)%s", base, time.Now().UnixMilli(), ext))
}

// duplicatePath 返回「复制副本」风格的新路径：name - Copy、name - Copy (2) ……
// 对齐 Windows 在同一目录内复制时的命名习惯。
func duplicatePath(p string) string {
	join, dir, stem, ext := pathOpsFor(p)

	first := join(dir, stem+" - Copy"+ext)
	if !ExistsAt(first) {
		return first
	}
	for i := 2; i < 1000; i++ {
		candidate := join(dir, fmt.Sprintf("%s - Copy (%d)%s", stem, i, ext))
		if !ExistsAt(candidate) {
			return candidate
		}
	}
	return join(dir, fmt.Sprintf("%s - Copy (%d)%s", stem, time.Now().UnixMilli(), ext))
}

// pathOpsFor 按路径形态挑一套「拆分 / 拼回」原语，并返回去掉扩展名的主干。
//
// 只有两种形态会流进这里：
//   - 本机路径（含 "\"）→ filepath 语义，Windows 上还要处理盘符；
//   - canonical VFS 路径（只用 "/"）→ path 语义，且必须能识别 "C:/" 根。
//
// 用错一方的代价是实打实的：在 Windows 上对 "D:/a/b.txt" 用 filepath.Dir 得到 "."，
// 于是「另存为副本」会写到进程的工作目录。
func pathOpsFor(p string) (join func(elem ...string) string, dir, stem, ext string) {
	if strings.ContainsRune(p, '\\') {
		base := filepath.Base(p)
		return filepath.Join, filepath.Dir(p), strings.TrimSuffix(base, filepath.Ext(base)), filepath.Ext(base)
	}
	base := BaseName(p)
	ext = path.Ext(base)
	return path.Join, DirName(p), strings.TrimSuffix(base, ext), ext
}
