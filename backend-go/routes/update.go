package routes

import (
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/middlewares"
	"file-lite-go/updater"
	"file-lite-go/utils"
)

// restartDelay 是「先回响应、再停服重启」之间的等待时间。响应必须真的写回浏览器，
// 否则用户看到的是连接被重置，而不是「更新成功，正在重启」。
const restartDelay = 500 * time.Millisecond

func registerUpdate(g *echo.Group) {
	g.POST("", applyUpdate)
	g.POST("/exit", exitBackend)
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

	return c.JSON(http.StatusOK, map[string]string{"message": "Exiting"})
}

// applyUpdate 接收一个新的后端二进制，校验、替换当前文件，然后在响应之后重启进程。
// 换文件放在响应之前：失败时服务还在，可以把原因直接回给调用方。
func applyUpdate(c echo.Context) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	src, err := fh.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	defer src.Close()

	version, err := updater.Install(src)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": err.Error()})
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
