package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	// 侧边栏每一项都必须能在挂载表里找到。用 canonical 形式比较：挂载表里的 Root 是
	// 归一化过的（Windows 盘符的 "C:\" 会变成 "C:"），而端点回显的是枚举结果原样。
	// 只比非 Home 的位置：Home 也会进挂载表，但它的存在与否取决于 os.UserHomeDir()。
	gotRoots := map[string]bool{}
	for _, m := range mounts {
		gotRoots[m.Root] = true
	}
	for _, d := range drives {
		if d.Kind == types.DriveKindHome {
			continue
		}
		canonical, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			t.Errorf("侧边栏位置 %q 不是合法路径: %v", d.Path, err)
			continue
		}
		want := strings.TrimSuffix(canonical, "/")
		if want == "" {
			want = "/"
		}
		if !gotRoots[want] {
			t.Errorf("侧边栏有 %q（canonical %q），挂载表里却没有", d.Path, want)
		}
	}

	// 每个盘符/共享根都必须是可解析的挂载点：用挂载表里最长的一个来验，
	// 不写死 "/"——Windows 上根本没有 "/" 这个位置。
	longest := mounts[0]
	for _, m := range mounts {
		if len(m.Root) > len(longest.Root) {
			longest = m
		}
	}
	if res, err := fileops.Resolve(longest.Root); err != nil || !res.ViaMount() {
		t.Errorf("解析挂载点根 %q 应匹配到挂载点，得到 %+v err=%v", longest.Root, res.Mount, err)
	}
}
