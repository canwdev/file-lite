// Package fileops 提供与 HTTP / WebSocket 无关的文件操作原语：
// 可取消的复制 / 移动 / 删除、临时文件原子发布、冲突检测与策略。
//
// 设计要点：任何常规文件都先写成「目标同目录下的临时文件」，写完并校验后
// 再 os.Rename 原子发布。因此磁盘上永远不会出现半个文件——取消或出错时
// 临时文件被删除，已发布的文件一定是完整的。
package fileops

import (
	"os"
	"path/filepath"
	"strings"

	"file-lite-go/config"
)

// IsPathSafe 判断路径是否位于 safeBaseDir 之内。safeBaseDir 为空表示不限制。
func IsPathSafe(p string) bool {
	if p == "" {
		return false
	}
	base := config.SafeBaseDir()
	if base == "" {
		return true
	}
	rp, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	bp, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(bp, rp)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

// ExistsAt 用 Lstat 判断路径是否存在。
// 不用 os.Stat：断链的符号链接也应该被判定为「已存在」，
// 否则覆盖 / 重命名会走到错误分支。
func ExistsAt(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// BaseName 返回路径的最后一段。
func BaseName(p string) string {
	return filepath.Base(filepath.Clean(p))
}

// Clean 归一化路径。
func Clean(p string) string {
	return filepath.Clean(p)
}

// lstat 是 os.Lstat 的薄封装，统一本包内的存在性 / 类型判断入口。
func lstat(p string) (os.FileInfo, error) {
	return os.Lstat(p)
}
