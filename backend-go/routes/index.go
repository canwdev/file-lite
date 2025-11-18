package routes

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func Register(api *echo.Group) {
	api.GET("/", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]any{"name": config.PkgName, "version": config.Version, "timestamp": time.Now().UnixMilli()})
	})
	files := api.Group("/files")
	files.Use(middlewares.AuthMiddleware)
	registerFiles(files)
}
