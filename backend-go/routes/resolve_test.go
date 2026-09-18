package routes

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
	"file-lite-go/types"
)

// 阶段 3 的 HTTP 契约：非法路径 400、不存在 404、网络位置不可用 503，
// 三者不得互相冒充。设计依据见 docs/design/vfs-abstraction-plan.md §5.1。

// newFilesServer 注册文件路由（会顺带填充挂载表）。
func newFilesServer() *echo.Echo {
	e := echo.New()
	registerFiles(e.Group("/api/files"))
	return e
}

// getJSON 发一个 GET 并返回状态码与响应体。
func getJSON(t *testing.T, e *echo.Echo, target string) (int, []byte) {
	t.Helper()
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec.Code, rec.Body.Bytes()
}

// postJSON 发一个 JSON POST，用于 rename / create-dir 这类带 body 的端点。
func postJSON(t *testing.T, e *echo.Echo, target string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// `..` 逃逸必须 400，且错误信息不得回显用户输入的完整路径。
func TestListRejectsEscapeWith400(t *testing.T) {
	e := newFilesServer()
	code, body := getJSON(t, e, "/api/files/list?path="+url.QueryEscape("/data/../../etc"))
	if code != http.StatusBadRequest {
		t.Fatalf("越根路径应返回 400，得到 %d：%s", code, body)
	}
	if got := string(body); len(got) == 0 {
		t.Fatal("400 必须带错误信息")
	}
	var parsed map[string]string
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("400 响应不是 JSON 对象: %v", err)
	}
	if contains := parsed["message"]; contains == "" {
		t.Fatal("400 响应缺少 message")
	}
	// 错误信息只描述规则，不回显输入：输入里可能带用户目录名，没必要出现在响应里。
	if parsed["message"] != "path escapes its root" {
		t.Fatalf("error message 应为规则描述，得到 %q", parsed["message"])
	}
}

