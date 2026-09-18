package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
	"file-lite-go/types"
)

// 挂载表与侧边栏必须来自同一份枚举结果，否则「界面上的盘」与
// 「解析器认识的挂载点」会悄悄漂移。这里把两者钉在一起。
func TestMountTableMatchesDrivesEndpoint(t *testing.T) {
	// 只注册文件路由，避免把 WebSocket / 任务管理器一起拉起来。
	e := echo.New()
	registerFiles(e.Group("/api/files"))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/drives", nil)
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("drives 端点返回 %d：%s", rec.Code, rec.Body.String())
	}

	var drives []types.Drive
	if err := json.Unmarshal(rec.Body.Bytes(), &drives); err != nil {
		t.Fatalf("drives 响应不是 JSON 数组: %v", err)
	}
	if len(drives) == 0 {
		t.Fatal("至少要有一个位置（Home 或根）")
	}

	mounts := fileops.GetMounts()
	if len(mounts) == 0 {
		t.Fatal("注册路由后挂载表不应为空")
	}
	// 只比较非 Home 的位置：Home 也会进挂载表，但它的存在与否取决于 os.UserHomeDir()。
	wantRoots := map[string]bool{}
	for _, d := range drives {
		if d.Kind == types.DriveKindHome {
			continue
		}
		wantRoots[d.Path] = true
	}
	gotRoots := map[string]bool{}
	for _, m := range mounts {
		gotRoots[m.Root] = true
	}
	for root := range wantRoots {
		if !gotRoots[root] {
			t.Errorf("侧边栏有 %q，挂载表里却没有", root)
		}
	}

	// 根必须是可解析的挂载点：解析 "/" 应当匹配到 "/"。
	if res, err := fileops.Resolve("/"); err != nil || !res.ViaMount() {
		t.Errorf("解析 \"/\" 应匹配到挂载点，得到 %+v err=%v", res.Mount, err)
	}
}
