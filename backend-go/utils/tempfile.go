package utils

import "strings"

// TempFilePrefix 是文件操作内部临时文件的保留前缀。
//
// 放在 utils 而不是 fileops，是因为 zip 打包（utils/zip.go）也要过滤它，
// 而 fileops 依赖 utils，反向引用会形成循环。
//
// 约定的三件事：
//   - 列表接口过滤该前缀（用户看不见）
//   - 创建 / 重命名 / 上传拒绝该前缀（用户造不出来）
//   - 以 "." 开头，万一过滤失效也会被当成隐藏文件
const TempFilePrefix = ".fl-part-"

// IsReservedTempName 判断名字是否占用了内部临时文件前缀。
func IsReservedTempName(name string) bool {
	return strings.HasPrefix(name, TempFilePrefix)
}
