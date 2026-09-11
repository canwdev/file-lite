package routes

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strconv"

	"github.com/labstack/echo/v4"

	"file-lite-go/thumbnails"
)

// getThumbnail 返回服务端生成的缩略图（二进制，直接可作 <img src>）。
//
// kind=image（默认）走 imaging 解码；kind=video 走 ffmpeg 抽帧（需要 ffmpeg）。
// 后端不持久化：结果只进 thumbnails 包的进程内 LRU。
//
// 错误码是前端回退策略的契约：
//   - 415 格式不支持/解码失败 → 前端回退原图直连（图片），视频则显示类型图标
//   - 422 源图超过上限         → 前端显示类型图标，不把超大文件推给浏览器
//   - 501 能力未启用（无 ffmpeg）→ 前端按「能力关闭」处理，不算这个文件出错
//   - 503 解码槽位排队超时     → 前端显示类型图标，但可重试
func getThumbnail(c echo.Context) error {
	path := c.QueryParam("path")
	if !isPathSafe(path) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe"})
	}

	fi, err := os.Stat(path)
	if err != nil || fi.IsDir() {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "File not found"})
	}

	kind := thumbnails.ParseKind(c.QueryParam("kind"))
	edge := thumbnails.NormalizeEdge(queryInt(c.QueryParam("size")))
	// ETag 与 getFileStream 同理：文件未变时让客户端复用已缓存的缩略图。
	// 这里必须由服务端自己 stat 得出，绝不信任调用方传来的 mtime/size。
	etag := thumbnails.ETag(kind, fi, edge)
	if inm := c.Request().Header.Get("If-None-Match"); inm != "" && inm == etag {
		c.Response().Header().Set("ETag", etag)
		return c.NoContent(http.StatusNotModified)
	}

	data, contentType, err := thumbnails.Default.Get(c.Request().Context(), path, edge, kind)
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			// 客户端已断开（滚动出视野触发了 abort）：没有写响应的意义。
			return c.NoContent(http.StatusRequestTimeout)
		case errors.Is(err, thumbnails.ErrNotFound):
			return c.JSON(http.StatusNotFound, map[string]string{"message": "File not found"})
		case errors.Is(err, thumbnails.ErrUnavailable):
			return c.JSON(http.StatusNotImplemented, map[string]string{"message": "Feature unavailable"})
		case errors.Is(err, thumbnails.ErrUnsupported):
			return c.JSON(http.StatusUnsupportedMediaType, map[string]string{"message": "Unsupported media format"})
		case errors.Is(err, thumbnails.ErrTooLarge):
			return c.JSON(http.StatusUnprocessableEntity, map[string]string{"message": "Media is too large"})
		case errors.Is(err, thumbnails.ErrBusy):
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": "Server is busy"})
		default:
			return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
		}
	}

	h := c.Response().Header()
	h.Set("ETag", etag)
	// 真正的缓存是前端 IndexedDB；这里只是让浏览器别把缩略图当成长缓存复用。
	h.Set(echo.HeaderCacheControl, "private, max-age=0, must-revalidate")
	return c.Blob(http.StatusOK, contentType, data)
}

func queryInt(s string) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return v
}
