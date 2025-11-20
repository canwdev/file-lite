package middlewares

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

var skipPaths = map[string]bool{
	"/files/stream":      true,
	"/files/download":    true,
	"/files/upload-file": true,
}

type counter struct {
	count  int
	window time.Time
}

var mu sync.Mutex
var store = map[string]*counter{}

func RateLimiter() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			rp := c.Request().URL.Path
			if strings.HasSuffix(rp, "/files/stream") || strings.HasSuffix(rp, "/files/download") || strings.HasSuffix(rp, "/files/upload-file") {
				return next(c)
			}
			ip := c.RealIP()
			now := time.Now()
			mu.Lock()
			ct, ok := store[ip]
			if !ok || now.Sub(ct.window) > time.Minute {
				ct = &counter{count: 0, window: now}
				store[ip] = ct
			}
			ct.count++
			mu.Unlock()
			if ct.count > 1000 {
				return c.JSON(http.StatusTooManyRequests, map[string]string{"message": "Too many requests, please try again later."})
			}
			return next(c)
		}
	}
}
