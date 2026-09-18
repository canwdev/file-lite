package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/labstack/echo/v4"
)

// Echo 的默认错误处理器把 *echo.HTTPError 渲染成 {"message": ...}，
// 与路由自己写的 c.JSON 形态一致——前端统一读 message 字段。
// 这条用例把契约钉住：形状一旦变了，前端的报错就会变成空白。
func TestBadPathResponseShape(t *testing.T) {
	e := echo.New()
	e.GET("/api/files/list", getFiles)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/list?path="+url.QueryEscape("/a/../../b"), nil)
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d，期望 400", rec.Code)
	}
	var parsed map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应体不是 JSON 对象（%v）：%s", err, rec.Body.String())
	}
	if parsed["message"] == "" {
		t.Fatalf("响应体缺少 message 字段：%s", rec.Body.String())
	}
}
