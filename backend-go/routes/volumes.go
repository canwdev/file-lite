package routes

import (
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
	"file-lite-go/types"
	"file-lite-go/utils"
)

// visibleDrives 返回配置的访问范围之内可以暴露的位置。
//
// 未配 allowedRoots 时就是 enumerateDrives() 的原样结果。
//
// 配了之后，**允许的根本身就是列表里的根**：
//
//   - 只保留**落在某个允许根之内**的挂载点——这同时解决两件事：列表就是枚举面，
//     不收窄等于继续告诉调用方「这台机器上有什么」；而挂载点又是「上一级」的停点，
//     留下范围外的就等于把出口留在范围外。
//   - **包含允许根的那个挂载点会被这条规则挡住**，这正是要的效果：`D:` 包含
//     `D:/Projects/app/bin`，如果按「包含允许根就保留」的直觉留下它，侧边栏就会
//     显示 D: 根，用户点进去只拿到 403（这个例子来自实际反馈）。
//   - 允许根**之内**更深的挂载点是范围内的位置，保留（reload、容量这些信息仍然有用）。
//
// 每条允许根随后都作为一个位置列出来，除非它已经恰好是枚举结果里的某一项。
// 多条时没有「唯一根」可推导，所以直接列出用户配置的那几条——最不会误解的呈现。
// 嵌套的允许根已由 fileops 折叠。
//
// **必须是幂等的**：挂载表由本函数的结果建立，而本函数又被 /api/volumes 反复调用。
// 判断「这条允许根是不是已经列出来了」不能去问挂载表——第一次调用把合成的项写进
// 表里之后，第二次就会答「已经有」，于是原样返回全盘列表。这一条是实测踩出来的。
func visibleDrives() []types.Drive {
	roots := fileops.AllowedRoots()
	all := enumerateDrivesFn()
	if len(roots) == 0 {
		return all
	}

	// 范围内更深的挂载点保留下来。
	out := make([]types.Drive, 0, len(all)+len(roots))
	for _, d := range all {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			continue
		}
		if fileops.IsWithinRoots(root, roots) {
			out = append(out, d)
		}
	}

	// 每条允许根都作为一个位置列出，除非它已经恰好是枚举结果里的某个根
	// （那种情况下上面的循环已经把它留下了）。判据只看**枚举结果**，不看挂载表，
	// 理由见上面的幂等说明。
	for _, root := range fileops.TopLevelAllowedRoots() {
		if fileops.InDrives(all, root) {
			continue
		}
		kind := types.DriveKindVolume
		if fileops.IsNetworkTarget(root) {
			kind = types.DriveKindNetwork
		}
		out = append(out, types.Drive{Label: fileops.BaseName(root), Path: root, Kind: kind})
	}
	return out
}

// enumerateDrives 枚举可导航的位置：Home + 本机卷 / 网络位置。
//
// 侧边栏展示它，启动时也用它填充 fileops 的挂载表——两者必须是同一份数据，
// 否则「界面上的盘」与「解析器认识的挂载点」会漂移。
func enumerateDrives() []types.Drive {
	home, _ := os.UserHomeDir()
	list := make([]types.Drive, 0, 8)
	if home != "" {
		list = append(list, types.Drive{Label: "Home", Path: home, Kind: types.DriveKindHome})
	}
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") || runtime.GOOS == "windows" {
		list = append(list, utils.GetWindowsDrives()...)
	} else {
		list = append(list, utils.GetUnixMounts()...)
	}
	return list
}

// enumerateDrivesFn 间接一层，便于测试注入固定的位置列表：`visibleDrives` 的输入
// 就是「枚举结果」，只注入挂载表的话构造不出它真正要处理的那份输入。
// 生产路径上恒为 enumerateDrives。
var enumerateDrivesFn = enumerateDrives

// getDrives 实现 GET /api/volumes。
func getDrives(c echo.Context) error {
	return c.JSON(http.StatusOK, visibleDrives())
}
