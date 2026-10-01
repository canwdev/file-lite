package routes

import (
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
)

// entryPath 取出通配段里的路径并百分号解码一次。
//
// Echo 在原始（仍带编码的）路径上匹配路由，并且**不会**解码通配参数：编码后的
// `%2F` 因此不会变成目录分隔符，但这里必须显式解码。解码后的值仍然交给
// fileops.Resolve 做 canonical 化与 allowedRoots 校验。见 docs/design/api.md §2。
func entryPath(c echo.Context) (string, *apierr.Error) {
	raw := c.Param("*")
	if raw == "" {
		return "", apierr.BadRequest(apierr.CodeInvalidPath, "path parameter is required")
	}
	decoded, err := url.PathUnescape(raw)
	if err != nil {
		return "", apierr.BadRequest(apierr.CodeInvalidPath, "path is not valid percent-encoding")
	}
	return decoded, nil
}

// canonicalChild 把 canonical 目录与一个条目名接成 canonical 路径。
//
// 不能用 filepath.Join：canonical 形态恒用 "/"，而 Windows 上的 filepath.Join 会写 "\"。
func canonicalChild(dir, name string) string {
	if strings.HasSuffix(dir, "/") {
		return dir + name
	}
	return dir + "/" + name
}
