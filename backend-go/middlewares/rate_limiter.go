package middlewares

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	rateLimitWindow          = time.Minute
	rateLimitMaxRequests     = 1000
	rateLimitCleanupInterval = time.Minute
)

var skipPaths = map[string]bool{
	"/api/files/stream":      true,
	"/api/files/download":    true,
	"/api/files/upload-file": true,
}

type counter struct {
	count  int
	window time.Time
}

var mu sync.Mutex
var store = map[string]*counter{}
var lastCleanupAt time.Time

func RateLimiter() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			rp := c.Request().URL.Path
			if skipPaths[rp] {
				return next(c)
			}
			ip := c.RealIP()
			now := time.Now()
			mu.Lock()
			cleanupExpiredCounters(now)

			ct, ok := store[ip]
			if !ok || now.Sub(ct.window) >= rateLimitWindow {
				ct = &counter{count: 0, window: now}
				store[ip] = ct
			}
			ct.count++
			limited := ct.count > rateLimitMaxRequests
			mu.Unlock()
			if limited {
				return c.JSON(http.StatusTooManyRequests, map[string]string{"message": "Too many requests, please try again later."})
			}
			return next(c)
		}
	}
}

func cleanupExpiredCounters(now time.Time) {
	if !lastCleanupAt.IsZero() && now.Sub(lastCleanupAt) < rateLimitCleanupInterval {
		return
	}
	lastCleanupAt = now

	for ip, ct := range store {
		if now.Sub(ct.window) >= rateLimitWindow {
			delete(store, ip)
		}
	}
}
