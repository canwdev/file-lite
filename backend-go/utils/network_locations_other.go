//go:build !windows

package utils

import "file-lite-go/types"

// networkLocationDrives 只在 Windows 上有意义（Windows 的「网络位置」是
// shell 文件夹 + target.lnk）。非 Windows 平台返回空，保持调用方无需分支。
func networkLocationDrives() []types.Drive {
	return nil
}
