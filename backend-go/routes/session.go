package routes

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/sevenzip"
	"file-lite-go/thumbnails"
	"file-lite-go/utils"
)

// healthCheck 实现 GET /api/health：进程活着就是 200，不需要认证。
//
// 它存在的理由是有一个**确定会回 2xx** 的地址：e2e 的 webServer 就绪检查与外部探针
// 都要一个不依赖会话的端点（/api/session 未登录时是 401，不适合当探针）。
func healthCheck(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{"status": "ok"})
}

// sessionInfo 实现 GET /api/session：当前会话能看到的能力与访问范围。
//
// 未登录时认证中间件已经回了 401，因此这里不再带一个恒为 true 的 authenticated 字段。
func sessionInfo(c echo.Context) error {
	payload := sessionPayload()
	if info, ok := middlewares.AuthTokenInfoFromContext(c); ok {
		expiresIn := int(time.Until(info.ExpiresAt).Seconds())
		if expiresIn < 0 {
			expiresIn = 0
		}
		payload["expiresAt"] = info.ExpiresAt
		payload["expiresIn"] = expiresIn
		payload["renewable"] = info.CanRenew
	}
	return c.JSON(http.StatusOK, payload)
}

// refreshSession exchanges a live renewal window for a fresh access token. The
// refresh middleware has already checked the cookie pair and the CSRF header.
// Fixed-lifetime ticket tiers never get a replacement: while their access
// window is open this is a no-op, and once it is over the session is dead.
func refreshSession(c echo.Context) error {
	info, ok := middlewares.AuthTokenInfoFromContext(c)
	if !ok {
		return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
	}
	now := time.Now()
	if !info.CanRenew {
		if info.AccessValid(now) {
			c.Response().Header().Set("Cache-Control", "no-store")
			return c.NoContent(http.StatusNoContent)
		}
		middlewares.ClearAuthCookies(c)
		return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
	}
	if !info.Renewable(now) {
		middlewares.ClearAuthCookies(c)
		return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
	}
	token, err := config.RenewAuthToken(info)
	if err != nil {
		return apierr.Write(c, apierr.Internal(apierr.CodeInternal, "Failed"))
	}
	middlewares.RenewAuthCookie(c, token, info.Remember)
	c.Response().Header().Set("Cache-Control", "no-store")
	return c.NoContent(http.StatusNoContent)
}

// sessionPayload 是登录后前端一次性需要的东西：能力开关 + 访问范围。
//
// 挂在会话上而不是单独开一个 /capabilities：前端启动时本来就要探测登录态，
// 合成一次往返能让「还没登录」和「不支持视频封面」在同一帧里都确定下来。
func sessionPayload() map[string]any {
	return map[string]any{
		"capabilities": map[string]any{
			"videoThumbnail": thumbnails.Default.VideoAvailable(),
			// config 里没开 allowSelfUpdate 时，/api/server/* 根本没注册；
			// 前端据此决定要不要显示那几个菜单项。
			"selfUpdate": config.Config().AllowSelfUpdate,
			// archive is false until 7-Zip is found. The extension list is what
			// Extract Here may offer; compress is always zip when archive is true.
			"archive":                  sevenzip.Available(),
			"archiveExtractExtensions": nonNilStrings(sevenzip.ExtractExtensions()),
			"archiveCompressFormats":   nonNilFormats(sevenzip.CompressFormats()),
		},
		// allowedRoots 生效时的允许范围，空表示不限制。
		// 前端用它把「为什么这里点不进去」讲清楚：一个没有说明的 403 只会让人以为坏了。
		"allowedRoots": fileops.AllowedRoots(),
	}
}

// createLoginTicket mints a short-lived ticket bound to the requested tier and
// returns one login URL per local address, so the frontend can render a QR code
// that signs another device in without a password. Minting a credential is a
// write, hence POST; the ticket lives for two minutes and the frontend refreshes
// it on demand. Fixed-tier sessions cannot mint new tickets: a temporary share
// must not be able to extend or re-share itself.
func createLoginTicket(c echo.Context) error {
	var body struct {
		Tier string `json:"tier"`
	}
	if c.Request().Body != nil {
		if err := json.NewDecoder(c.Request().Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			return apierr.Write(c, apierr.BadRequest(apierr.CodeBadRequest, "Bad Request"))
		}
	}
	tier, ok := config.ParseTicketTier(body.Tier)
	if !ok {
		return apierr.Write(c, apierr.BadRequest(apierr.CodeBadRequest, "Bad Request"))
	}
	info, ok := middlewares.AuthTokenInfoFromContext(c)
	if !ok || !info.CanRenew {
		return apierr.Write(c, apierr.Forbidden(apierr.CodeForbidden, "Forbidden"))
	}

	ticket, err := config.NewAuthTicket(tier)
	if err != nil {
		return err
	}
	protocol := "http:"
	if config.IsHTTPS() {
		protocol = "https:"
	}
	return c.JSON(http.StatusCreated, map[string]any{
		"value":     ticket.Value,
		"urls":      utils.BuildConnectionURLs(protocol, config.Host(), config.FrontendPort(), ticket.Value),
		"expiresAt": ticket.ExpiresAt,
		"tier":      ticket.Tier,
	})
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func nonNilFormats(in []sevenzip.CompressFormat) []sevenzip.CompressFormat {
	if in == nil {
		return []sevenzip.CompressFormat{}
	}
	return in
}