// 回归：删除 IsPathSafe 之后，**没有匹配到挂载点**的绝对路径仍然必须可用。
// 这是「挂载点不是访问控制」的执行点——写死了就会把整个文件系统挡在门外。
func TestListAllowsPathOutsideAnyMount(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	e := newFilesServer()
	// 注册路由时会把真实枚举结果填进挂载表；这里换成一份「什么都匹配不到」的表，
	// 验证解析器不会因为「没有归属的挂载点」而拒绝一条合法绝对路径。
	fileops.SetMounts(nil)
	t.Cleanup(func() { fileops.SetMounts(nil) })

	code, body := getJSON(t, e, "/api/files/list?path="+url.QueryEscape(filepath.ToSlash(dir)))
	if code != http.StatusOK {
		t.Fatalf("未匹配挂载点的绝对路径必须仍可列目录，得到 %d：%s", code, body)
	}
	var entries []types.Entry
	if err := json.Unmarshal(body, &entries); err != nil {
		t.Fatalf("响应不是条目数组: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "a.txt" {
		t.Fatalf("期望列出 a.txt，得到 %+v", entries)
	}
}

// 不存在的路径是 404，不是 500、也不是 503。
func TestListMissingPathIs404(t *testing.T) {
	e := newFilesServer()
	missing := filepath.ToSlash(filepath.Join(t.TempDir(), "nope"))
	code, body := getJSON(t, e, "/api/files/list?path="+url.QueryEscape(missing))
	if code != http.StatusNotFound {
		t.Fatalf("不存在的路径应返回 404，得到 %d：%s", code, body)
	}
}

// 「服务器不可达」不能报成 404——那会让用户以为文件被删了。
//
// 在挂载表里放一个**网络**位置的挂载点，然后访问它下面一个不存在的路径：
// 网络不可达 ⇒ 503 + Retry-After；如果内核明确说 ENOENT，仍然是 404。
// 两种结果都算通过——测试要钉的是「503 不能被误报成 404」，不是逼着内核报错。
func TestNetworkFailureIs503Not404(t *testing.T) {
	e := newFilesServer()
	fileops.SetMounts([]types.Drive{
		{Label: "net", Path: "//127.0.0.1/nonexistent-share", Kind: types.DriveKindNetwork},
	})
	t.Cleanup(fileops.ClearMounts)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/files/list?path="+url.QueryEscape("//127.0.0.1/nonexistent-share/dir"), nil)
	e.ServeHTTP(rec, req)

	switch rec.Code {
	case http.StatusServiceUnavailable:
		if got := rec.Header().Get("Retry-After"); got == "" {
			t.Fatal("503 必须带 Retry-After，前端据此决定可重试")
		}
	case http.StatusNotFound:
		// 有些平台/配置会立刻报 ENOENT（共享名不存在），这也是正确答案。
	default:
		t.Fatalf("网络位置访问失败应映射为 503（或内核明确的不存在 404），得到 %d：%s",
			rec.Code, rec.Body.String())
	}
}

// resolvePath 的单元契约：非法路径一律 400，合法路径不带错误。
func TestResolvePathContract(t *testing.T) {
	bad := []string{
		"",             // 空路径
		"relative/dir", // 相对路径
		"/a/../../b",   // 越过根
		"C:relative",   // 驱动器相对路径（依赖进程当前目录，不可解释）
		"//onlyhost",   // UNC 缺共享名
		`\\onlyhost\`,  // 同上（反斜杠写法）
	}
	for _, p := range bad {
		if _, httpErr := resolvePath(p); httpErr == nil {
			t.Errorf("resolvePath(%q) 应当报错", p)
		} else if httpErr.Code != http.StatusBadRequest {
			t.Errorf("resolvePath(%q) 的状态码 = %d，期望 400", p, httpErr.Code)
		}
	}
	good := []string{
		"/", "/data", "C:/Users", "C:/", "//server/share/docs",
		// "\srv\files" 会被规范化成 "/srv/files"（反斜杠只是另一种写法），是合法路径。
		`\srv\files`,
	}
	for _, p := range good {
		if res, httpErr := resolvePath(p); httpErr != nil {
			t.Errorf("resolvePath(%q) 不应报错: %v", p, httpErr)
		} else if res.Path == "" {
			t.Errorf("resolvePath(%q) 返回了空路径", p)
		}
	}
}

// codeIfUnavailable 把「网络位置不可用」映射成 503 并带 Retry-After。
func TestFSErrorStatusMapping(t *testing.T) {
	cases := []struct {
		name    string
		err     error
		network bool
		want    int
	}{
		{"不存在（本机）", os.ErrNotExist, false, http.StatusNotFound},
		{"不存在（网络）", os.ErrNotExist, true, http.StatusNotFound},
		{"权限（本机）", os.ErrPermission, false, http.StatusInternalServerError},
		{"权限（网络）", os.ErrPermission, true, http.StatusServiceUnavailable},
		{"超时（本机）", os.ErrDeadlineExceeded, false, http.StatusInternalServerError},
		{"超时（网络）", os.ErrDeadlineExceeded, true, http.StatusServiceUnavailable},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _ := fsErrorStatus(c.err, c.network)
			if got != c.want {
				t.Fatalf("fsErrorStatus(%v, network=%v) = %d，期望 %d", c.err, c.network, got, c.want)
			}
		})
	}
}

// 目录不能重命名进自己的子树——那会把源搬到一半再删掉。
func TestRenameIntoOwnSubtreeIsRejected(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}

	e := echo.New()
	e.POST("/api/files/rename", renamePath)
	rec := postJSON(t, e, "/api/files/rename", map[string]string{
		"fromPath": filepath.ToSlash(src),
		"toPath":   filepath.ToSlash(filepath.Join(src, "sub", "moved")),
	})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("移进自己的子树应返回 400，得到 %d：%s", rec.Code, rec.Body.String())
	}
	if !fileops.ExistsAt(filepath.Join(src, "sub")) {
		t.Fatal("被拒的请求不应改动磁盘")
	}
}

// 符号链接指向源之外时不得被误判成「源之内」——反过来，父路径里含链接时词法判断
// 与实际指向一致。这里锁定住这条边界：源是 dir/src，链接 link 指向 dir，
// 目标 dir/src/back/target 词法上在 src 之内，必须被拒。
func TestRenameThroughSymlinkStaysLexical(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(src, "back")
	if err := os.Symlink(dir, link); err != nil {
		t.Skipf("无法创建符号链接（%v），跳过", err)
	}

	e := echo.New()
	e.POST("/api/files/rename", renamePath)
	rec := postJSON(t, e, "/api/files/rename", map[string]string{
		"fromPath": filepath.ToSlash(src),
		// 目标不存在，所以这是「移进自己的子树」而不是「目标已存在」。
		"toPath": filepath.ToSlash(filepath.Join(link, "target")),
	})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("经链接移进自己的子树应返回 400，得到 %d：%s", rec.Code, rec.Body.String())
	}
}

// getDrives 的每一项都必须带 kind，且 Home 排第一（前端据此选图标与显示容量）。
func TestDrivesCarryKindAndHomeFirst(t *testing.T) {
	e := newFilesServer()
	code, body := getJSON(t, e, "/api/files/drives")
	if code != http.StatusOK {
		t.Fatalf("drives 返回 %d：%s", code, body)
	}
	var drives []types.Drive
	if err := json.Unmarshal(body, &drives); err != nil {
		t.Fatalf("drives 响应不是 JSON 数组: %v", err)
	}
	if len(drives) == 0 {
		t.Fatal("至少要有一个位置")
	}
	for _, d := range drives {
		if d.Kind == "" {
			t.Errorf("位置 %q 缺少 kind", d.Path)
		}
		if d.Path == "" {
			t.Errorf("位置 %q 的 path 为空", d.Label)
		}
	}
	if drives[0].Kind != types.DriveKindHome {
		t.Fatalf("Home 应是第一项，得到 %q（%s）", drives[0].Kind, drives[0].Label)
	}
	// 本机卷不得被标成网络：并发档位靠它决定。
	if runtime.GOOS == "windows" {
		for _, d := range drives {
			if d.Kind == types.DriveKindVolume && fileops.NetworkPath(d.Path) {
				t.Errorf("本机卷 %q 被判成了网络路径", d.Path)
			}
		}
	}
}
