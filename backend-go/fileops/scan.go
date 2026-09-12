package fileops

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// MaxConflicts 是一次冲突事件里携带的冲突条目上限。
// 超出部分只计数不传输，避免「把一万个文件粘贴到同名目录树」时把 WS 消息撑爆。
const MaxConflicts = 200

// ScanResult 是复制 / 移动前的预扫描结果。
// 扫描阶段不修改磁盘，因此冲突弹窗出现时是零副作用的。
type ScanResult struct {
	// ItemsTotal 是需要处理的文件数（目录不计入）。
	ItemsTotal int
	// BytesTotal 是常规文件的字节总和。
	BytesTotal int64
	// Conflicts 是前 MaxConflicts 条冲突；ConflictTotal 是真实总数。
	Conflicts     []Conflict
	ConflictTotal int
	Truncated     bool
}

// Scan 预扫描源路径，统计总量并收集冲突。
//
// 冲突判定遵循 Windows 资源管理器语义：目录 vs 目录静默合并（递归下去找叶子冲突），
// 其余组合在第一个不同点上报一次冲突并停止下探。
func Scan(ctx context.Context, fromPaths []string, toDir string) (ScanResult, error) {
	res := ScanResult{}
	for _, src := range fromPaths {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if !ExistsAt(src) {
			return res, errors.New("Source path does not exist: " + src)
		}
		if !IsPathSafe(src) || !IsPathSafe(toDir) {
			return res, errors.New("Path is not safe")
		}
		dst := filepath.Join(toDir, BaseName(src))
		if samePath(src, dst) {
			// 原地粘贴：执行阶段会自动改名（复制）或跳过（移动），不是冲突，
			// 因此不该让任务停下来等用户决策。
			if err := countSubtree(ctx, src, &res); err != nil {
				return res, err
			}
			continue
		}
		if err := scanEntry(ctx, src, dst, BaseName(src), &res); err != nil {
			return res, err
		}
	}
	return res, nil
}

// ScanForDelete 统计删除任务的条目数（文件和目录都算一项）。
func ScanForDelete(ctx context.Context, paths []string) (int, error) {
	total := 0
	for _, p := range paths {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := countEntries(ctx, p)
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

func scanEntry(ctx context.Context, srcPath, dstPath, relPath string, res *ScanResult) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := lstat(srcPath)
	if err != nil {
		// 扫描期间源消失：跳过，执行阶段再如实报错
		return nil
	}

	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		res.ItemsTotal++
		if !info.IsDir() {
			res.BytesTotal += info.Size()
		}
		addConflict(srcPath, dstPath, relPath, res)
		return nil
	}

	dstInfo, dstErr := lstat(dstPath)
	if dstErr != nil {
		// 目标不存在：整棵子树都是新增
		return countSubtree(ctx, srcPath, res)
	}
	if !dstInfo.IsDir() {
		// 目录 vs 文件：整体替换 / 跳过，不再下探
		addConflict(srcPath, dstPath, relPath, res)
		return countSubtree(ctx, srcPath, res)
	}

	// 目录 vs 目录：静默合并，递归检查子项
	entries, err := os.ReadDir(srcPath)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		childRel := e.Name()
		if relPath != "" {
			childRel = relPath + "/" + e.Name()
		}
		if err := scanEntry(ctx, filepath.Join(srcPath, e.Name()), filepath.Join(dstPath, e.Name()), childRel, res); err != nil {
			return err
		}
	}
	return nil
}

func countSubtree(ctx context.Context, srcPath string, res *ScanResult) error {
	info, err := lstat(srcPath)
	if err != nil {
		return nil
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		res.ItemsTotal++
		if !info.IsDir() {
			res.BytesTotal += info.Size()
		}
		return nil
	}
	entries, err := os.ReadDir(srcPath)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := countSubtree(ctx, filepath.Join(srcPath, e.Name()), res); err != nil {
			return err
		}
	}
	return nil
}

func countEntries(ctx context.Context, p string) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	info, err := lstat(p)
	if err != nil {
		return 0, nil
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return 1, nil
	}
	total := 1
	entries, err := os.ReadDir(p)
	if err != nil {
		return total, nil
	}
	for _, e := range entries {
		n, err := countEntries(ctx, filepath.Join(p, e.Name()))
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

func addConflict(srcPath, dstPath, relPath string, res *ScanResult) {
	c, ok := ClassifyConflict(srcPath, dstPath)
	if !ok {
		return
	}
	c.RelativePath = relPath
	res.ConflictTotal++
	if len(res.Conflicts) >= MaxConflicts {
		res.Truncated = true
		return
	}
	res.Conflicts = append(res.Conflicts, c)
}
