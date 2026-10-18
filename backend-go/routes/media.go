package routes

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/fileops"
)

// Public media links are the one way to read a file without the session
// cookies: a player such as PotPlayer runs outside the browser and cannot carry
// them. The URL is therefore the credential itself, which is why it is scoped to
// a single file, read-only, and carries its own deadline.
//
// Links are stateless: nothing is stored server-side, so a restart keeps every
// unexpired link working. What revokes them is a new jwtToken (which also signs
// every session out) or the file moving out of allowedRoots.
const (
	mediaLinkVersion = "v1"
	// mediaLinkMaxPaths caps one mint request. The selection comes from the
	// file list, so a larger batch is a bug in the caller, not a real use.
	mediaLinkMaxPaths = 1000
)

// mediaLinkTTLs 是暴露给前端的档位；键同时是 API 取值（3h/24h/7d/30d）。
// 键只是协议里的简写，菜单上显示的是前端按 ticket_tier_* 文案翻译出的「N hours」。
var mediaLinkTTLs = map[string]time.Duration{
	"3h":  3 * time.Hour,
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
	"30d": 30 * 24 * time.Hour,
}

// mediaLinkDefaultTTL 用于没带 ttl 的请求，和前端默认档保持一致。
const mediaLinkDefaultTTL = 24 * time.Hour

func parseMediaLinkTTL(raw string) (time.Duration, bool) {
	if raw == "" {
		return mediaLinkDefaultTTL, true
	}
	ttl, ok := mediaLinkTTLs[raw]
	return ttl, ok
}

// mediaLinkSignature signs the exact (path, exp) pair the URL carries.
//
// The path is the canonical path the link was minted for, so editing either the
// path or the deadline invalidates the signature. Only the server can produce
// one: the key never leaves the process.
func mediaLinkSignature(path string, expiresAt int64) string {
	mac := hmac.New(sha256.New, config.MediaLinkKey())
	mac.Write([]byte(mediaLinkVersion))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(path))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(strconv.FormatInt(expiresAt, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// mediaLinkPath 返回直链的路径部分（不含 origin）。
//
// 不在这里拼 host：服务端不知道浏览器用的是哪个地址，猜错一次链接就废了。前端用
// location.origin 拼上当前这个内网地址，拿到的就是「用户此刻正在使用的那个源」。
func mediaLinkPath(path string, expiresAt int64) string {
	return "/api/media/" + url.PathEscape(path) +
		"?exp=" + strconv.FormatInt(expiresAt, 10) +
		"&sig=" + url.QueryEscape(mediaLinkSignature(path, expiresAt))
}

type mediaLink struct {
	Path      string    `json:"path"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// createMediaLinks implements POST /api/fs/media-links.
//
// Minting is a write (it creates a credential), so it stays on the
// authenticated side: a session that cannot read the file cannot hand out a link
// to it either. The links it returns need no session from then on.
func createMediaLinks(c echo.Context) error {
	var body struct {
		Paths []string `json:"paths"`
		TTL   string   `json:"ttl"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	if len(body.Paths) == 0 {
		return apierr.BadRequest(apierr.CodeBadRequest, "paths is required")
	}
	if len(body.Paths) > mediaLinkMaxPaths {
		return apierr.BadRequest(apierr.CodeBadRequest, "too many paths")
	}
	ttl, ok := parseMediaLinkTTL(body.TTL)
	if !ok {
		return apierr.BadRequest(apierr.CodeBadRequest, "unknown ttl")
	}

	expiresAt := time.Now().Add(ttl).Unix()
	links := make([]mediaLink, 0, len(body.Paths))
	for _, raw := range body.Paths {
		res, apiErr := resolvePath(raw)
		if apiErr != nil {
			return apiErr
		}
		// Reject a target a player cannot open before the link exists: a
		// directory or a FIFO would only fail later, in the player, with no
		// useful message.
		st, err := os.Stat(res.OSPath())
		if err != nil {
			return fsError(err, res.Network())
		}
		if st.IsDir() {
			return apierr.Conflict(apierr.CodeConflict, "Path is not a file")
		}
		if st.Mode()&os.ModeNamedPipe != 0 {
			return apierr.New(http.StatusUnsupportedMediaType, apierr.CodeUnsupportedMedia, "Path is not a regular file")
		}
		links = append(links, mediaLink{
			Path:      res.Path,
			URL:       mediaLinkPath(res.Path, expiresAt),
			ExpiresAt: time.Unix(expiresAt, 0).UTC(),
		})
	}
	return c.JSON(http.StatusCreated, map[string]any{"links": links})
}

// getMediaLinkContent implements GET / HEAD /api/media/{path}?exp=…&sig=…
//
// It is registered without AuthMiddleware on purpose: the URL is the credential.
// Everything else still applies — the path goes through fileops.Resolve (so
// allowedRoots keeps its say) and the bytes go out through serveFileContent (so
// Range, ETag and conditional requests behave exactly like the normal content
// endpoint).
func getMediaLinkContent(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	expiresAt, err := strconv.ParseInt(c.QueryParam("exp"), 10, 64)
	if err != nil || expiresAt <= 0 || time.Now().Unix() >= expiresAt {
		return invalidMediaLink()
	}
	// Check the signature before touching the file system: an unsigned request
	// should not become a stat oracle for paths outside the caller's reach.
	if !hmac.Equal([]byte(c.QueryParam("sig")), []byte(mediaLinkSignature(raw, expiresAt))) {
		return invalidMediaLink()
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}
	// The signature covers the string that was minted. A path that resolves
	// somewhere else (a different spelling of the same file, or an attempt to
	// walk out of it) was not minted here.
	if !fileops.SamePath(res.Path, raw) {
		return invalidMediaLink()
	}
	// The URL is a capability, so a shared cache must not keep the response for
	// another client that does not hold it.
	c.Response().Header().Set("Referrer-Policy", "no-referrer")
	return serveFileContentWithCache(c, res, false, "private, max-age=0, must-revalidate")
}

// invalidMediaLink 是「链接不对」的唯一回答：过期、签名错、路径被改都回它，
// 避免把「这个路径存在」这类信息泄露给没有凭据的请求。
func invalidMediaLink() *apierr.Error {
	return apierr.UnauthorizedReason("media link is invalid or expired")
}
