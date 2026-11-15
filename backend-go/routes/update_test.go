package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/updater"
)

// newUpdateServer 只注册自更新端点：这里验证的是 handler 的契约，
// 不是真实换文件（那需要本进程替换自己）。
func newUpdateServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	e.POST("/api/server/updates", applyUpdate)
	return e
}

// allowSelfUpdate 关闭时，GitHub 更新检查/安装仍然存在；上传二进制、重启和退出不注册。
func TestServerRoutesAreOffByDefault(t *testing.T) {
	e := withAPIErrorHandler(echo.New())
	registerServerRoutes(e.Group("/api"), false)

	updateCases := []struct {
		method string
		target string
	}{
		{http.MethodGet, "/api/server/update"},
		{http.MethodGet, "/api/server/update/status"},
		{http.MethodPost, "/api/server/updates/github"},
	}
	for _, c := range updateCases {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(c.method, c.target, nil))
		if rec.Code == http.StatusNotFound {
			t.Errorf("%s %s is not registered", c.method, c.target)
		}
	}

	adminCases := []struct {
		method string
		target string
	}{
		{http.MethodPost, "/api/server/updates"},
		{http.MethodPost, "/api/server/restarts"},
		{http.MethodDelete, "/api/server"},
	}
	for _, c := range adminCases {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(c.method, c.target, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s = %d, want 404", c.method, c.target, rec.Code)
		}
	}
}

// 打开之后三条端点存在：没有 token 时由鉴权中间件挡下，不会是 404。
// 这里也顺带保证它们的 handler 不会被执行 —— 否则测试进程会真的重启或退出。
func TestServerRoutesAreRegisteredWhenEnabled(t *testing.T) {
	e := withAPIErrorHandler(echo.New())
	registerServerRoutes(e.Group("/api"), true)

	cases := []struct {
		method string
		target string
	}{
		{http.MethodPost, "/api/server/updates"},
		{http.MethodPost, "/api/server/restarts"},
		{http.MethodDelete, "/api/server"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(c.method, c.target, nil))
		if rec.Code == http.StatusNotFound {
			t.Errorf("%s %s is not registered", c.method, c.target)
		}
	}
}

// 上传一个不是本机可执行文件的文件：必须被拒绝。
// 「不留候选文件」由 updater 包自己的测试覆盖。
func TestUpdateRejectsForeignBinary(t *testing.T) {
	if err := updater.Init(); err != nil {
		t.Fatal(err)
	}

	e := newUpdateServer()
	// 请求体就是二进制本身，不再是 multipart。
	req := httptest.NewRequest(http.MethodPost, "/api/server/updates",
		strings.NewReader("definitely not an executable"))
	req.Header.Set(echo.HeaderContentType, "application/octet-stream")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
}
