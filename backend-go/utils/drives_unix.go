//go:build !windows

package utils

import (
	"bufio"
	"os"
	"strings"

	"file-lite-go/types"
)

func GetWindowsDrives() []types.Drive {
	return []types.Drive{}
}

func GetUnixMounts() []string {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return []string{"/"}
	}
	defer f.Close()
	var mounts []string
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) >= 2 {
			m := parts[1]
			if strings.HasPrefix(m, "/") {
				mounts = append(mounts, m)
			}
		}
	}
	if len(mounts) == 0 {
		mounts = []string{"/"}
	}
	return mounts
}
