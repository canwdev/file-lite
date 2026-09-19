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

// 基目录是某个卷**内部**的目录时，那个卷的根必须从列表里消失。
//
// 这是实际反馈的问题：`D:` 包含 `D:/Projects/app/bin`，按「包含基目录就算在范围内」
// 的直觉会把它留下，于是侧边栏仍然显示 D: 根，点进去就是 403。挂载点同时是
// 「上一级」的停点，留着它等于把出口留在了范围之外。
func TestVisibleDrivesDropsContainingVolume(t *testing.T) {
	volumeRoot := t.TempDir() // 充当一个卷根
	base := filepath.Join(volumeRoot, "inner", "bin")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}

	volumeCanonical, err := fileops.CanonicalizePath(filepath.ToSlash(volumeRoot))
	if err != nil {
		t.Fatal(err)
	}
	// 用一个只含这个卷的枚举结果，模拟「基目录落在某个卷内部」。
	withDrives(t, []types.Drive{{Label: "VOL", Path: volumeCanonical, Kind: types.DriveKindVolume}})
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}

	baseCanonical := fileops.BaseDir()
	got := visibleDrives()

	for _, d := range got {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			t.Fatalf("返回了无法解析的路径 %q", d.Path)
		}
		if root == volumeCanonical {
			t.Errorf("包含基目录的卷根 %q 不该出现在列表里（点进去会 403）", d.Path)
		}
	}
	// 基目录本身必须在，而且要是可用的那一项。
	found := false
	for _, d := range got {
		if d.Path == baseCanonical {
			found = true
		}
	}
	if !found {
		t.Errorf("列表里应当有基目录 %q，得到 %+v", baseCanonical, got)
	}
}

// 注意恢复顺序：必须在 defer 里把注入还原，**再**让 cleanup 重建挂载表。
// 反过来（cleanup 里先算 `fileops.SetMounts(enumerateDrives())`）会在注入还生效时
// 就把那个函数值算出来，于是挂载表里留下测试用的假位置——实测就是这样多出一项。
func withDrives(t *testing.T, drives []types.Drive) {
	t.Helper()
	origEnumerate := enumerateDrivesFn
	enumerateDrivesFn = func() []types.Drive { return drives }
	fileops.SetMounts(drives)
	t.Cleanup(func() {
		// 先还原枚举函数，再重建挂载表——顺序反过来会把测试用的假位置留在表里。
		enumerateDrivesFn = origEnumerate
		fileops.SetMounts(enumerateDrives())
		fileops.ClearBaseDir()
	})
}

// 基目录**正好**是挂载表的某个根时，它就是根：不补、也不动它下面的其他位置。
//
// 这条与上一条互补。判据必须是「正好是根」而不是「落在某个根之下」——
// 后者会让这个分支永远走不到，因为任何绝对路径都落在某个根之下（Windows 上至少
// 落在盘符根之下），于是合成被跳过、列表变空。
func TestVisibleDrivesKeepsBaseThatIsItselfAMountRoot(t *testing.T) {
	base := t.TempDir()
	baseCanonical, err := fileops.CanonicalizePath(filepath.ToSlash(base))
	if err != nil {
		t.Fatal(err)
	}
	nested := baseCanonical + "/nested"

	withDrives(t, []types.Drive{
		{Label: "BASE", Path: baseCanonical, Kind: types.DriveKindVolume},
		{Label: "NESTED", Path: nested, Kind: types.DriveKindVolume},
	})
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}

	got := visibleDrives()
	labels := make([]string, 0, len(got))
	for _, d := range got {
		labels = append(labels, d.Label)
	}

	// 基目录自己保留，它之下更深的挂载点也是范围内的位置，同样保留。
	for _, want := range []string{"BASE", "NESTED"} {
		found := false
		for _, d := range got {
			if d.Label == want {
				found = true
			}
		}
		if !found {
			t.Errorf("应当保留 %s，得到 %v", want, labels)
		}
	}
	// 不该再多补一个合成项。
	if len(got) != 2 {
		t.Errorf("基目录已经是挂载根时不该补充合成项，得到 %v", labels)
	}
}

// visibleDrives 必须**幂等**：挂载表由它的结果建立，而它又被 /drives 反复调用。
//
// 这是实际反馈的那个 bug：判据去问了挂载表「基目录是不是已经有自己的根」。第一次
// 调用把合成的基目录项写进表里（registerFiles 就是这么做的），第二次就答「已经有」，
// 于是 /drives 原样返回全盘列表——侧边栏又出现 D:，点进去 403。
// 单看一次调用是发现不了的，必须连调两次。
func TestVisibleDrivesIsIdempotent(t *testing.T) {
	volumeRoot := t.TempDir()
	base := filepath.Join(volumeRoot, "app", "bin")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	volumeCanonical, err := fileops.CanonicalizePath(filepath.ToSlash(volumeRoot))
	if err != nil {
		t.Fatal(err)
	}

	withDrives(t, []types.Drive{{Label: "VOL", Path: volumeCanonical, Kind: types.DriveKindVolume}})
	if err := fileops.SetBaseDir(base); err != nil {
		t.Fatal(err)
	}

	first := visibleDrives()
	// 模拟 registerFiles：把第一次的结果装进挂载表，再问第二次。
	fileops.SetMounts(first)
	second := visibleDrives()

	if len(first) != len(second) {
		t.Fatalf("两次调用结果不同：第一次 %+v，第二次 %+v", first, second)
	}
	for i := range first {
		if first[i].Path != second[i].Path {
			t.Fatalf("两次调用结果不同：第一次 %+v，第二次 %+v", first, second)
		}
	}

	// 而且不能包含那个卷根——那正是用户点进去会 403 的入口。
	for _, d := range second {
		if root, err := fileops.CanonicalizePath(d.Path); err == nil && root == volumeCanonical {
			t.Errorf("第二次调用又漏出了卷根 %q", d.Path)
		}
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
	if fileops.HasMountRootFor(baseCanonical) {
		t.Fatal("前置条件不成立：挂载表为空时不应当已有匹配的根")
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
