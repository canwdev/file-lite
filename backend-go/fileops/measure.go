package fileops

import (
	"context"
	"os"
	"path/filepath"
)

// TreeSize 是目录子树的递归统计结果。
type TreeSize struct {
	// Files 是子树内的文件数（符号链接按一个条目计入）。
	Files int
	// Folders 是子树内的子目录数，不含 root 自身（与 Windows「包含」一致）。
	Folders int
	// Bytes 是常规文件（含符号链接自身）的字节总量。
	Bytes int64
	// Complete 为 false 表示 ctx 被取消 / 超时，统计只覆盖了已完成的部分。
	Complete bool
}

// MeasureTree 递归统计 root 子树。规则与 countFiles 一致：不跟随符号链接，
// 因此目录链接不会造成环。ctx 取消或超时后返回已完成的部分并把 Complete 置为 false。
func MeasureTree(ctx context.Context, root string) TreeSize {
	size := TreeSize{Complete: true}
	measureInto(ctx, root, &size)
	if ctx.Err() != nil {
		size.Complete = false
	}
	return size
}

func measureInto(ctx context.Context, p string, size *TreeSize) {
	if ctx.Err() != nil {
		return
	}
	info, err := os.Lstat(p)
	if err != nil {
		return
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		size.Files++
		size.Bytes += info.Size()
		return
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		return
	}
	for _, e := range entries {
		if ctx.Err() != nil {
			return
		}
		if e.IsDir() {
			size.Folders++
		}
		measureInto(ctx, filepath.Join(p, e.Name()), size)
	}
}
