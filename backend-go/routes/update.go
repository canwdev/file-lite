package routes

import (
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/middlewares"
	"file-lite-go/updater"
	"file-lite-go/utils"
)

// restartDelay 是「先回响应、再停服重启」之间的等待时间。响应必须真的写回浏览器，
// 否则用户看到的是连接被重置，而不是「更新成功，正在重启」。
const restartDelay = 500 * time.Millisecond

// registerServerRoutes 注册自更新、重启与退出这三条高危端点，见 docs/design/api.md §10。
// enabled 为 false 时一条都不注册：调用方拿到 404，而不是 401/403 —— 端点不存在本身就是答案。
func registerServerRoutes(api *echo.Group, enabled bool) {
	if !enabled {
		return
	}
	server := api.Group("/server", middlewares.AuthMiddleware)
	// 上传新二进制是一次创建（POST /server/updates）；重启用 POST（一次重启请求），
	// 停止进程用 DELETE /server —— 服务端资源本身被删掉。
	server.POST("/updates", applyUpdate)
	server.POST("/restarts", restartBackend)
	server.DELETE("", exitBackend)
}

// restartBackend 用原来的 argv / 环境变量把进程重新拉起来，用来重载配置。
// 和自更新走同一条交接路径，区别只是不换文件。
func restartBackend(c echo.Context) error {
	utils.LogWarnf("restart requested from %s", middlewares.ClientIP(c))

	go func() {
		time.Sleep(restartDelay)
		if err := updater.Restart(); err != nil {
			utils.LogErrorf("restart failed: %v", err)
			os.Exit(1)
		}
		// Unix 上 Restart 是 syscall.Exec，不会走到这里；Windows 上它起了分离子进程，
		// 父进程必须退出，否则端口被占着。
		os.Exit(0)
	}()

	// 202：请求已受理，重启在响应之后发生。
	return c.JSON(http.StatusAccepted, map[string]string{"message": "Restarting"})
}

// exitBackend 直接结束后端进程（Development → Enable Debug 里的开发功能）。
// 和自更新一样：先回响应，再停服退出，否则浏览器看到的是连接被重置。
func exitBackend(c echo.Context) error {
	utils.LogWarnf("exit requested from %s", middlewares.ClientIP(c))

	go func() {
		time.Sleep(restartDelay)
		updater.Stop()
		os.Exit(0)
	}()

	// 202：请求已受理，进程在响应之后退出。
	return c.JSON(http.StatusAccepted, map[string]string{"message": "Exiting"})
}

// applyUpdate 接收一个新的后端二进制（请求体就是它本身），校验、替换当前文件，
// 然后在响应之后重启进程。换文件放在响应之前：失败时服务还在，可以把原因直接回给调用方。
//
// 不走 multipart：请求体直接喂给 updater.Install，省掉「先落一份临时文件再读一遍」。
func applyUpdate(c echo.Context) error {
	version, err := updater.Install(c.Request().Body)
	if err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, err.Error())
	}
	utils.LogWarnf("self-update: v%s -> v%s, restarting", config.Version, version)

	go func() {
		time.Sleep(restartDelay)
		if err := updater.Restart(); err != nil {
			utils.LogErrorf("self-update: restart failed: %v", err)
			os.Exit(1)
		}
		// Unix 上 Restart 是 syscall.Exec，不会走到这里；Windows 上它起了分离子进程，
		// 父进程必须退出，否则端口被占着。
		os.Exit(0)
	}()

	return c.JSON(http.StatusOK, map[string]string{
		"message": "Updated, restarting",
		"from":    config.Version,
		"to":      version,
	})
}
