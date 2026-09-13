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
