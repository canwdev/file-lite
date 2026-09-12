package fileops

import (
	"crypto/rand"
	"encoding/hex"
	"path/filepath"

	"file-lite-go/utils"
)

// TempPathFor 生成目标文件同目录下的临时文件路径。
//
// 必须与目标同目录，才能保证 os.Rename 在同一文件系统内原子生效——
// 这是「磁盘上不出现半个文件」的全部实现基础。
//
// 名字用随机后缀：崩溃后即便留下孤儿临时文件，也不会和后续复制撞名。
func TempPathFor(dst string) string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return filepath.Join(filepath.Dir(dst), utils.TempFilePrefix+"unknown")
	}
	return filepath.Join(filepath.Dir(dst), utils.TempFilePrefix+hex.EncodeToString(buf))
}
