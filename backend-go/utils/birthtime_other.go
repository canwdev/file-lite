//go:build !linux && !darwin && !windows

package utils

import "os"

// BirthTime 在没有创建时间支持的系统上返回 ok=false，调用方回落到修改时间。
func BirthTime(_ string, _ os.FileInfo) (int64, bool) { return 0, false }
