package routes

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/utils"
)

func Register(api *echo.Group) {
	StartSharedWSServices()
	// 存活探测：e2e 的 webServer 就绪检查与运维探针都用它，不要求认证。
	api.GET("/health", healthCheck)
	api.GET("/ws", handleSharedWebSocket)

	registerREST(api)

	speedTest := api.Group("/speed-test", middlewares.AuthMiddleware)
	registerSpeedTest(speedTest)
	pluginAPI := api.Group("/plugins", middlewares.AuthMiddleware)
	registerPluginsAPI(pluginAPI)
	// 替换自身二进制 / 重启 / 退出进程是高危操作：只有 config 里显式打开才注册。
	registerServerRoutes(api, config.Config().AllowSelfUpdate)
}

// registerREST 是 docs/design/api.md 里的资源表。
//
// 路径里的 {path} 是通配段，客户端必须百分号编码；handler 用 entryPath 解码，
// 再交给 fileops.Resolve 做 canonical 化与 allowedRoots 校验。
func registerREST(api *echo.Group) {
	// 只有登录端点可能被爆破：严格限流 + 失败封禁都放在这里。
	api.POST("/session", authWithPassword, middlewares.LoginRateLimiter())
	// Clearing cookies needs no session: an expired token must still be able to
	// log out. Registered outside the authenticated group on purpose.
	api.DELETE("/session", logout)
	session := api.Group("/session", middlewares.AuthMiddleware)
	session.GET("", sessionInfo)
	session.POST("/tickets", createLoginTicket)

	volumes := api.Group("/volumes", middlewares.AuthMiddleware)
	volumes.GET("", getDrives)

	// 挂载表要在任何路径解析之前就位：它决定一条路径属于哪个根。
	// 与侧边栏用同一份枚举结果（visibleDrives），避免两者漂移。
	fileops.SetMounts(visibleDrives())

	fs := api.Group("/fs", middlewares.AuthMiddleware)
	fs.GET("/directories/*", listDirectory)
	fs.PUT("/directories/*", putDirectory)
	fs.GET("/entries/*", getEntry)
	fs.PATCH("/entries/*", patchEntry)
	fs.POST("/entry-queries", queryEntries)
	fs.GET("/content/*", getContent)
	fs.HEAD("/content/*", getContent)
	fs.PUT("/content/*", putContent)
	fs.GET("/thumbnail/*", getThumbnailByPath)
	fs.GET("/downloads", getDownloads)
	fs.POST("/measurements", createMeasurement)
	fs.GET("/measurements/*", getMeasurement)
	fs.DELETE("/measurements/*", deleteMeasurement)

	taskAPI := api.Group("/tasks", middlewares.AuthMiddleware)
	taskAPI.GET("", listTasksAPI)
	taskAPI.POST("", createTaskAPI)
	taskAPI.GET("/:id", getTaskAPI)
	taskAPI.DELETE("/:id", deleteTaskAPI)
	taskAPI.POST("/:id/retries", retryTaskAPI)
	taskAPI.POST("/:id/resolutions", resolveTaskAPI)

	settings := api.Group("/settings", middlewares.AuthMiddleware)
	settings.GET("", getSettings)
	settings.GET("/*", getSetting)
	settings.PUT("/*", putSetting)
	settings.DELETE("/*", deleteSetting)

	host := api.Group("/host", middlewares.AuthMiddleware)
	host.POST("/reveals", revealInHost)
}

func authWithPassword(c echo.Context) error {
	var body struct {
		Password string `json:"password"`
		Ticket   string `json:"ticket"`
		Remember bool   `json:"remember"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.Write(c, apierr.BadRequest(apierr.CodeBadRequest, "Bad Request"))
	}

	token, apiErr := authenticate(c, body.Password, body.Ticket)
	if apiErr != nil {
		return apierr.Write(c, apiErr)
	}

	// The credential leaves in an HttpOnly cookie; the body carries none, so an
	// XSS cannot read the long-lived token out of the response or storage.
	if err := middlewares.SetAuthCookies(c, token, body.Remember); err != nil {
		return apierr.Write(c, apierr.Internal(apierr.CodeInternal, "Failed"))
	}
	return c.JSON(http.StatusCreated, map[string]any{"ok": true})
}

// authenticate 校验密码或一次性票据，返回要写进 cookie 的 token。
//
// JSON 接口与经典 HTML 界面共用它：两边只是响应的形态不同，凭据怎么验必须只有一处。
func authenticate(c echo.Context, password, ticket string) (string, *apierr.Error) {
	if ticket != "" {
		token, ok := config.ConsumeAuthTicket(ticket)
		if !ok {
			return "", apierr.Unauthorized("Unauthorized")
		}
		return token, nil
	}
	if password != config.Config().Password {
		utils.LogWarnf("login failed: wrong password from %s", middlewares.ClientIP(c))
		return "", apierr.Unauthorized("Unauthorized")
	}
	token, err := config.NewAuthToken()
	if err != nil {
		return "", apierr.Internal(apierr.CodeInternal, "Failed")
	}
	return token, nil
}

func logout(c echo.Context) error {
	// Logout needs no session (an expired token must still be able to clear
	// itself), but a live session cookie must pass the double-submit check so
	// another site cannot force a logout.
	if session, err := c.Cookie(middlewares.SessionCookieName); err == nil && session.Value != "" {
		if c.Request().Header.Get(middlewares.CSRFTokenHeader) != session.Value {
			return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
		}
	}
	middlewares.ClearAuthCookies(c)
	return c.NoContent(http.StatusNoContent)
}
