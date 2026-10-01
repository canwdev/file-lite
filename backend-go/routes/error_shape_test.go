package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"file-lite-go/apierr"
)

// 所有错误响应共用 docs/design/api.md §12 的形状：code 给代码分支，message 给用户看。
// 这条用例把契约钉住：形状一旦变了，前端的报错就会变成空白、错误分支全部失效。
func TestBadPathResponseShape(t *testing.T) {
	e := newRESTTestServer()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, encodedEntryURL("/api/fs/directories", "/a/../../b"), nil)
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
	if parsed["code"] != apierr.CodeInvalidPath {
		t.Fatalf("code = %q，期望 %q：%s", parsed["code"], apierr.CodeInvalidPath, rec.Body.String())
	}
}

// 未匹配到路由时 Echo 自己产生的 404 也必须走同一个形状。
func TestRouteNotFoundShape(t *testing.T) {
	e := newRESTTestServer()

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d，期望 404", rec.Code)
	}
	var parsed apierr.Payload
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应体不是 JSON 对象（%v）：%s", err, rec.Body.String())
	}
	if parsed.Code != apierr.CodeNotFound || parsed.Message == "" {
		t.Fatalf("404 形状不对：%s", rec.Body.String())
	}
}
