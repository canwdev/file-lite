package middlewares

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
)

type ipLimiter struct {
	failures    map[string]int
	banned      map[string]time.Time
	maxAttempts int
	banDuration time.Duration
}

func newIPLimiter() *ipLimiter {
	return &ipLimiter{failures: map[string]int{}, banned: map[string]time.Time{}, maxAttempts: 5, banDuration: 15 * time.Minute}
}

func (l *ipLimiter) check(ip string) (bool, int) {
	if t, ok := l.banned[ip]; ok {
		if time.Now().After(t) {
			delete(l.banned, ip)
			delete(l.failures, ip)
			return false, 0
		}
		left := int(time.Until(t).Minutes() + 0.5)
		return true, left
	}
	return false, 0
}

func (l *ipLimiter) recordFailure(ip string) {
	c := l.failures[ip] + 1
	l.failures[ip] = c
	if c > l.maxAttempts {
		l.ban(ip)
	}
}

func (l *ipLimiter) recordSuccess(ip string) { delete(l.failures, ip) }

func (l *ipLimiter) ban(ip string) {
	l.banned[ip] = time.Now().Add(l.banDuration)
	delete(l.failures, ip)
}

var authLimiter = newIPLimiter()

func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if config.Config().NoAuth {
			return next(c)
		}
		ip := c.RealIP()
		banned, left := authLimiter.check(ip)
		if banned {
			return c.JSON(http.StatusForbidden, map[string]any{"message": fmtMsg("Too many failed attempts. Please try again in %d minutes.", left)})
		}
		token := c.Request().Header.Get("Authorization")
		if token == "" {
			token = c.QueryParam("auth")
		}
		if token == config.AuthToken() {
			authLimiter.recordSuccess(ip)
			return next(c)
		}
		authLimiter.recordFailure(ip)
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Authorization failed"})
	}
}

func fmtMsg(format string, v int) string { return fmt.Sprintf(format, v) }
