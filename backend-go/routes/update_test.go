package routes

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/updater"
)

// newUpdateServer 只注册自更新端点：这里验证的是 handler 的契约，
// 不是真实换文件（那需要本进程替换自己）。
func newUpdateServer() *echo.Echo {
	e := echo.New()
	e.POST("/api/update", applyUpdate)
	return e
}

// 默认（config 里没打开 allowSelfUpdate）时三条高危端点根本不注册。
func TestUpdateRoutesAreOffByDefault(t *testing.T) {
	e := echo.New()
	registerUpdateRoutes(e.Group("/api"), false)

	for _, target := range []string{"/api/update", "/api/update/restart", "/api/update/exit"} {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, target, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("POST %s = %d, want 404", target, rec.Code)
		}
	}
}

// 打开之后三条端点存在：没有 token 时由鉴权中间件挡下，不会是 404。
// 这里也顺带保证它们的 handler 不会被执行 —— 否则测试进程会真的重启或退出。
func TestUpdateRoutesAreRegisteredWhenEnabled(t *testing.T) {
	e := echo.New()
	registerUpdateRoutes(e.Group("/api"), true)

	for _, target := range []string{"/api/update", "/api/update/restart", "/api/update/exit"} {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, target, nil))
		if rec.Code == http.StatusNotFound {
			t.Errorf("POST %s is not registered", target)
		}
	}
}

func updateUploadRequest(t *testing.T, e *echo.Echo, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/update", &buf)
	req.Header.Set(echo.HeaderContentType, writer.FormDataContentType())
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestUpdateWithoutFileIsRejected(t *testing.T) {
	e := newUpdateServer()
	req := httptest.NewRequest(http.MethodPost, "/api/update", bytes.NewReader(nil))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
}

// 上传一个不是本机可执行文件的文件：必须被拒绝。
// 「不留候选文件」由 updater 包自己的测试覆盖。
func TestUpdateRejectsForeignBinary(t *testing.T) {
	if err := updater.Init(); err != nil {
		t.Fatal(err)
	}

	e := newUpdateServer()
	rec := updateUploadRequest(t, e, "fake.bin", []byte("definitely not an executable"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
}
