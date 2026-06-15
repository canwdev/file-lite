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

func FileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// IsPathInsideOrEqual reports whether target is parent itself or nested under parent.
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
