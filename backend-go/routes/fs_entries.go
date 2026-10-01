package routes

import (
	"net/http"
	"os"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
)

// getEntry 实现 GET /api/fs/entries/{path}：单个条目的元数据。
//
// 与列目录返回的条目同一形状，供前端在改名 / 原地变更之后只刷新一行。
func getEntry(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}
	osPath := res.OSPath()

	li, err := os.Lstat(osPath)
	if err != nil {
		return fsError(err, res.Network())
	}
	st, err := os.Stat(osPath)
	if err != nil {
		return fsError(err, res.Network())
	}
	entry := entryFromStat(fileops.BaseName(res.Path), st, osPath, li.Mode()&os.ModeSymlink != 0)
	entry.Path = res.Path

	return c.JSON(http.StatusOK, map[string]any{
		"path":  res.Path,
		"entry": entry,
	})
}
