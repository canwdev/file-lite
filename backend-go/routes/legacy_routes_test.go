package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

// 旧接口一条都不该留：前后端永远一起发布，留一条兼容路径只会让两边的契约漂移。
// 这条用例就是「不做旧版兼容」的守门员——现行契约见 docs/design/api.md。
func TestLegacyRoutesAreGone(t *testing.T) {
	e := withAPIErrorHandler(echo.New())
	Register(e.Group("/api"))
	defer StopSharedWSServices()

	cases := []struct {
		method string
		target string
	}{
		{http.MethodGet, "/api/"},
		{http.MethodGet, "/api/files/list"},
		{http.MethodGet, "/api/files/drives"},
		{http.MethodPost, "/api/files/auth"},
		{http.MethodPost, "/api/files/auth/logout"},
		{http.MethodPost, "/api/files/ip-chooser"},
		{http.MethodPost, "/api/files/create-dir"},
		{http.MethodPost, "/api/files/rename"},
		{http.MethodPost, "/api/files/open-in-host-explorer"},
		{http.MethodPost, "/api/files/upload-file"},
		{http.MethodPost, "/api/files/exists"},
		{http.MethodGet, "/api/files/stream"},
		{http.MethodGet, "/api/files/thumbnail"},
		{http.MethodGet, "/api/files/download"},
		{http.MethodPost, "/api/update"},
		{http.MethodPost, "/api/update/restart"},
		{http.MethodPost, "/api/update/exit"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(c.method, c.target, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s = %d，旧接口应当已经不存在（期望 404）", c.method, c.target, rec.Code)
		}
	}
}
