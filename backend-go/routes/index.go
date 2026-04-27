package routes

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"file-lite-go/middlewares"
)

func Register(api *echo.Group) {
	api.GET("/", func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})
	files := api.Group("/files")
	files.Use(middlewares.AuthMiddleware)
	registerFiles(files)
}
