package middlewares

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
)

const (
	// 登录端点：每个 IP 每分钟的请求上限。真正的防爆破靠 authLimiter 的失败封禁，
	// 这里只限制请求洪泛。
	loginRateLimitWindow      = time.Minute
	loginRateLimitMaxRequests = 20
	rateLimitCleanupInterval  = time.Minute
)

type counter struct {
	count  int
	window time.Time
}

// requestLimiter is a per-IP fixed-window request counter.
type requestLimiter struct {
	mu            sync.Mutex
	store         map[string]*counter
	lastCleanupAt time.Time
	limit         int
	window        time.Duration
}

func newRequestLimiter(limit int, window time.Duration) *requestLimiter {
	return &requestLimiter{
		store:  map[string]*counter{},
		limit:  limit,
		window: window,
	}
}

func (l *requestLimiter) allow(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cleanupExpired(now)

	ct, ok := l.store[ip]
	if !ok || now.Sub(ct.window) >= l.window {
		ct = &counter{count: 0, window: now}
		l.store[ip] = ct
	}
	ct.count++
	return ct.count <= l.limit
}

func (l *requestLimiter) cleanupExpired(now time.Time) {
	if !l.lastCleanupAt.IsZero() && now.Sub(l.lastCleanupAt) < rateLimitCleanupInterval {
		return
	}
	l.lastCleanupAt = now
	for ip, ct := range l.store {
		if now.Sub(ct.window) >= l.window {
			delete(l.store, ip)
		}
	}
}

var loginLimiter = newRequestLimiter(loginRateLimitMaxRequests, loginRateLimitWindow)

// LoginRateLimiter throttles POST /api/session per client IP and feeds the
// shared failure ban. Password guessing is stopped at the only endpoint that can
// be guessed; every other API call carries a valid JWT and is not capped by
// request count, so bulk listing and transfers are never rejected.
func LoginRateLimiter() echo.MiddlewareFunc {
	return loginGuard(authLimiter, loginLimiter)
}

func loginGuard(ban *ipLimiter, limiter *requestLimiter) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := clientIP(c)
			if banned, _ := ban.check(ip); banned {
				return apierr.Write(c, apierr.TooManyRequests("Too many attempts, please try again later."))
			}
			if !limiter.allow(ip) {
				return apierr.Write(c, apierr.TooManyRequests("Too many requests, please try again later."))
			}

			err := next(c)
			// 错误可能已经写出（apierr.Write），也可能由集中处理器稍后渲染；
			// 两条路径都要能看出这次登录失败，否则失败封禁会漏记。
			status := c.Response().Status
			if apiErr, ok := err.(*apierr.Error); ok {
				status = apiErr.Status
			}
			switch {
			case status == http.StatusUnauthorized:
				ban.recordFailure(ip)
			case status >= http.StatusOK && status < http.StatusBadRequest:
				ban.recordSuccess(ip)
			}
			return err
		}
	}
}
