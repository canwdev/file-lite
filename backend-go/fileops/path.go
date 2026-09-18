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
)

// ExistsAt 用 Lstat 判断路径是否存在。
// 不用 os.Stat：断链的符号链接也应该被判定为「已存在」，
// 否则覆盖 / 重命名会走到错误分支。
func ExistsAt(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// baseName 返回路径的最后一段。
//
// 这里保持 **filepath** 语义是有意的：调用点是文件操作层，入参来自 os.ReadDir /
// filepath.Join，是本机路径（Windows 上带 "\"）。需要 canonical 语义的地方请用
// BaseName——它同时认两种分隔符。
func baseName(p string) string {
	return filepath.Base(filepath.Clean(p))
}

// Clean 归一化 VFS 路径（canonical 形式）。
//
// 与 CanonicalizePath 的区别：这个函数为了兼容历史调用点而吞掉错误，
// 非法路径（相对路径、越根）原样返回。新代码请直接用 CanonicalizePath 或 Resolve。
func Clean(p string) string {
	if canonical, err := CanonicalizePath(p); err == nil {
		return canonical
	}
	return p
}

// samePath 判断两个路径是否指向同一个位置。
//
// 用来识别「原地粘贴」：把 X 粘贴回 X 自己所在的目录时，目标路径就是源路径。
// 这种情况不能按普通冲突处理——「用自己替换自己」没有意义。
//
// 实现委托给 SamePath（canonical 比较，盘符与 UNC 主机名大小写无关）。
func samePath(a, b string) bool {
	return SamePath(a, b)
}

// lstat 是 os.Lstat 的薄封装，统一本包内的存在性 / 类型判断入口。
func lstat(p string) (os.FileInfo, error) {
	return os.Lstat(p)
}
