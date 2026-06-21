package routes

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
)

func Register(api *echo.Group) {
	api.GET("/", func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})
	api.GET("/ws", handleSharedWebSocket)
	api.POST("/files/auth", authWithPassword)
	files := api.Group("/files")
	files.Use(middlewares.AuthMiddleware)
	registerFiles(files)
}

func authWithPassword(c echo.Context) error {
	var body struct {
		Password string `json:"password"`
		Ticket   string `json:"ticket"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	if body.Ticket != "" {
		token, ok := config.ConsumeAuthTicket(body.Ticket)
		if !ok {
			return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		}
		return c.JSON(http.StatusOK, map[string]string{"token": token})
	}
	if body.Password != config.Config().Password {
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
	}
	token, err := config.NewAuthToken()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
	}
	return c.JSON(http.StatusOK, map[string]string{"token": token})
}
