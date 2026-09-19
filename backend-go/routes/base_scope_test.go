package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
	"file-lite-go/types"
)

// 范围外的路径必须是 403，而不是 400 或 404。
//
// 三者混起来用户就没法处置：400 会让他以为路径写错了，404 会让他以为文件没了，
// 只有 403 才指向「这里有个你没配到的边界」。
func TestResolvePathOutsideBaseIsForbidden(t *testing.T) {
	base := t.TempDir()
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	baseCanonical := fileops.BaseDir()
	sub := filepath.ToSlash(filepath.Join(baseCanonical, "sub", "a.txt"))

	// 基目录之内：正常解析。
	if _, httpErr := resolvePath(baseCanonical); httpErr != nil {
		t.Fatalf("基目录自身不该报错：%v", httpErr)
	}
	if _, httpErr := resolvePath(sub); httpErr != nil {
		t.Fatalf("基目录之内不该报错：%v", httpErr)
	}

	// 基目录之外：403。
	outside := filepath.ToSlash(filepath.Dir(baseCanonical))
	if _, httpErr := resolvePath(outside); httpErr == nil {
		t.Fatal("基目录之外应当报错")
	} else if httpErr.Code != http.StatusForbidden {
		t.Fatalf("状态码 = %d，期望 403", httpErr.Code)
	} else if msg, _ := httpErr.Message.(string); msg == "" {
		t.Fatal("403 消息里应当说明边界在哪")
	}

	// 形态错误仍然是 400，不能被范围检查抢走。
	if _, httpErr := resolvePath("relative/dir"); httpErr == nil {
		t.Fatal("相对路径应当报错")
	} else if httpErr.Code != http.StatusBadRequest {
		t.Fatalf("相对路径的状态码 = %d，期望 400（形态问题优先于范围问题）", httpErr.Code)
	}
}

// 403 的消息里要带基目录（用户自己的配置），但**不能回显请求的那条路径**：
// 这个响应本身就是在拒绝他，把服务端目录结构写进去是白送信息。
func TestForbiddenMessageShowsBaseButNotRequestPath(t *testing.T) {
	base := t.TempDir()
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	secret := filepath.ToSlash(filepath.Join(filepath.Dir(fileops.BaseDir()), "secret-folder", "passwords.txt"))
	_, httpErr := resolvePath(secret)
	if httpErr == nil {
		t.Fatal("范围外路径应当报错")
	}
	msg, _ := httpErr.Message.(string)
	if !contains(msg, fileops.BaseDir()) {
		t.Errorf("消息里应当写明基目录，得到 %q", msg)
	}
	if contains(msg, "secret-folder") || contains(msg, "passwords.txt") {
		t.Errorf("消息不该回显请求的路径，得到 %q", msg)
	}
}

func contains(haystack, needle string) bool {
	return needle != "" && strings.Contains(haystack, needle)
}

// 配了 safeBaseDir 之后，盘列表必须收窄。
//
// 这是一个**枚举面**问题：照报全盘等于继续告诉调用方「这台机器上有什么」，
// 而访问控制刚刚才决定不让他看。同时也是导航边界问题——范围外的挂载点留在列表里，
// 用户会看到点不进去的盘，原因在界面上完全看不出来。
func TestVisibleDrivesNarrowedToBase(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("拿不到用户主目录，跳过")
	}

	// 不限制时：原样返回枚举结果。
	fileops.ClearBaseDir()
	all := visibleDrives()
	if len(all) == 0 {
		t.Fatal("未限制时不该返回空列表")
	}

	// 限制到 Home：范围之外的挂载点（例如别的盘符）必须消失。
	if err := fileops.SetBaseDir(home); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	base := fileops.BaseDir()
	narrowed := visibleDrives()
	if len(narrowed) == 0 {
		t.Fatal("收窄后至少要留下覆盖基目录的位置，否则用户无处可去")
	}
	for _, d := range narrowed {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			t.Errorf("返回了无法解析的路径 %q", d.Path)
			continue
		}
		// 留下的一定是「包含基目录」或「在基目录之内」的。
		if !fileops.IsWithinRoot(base, root) && !fileops.IsWithinRoot(root, base) {
			t.Errorf("位置 %q 既不含基目录也不在基目录内，不该出现", d.Path)
		}
	}
	// 有覆盖基目录的位置，用户才到得了那里。
	covered := false
	for _, d := range narrowed {
		root, err := fileops.CanonicalizePath(d.Path)
		if err == nil && fileops.IsWithinRoot(base, root) {
			covered = true
		}
	}
	if !covered {
		t.Error("收窄后必须保留一个覆盖基目录的位置")
	}
}

// 基目录不在任何挂载点之下时（Linux 上常见：只枚举了 /），要补一个合成挂载点。
//
// 没有它，「上一级」会停在基目录之外，用户按一下就拿到 403。
func TestVisibleDrivesSynthesizesBaseMount(t *testing.T) {
	// 构造一个空挂载表：任何路径都匹配不到挂载点。
	fileops.SetMounts(nil)
	t.Cleanup(func() { fileops.SetMounts(visibleDrives()) })

	base := t.TempDir()
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	baseCanonical := fileops.BaseDir()
	if fileops.HasMountFor(baseCanonical) {
		t.Fatal("前置条件不成立：挂载表为空时不应当已有匹配")
	}

	found := false
	for _, d := range visibleDrives() {
		if d.Path == baseCanonical {
			found = true
			if d.Kind == "" {
				t.Error("合成挂载点必须带 kind，前端据此选图标")
			}
		}
	}
	if !found {
		t.Errorf("应当为基目录 %q 合成一个挂载点", baseCanonical)
	}
}

// baseDir 要出现在 /auth 的响应里：前端需要一个途径把「为什么点不进去」讲清楚，
// 否则一个没有说明的 403 只会让人以为坏了。
func TestAuthInfoReportsBaseDir(t *testing.T) {
	base := t.TempDir()
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	e := echo.New()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/files/auth", nil)
	c := e.NewContext(req, rec)
	if err := getAuthInfo(c); err != nil {
		t.Fatal(err)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got, _ := body["baseDir"].(string); got != fileops.BaseDir() {
		t.Errorf("baseDir = %q，期望 %q", got, fileops.BaseDir())
	}

	// 未限制时是空串，前端据此不显示任何提示。
	fileops.ClearBaseDir()
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(httptest.NewRequest(http.MethodGet, "/api/files/auth", nil), rec2)
	if err := getAuthInfo(c2); err != nil {
		t.Fatal(err)
	}
	var body2 map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &body2); err != nil {
		t.Fatal(err)
	}
	if got := body2["baseDir"]; got != "" {
		t.Errorf("未限制时 baseDir = %v，期望空串", got)
	}
}

// 收窄结果里的每一项都必须是合法的 types.Drive。
func TestVisibleDrivesReturnsUsableEntries(t *testing.T) {
	base := t.TempDir()
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearBaseDir)

	for _, d := range visibleDrives() {
		if d.Label == "" {
			t.Errorf("位置 %q 缺少 label", d.Path)
		}
		if d.Kind != types.DriveKindVolume && d.Kind != types.DriveKindNetwork &&
			d.Kind != types.DriveKindHome && d.Kind != types.DriveKindLocked {
			t.Errorf("位置 %q 的 kind = %q 不是已知取值", d.Path, d.Kind)
		}
	}
}
