package routes

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/utils"
)

// revealInHost 实现 POST /api/host/reveals：在宿主机的文件管理器里打开若干路径。
//
// 交给外部程序的是本机路径（资源管理器只认本机路径），但先按 VFS 规则解析一次：
// 这样非法路径报的是 400，而不是把一条畸形路径直接喂给 ShellExecute。
func revealInHost(c echo.Context) error {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	if len(body.Paths) == 0 {
		return apierr.BadRequest(apierr.CodeBadRequest, "paths parameter is required")
	}

	osPaths := make([]string, 0, len(body.Paths))
	for _, p := range body.Paths {
		res, apiErr := resolvePath(p)
		if apiErr != nil {
			return apiErr
		}
		if !isExist(res.OSPath()) {
			return apierr.NotFound(apierr.CodePathNotFound, "Path not found: "+p)
		}
		osPaths = append(osPaths, res.OSPath())
	}

	if err := utils.RevealInHostExplorer(osPaths); err != nil {
		return apierr.Internal(apierr.CodeInternal, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}
