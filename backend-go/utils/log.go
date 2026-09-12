package utils

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
)

// level 是事件日志等级，数值越大越严重。配置里的 logLevel 是打印阈值：
// 消息等级不低于阈值才打印。none 不是等级，而是「全部关闭」。
type level int

const (
	levelVerbose level = iota
	levelWarn
	levelError
)

// activeLevel 返回当前阈值；enabled 为 false 表示配置为 none。
// 配置在加载时已归一化，default 分支只是兜底（也覆盖尚未加载配置的时刻）。
func activeLevel() (level, bool) {
	switch config.Config().LogLevel {
	case config.LogLevelVerbose:
		return levelVerbose, true
	case config.LogLevelError:
		return levelError, true
	case config.LogLevelNone:
		return 0, false
	default:
		return levelWarn, true
	}
}

func logAt(msgLevel level, tag, format string, args ...any) {
	threshold, enabled := activeLevel()
	if !enabled || msgLevel < threshold {
		return
	}
	fmt.Printf("[%s] [%s] %s\n", time.Now().Format(time.RFC3339), tag, fmt.Sprintf(format, args...))
}

// LogVerbosef 打印 verbose 级日志：HTTP 访问日志等（默认不显示）。
func LogVerbosef(format string, args ...any) { logAt(levelVerbose, "verbose", format, args...) }

// LogWarnf 打印 warn 级日志：登录失败、密码错误等。
func LogWarnf(format string, args ...any) { logAt(levelWarn, "warn", format, args...) }

// LogErrorf 打印 error 级日志：服务端错误、panic 等。
func LogErrorf(format string, args ...any) { logAt(levelError, "error", format, args...) }

// AccessLog 记录每个请求一行：5xx 归 error，其余归 verbose。
// 默认 warn 下正常请求完全静默，但服务端错误仍然可见。
func AccessLog() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)

			req := c.Request()
			status := c.Response().Status
			line := fmt.Sprintf("%d %s %s%s %s", status, req.Method, req.Host, req.RequestURI, time.Since(start))
			if status >= http.StatusInternalServerError {
				LogErrorf("%s", line)
			} else {
				LogVerbosef("%s", line)
			}
			return err
		}
	}
}
