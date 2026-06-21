package routes

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

const speedTestOneMB int64 = 1024 * 1024
const speedTestDefaultSizeMB = 500
const speedTestMaxSizeMB = 2048

var speedTestChunk = strings.Repeat("a", int(speedTestOneMB))

func registerSpeedTest(g *echo.Group) {
	g.GET("/download", func(c echo.Context) error { return speedTestDownload(c) })
	g.POST("/upload", func(c echo.Context) error { return speedTestUpload(c) })
}

func speedTestDownload(c echo.Context) error {
	sizeMB := getSpeedTestSizeMB(c.QueryParam("sizeMB"))
	contentLength := int64(sizeMB) * speedTestOneMB

	res := c.Response()
	res.Header().Set(echo.HeaderContentType, "application/octet-stream")
	res.Header().Set(echo.HeaderContentLength, strconv.FormatInt(contentLength, 10))
	res.Header().Set(echo.HeaderCacheControl, "no-store")
	res.WriteHeader(http.StatusOK)

	for i := 0; i < sizeMB; i++ {
		if _, err := io.WriteString(res, speedTestChunk); err != nil {
			return nil
		}
		res.Flush()
	}
	return nil
}

func speedTestUpload(c echo.Context) error {
	maxBytes := int64(speedTestMaxSizeMB) * speedTestOneMB
	body := http.MaxBytesReader(c.Response(), c.Request().Body, maxBytes)
	defer body.Close()

	bytes, err := io.Copy(io.Discard, body)
	if err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"message": "Payload Too Large"})
		}
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"ok":    true,
		"bytes": bytes,
	})
}

func getSpeedTestSizeMB(value string) int {
	size, err := strconv.Atoi(value)
	if err != nil || size <= 0 {
		return speedTestDefaultSizeMB
	}
	if size > speedTestMaxSizeMB {
		return speedTestMaxSizeMB
	}
	return size
}
