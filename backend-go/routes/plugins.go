package routes

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/middlewares"
	"file-lite-go/plugins"
)

func registerPluginsAPI(g *echo.Group) {
	g.GET("", func(c echo.Context) error {
		list := plugins.Scan(plugins.Dir())
		if list == nil {
			list = []plugins.Plugin{}
		}
		return c.JSON(http.StatusOK, list)
	})
}

func RegisterPluginStatic(e *echo.Echo) {
	g := e.Group("/plugins")
	g.Use(middlewares.AuthMiddleware)
	g.GET("", servePluginsRoot)
	g.GET("/", servePluginsRoot)
	g.GET("/:id", servePluginFile)
	g.GET("/:id/*", servePluginFile)
}

func servePluginsRoot(c echo.Context) error {
	abs, err := plugins.ResolveRootFile(plugins.Dir(), "index.html")
	return serveAbsFile(c, abs, err, true)
}

func servePluginFile(c echo.Context) error {
	id := c.Param("id")
	rel := c.Param("*")
	dir := plugins.Dir()

	plugin, ok := plugins.Find(dir, id)
	if ok && !plugin.File {
		abs, err := plugin.Resolve(rel)
		inject := err == nil && plugin.IsEntry(abs)
		return serveAbsFile(c, abs, err, inject)
	}

	// 单文件不套 /plugins/{id}/：/plugins/index.html 就是目录里的 index.html。
	if rel != "" {
		return c.NoContent(http.StatusNotFound)
	}
	abs, err := plugins.ResolveRootFile(dir, id)
	return serveAbsFile(c, abs, err, true)
}

func serveAbsFile(c echo.Context, abs string, err error, inject bool) error {
	if errors.Is(err, plugins.ErrEscape) {
		return c.NoContent(http.StatusForbidden)
	}
	if err != nil {
		return c.NoContent(http.StatusNotFound)
	}
	info, statErr := os.Stat(abs)
	if statErr != nil || info.IsDir() {
		return c.NoContent(http.StatusNotFound)
	}
	if inject && strings.EqualFold(filepath.Ext(abs), ".html") {
		body, readErr := os.ReadFile(abs)
		if readErr != nil {
			return c.NoContent(http.StatusNotFound)
		}
		return c.Blob(http.StatusOK, "text/html; charset=utf-8", plugins.InjectSDK(body))
	}
	return c.File(abs)
}
