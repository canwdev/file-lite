package utils

import (
    "os"
    "path/filepath"
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