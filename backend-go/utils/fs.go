package utils

import (
	"os"
	"path/filepath"
	"strings"
)

func ExeDir() string {
	exe, _ := os.Executable()
	return filepath.Dir(exe)
}

func DirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// IsPathInsideOrEqual 判断 targetPath 是否就是 parentPath 本身、或位于其子树之内。
//
// 用于挡住「把目录移动 / 复制进自己的子树」——那会边搬边删、把源删掉，或撑爆任务队列。
//
// 两侧都先 filepath.Abs 再按段边界比较。这个检查是**词法**的，理由：
//
//   - 目标尚不存在时也必须判（「移动到自己的新子目录」正是要拦的场景），
//     所以不能依赖 os.Stat / os.SameFile；
//   - 父路径里含符号链接时，词法判断跟着链接走，与实际指向一致，不会误判；
//   - 唯一的例外是不区分大小写的文件系统：`SRC` 与 `src` 是同一个目录，这里按
//     不同字符串处理。Windows 上 os.Rename 自己会拒绝这类请求，因此不额外折叠
//     大小写——那反而会在大小写敏感的平台上把两个不同目录误判成同一个。
func IsPathInsideOrEqual(targetPath, parentPath string) bool {
	parent, err := filepath.Abs(parentPath)
	if err != nil {
		return false
	}
	target, err := filepath.Abs(targetPath)
	if err != nil {
		return false
	}
	if target == parent {
		return true
	}
	return strings.HasPrefix(target, parent+string(filepath.Separator))
}
