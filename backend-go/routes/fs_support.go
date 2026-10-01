package routes

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/types"
	"file-lite-go/utils"
)

// 本文件是文件系统端点共用的小工具：条目形状、查询参数解析、递归平铺的边界。
// 具体端点分别在 fs_directories.go / fs_entries.go / fs_content.go / fs_writes.go。

func isExist(p string) bool { _, err := os.Stat(p); return err == nil }

// 判定条目是否为链接：符号链接 / Windows 目录链接（junction）/
// 硬链接（文件 nlink > 1；目录的 nlink 会随子目录增多，不能作为依据）。
func entryFromStat(name string, st os.FileInfo, path string, isSymbolicLink bool) types.Entry {
	isDir := st.IsDir()
	var size *int64
	if !isDir {
		s := st.Size()
		size = &s
	}

	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}

	isLink := isSymbolicLink
	if !isLink && !isDir && utils.HardLinkCount(st, path) > 1 {
		isLink = true
	}

	modTime := st.ModTime().UnixMilli()
	// 创建时间在部分平台 / 文件系统上拿不到，此时与修改时间保持一致（旧行为）。
	birthtime, ok := utils.BirthTime(path, st)
	if !ok {
		birthtime = modTime
	}
	return types.Entry{Name: name, Ext: ext, IsDirectory: isDir, IsLink: isLink, Hidden: strings.HasPrefix(name, "."), LastModified: modTime, Birthtime: birthtime, Size: size, Error: nil}
}

// entryFromStatError 把一次读不到的条目也变成列表里的一行：`error` 有值、大小为 0。
// 一个条目读不到（权限、断链）不该让整个目录打不开。
func entryFromStatError(e os.DirEntry, err error) types.Entry {
	name := e.Name()
	isDir := e.IsDir()
	var size *int64
	if !isDir {
		size = ptrI64(0)
	}

	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}

	msg := err.Error()
	return types.Entry{Name: name, Ext: ext, IsDirectory: isDir, IsLink: e.Type()&os.ModeSymlink != 0, Hidden: strings.HasPrefix(name, "."), LastModified: 0, Birthtime: 0, Size: size, Error: &msg}
}

func queryTruthy(c echo.Context, key string) bool {
	v := strings.ToLower(strings.TrimSpace(c.QueryParam(key)))
	return v == "1" || v == "true" || v == "yes"
}

// flattenListLimit 是递归平铺的条目上限：超过就报错，而不是回一份不完整的结果
// （调用方会以为「就这么多了」）。
const flattenListLimit = 1000000

var errFlattenLimit = errors.New("this folder has too many files to flatten")

// entryHiddenRel 判断相对路径上是否有任何一段以点开头：平铺列表里的文件可能藏在
// 隐藏目录里，只看 basename 会把它当成可见项。
func entryHiddenRel(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func ptrI64(v int64) *int64 { return &v }
