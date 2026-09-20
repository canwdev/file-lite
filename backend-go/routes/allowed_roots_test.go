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

// withBases 设定允许的允许根并在结束后清空。给测试用，省掉每处的样板。
func withBases(t *testing.T, dirs ...string) {
	t.Helper()
	if err := fileops.SetAllowedRoots(dirs); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearAllowedRoots)
}

// onlyBase 返回配置里唯一的那个允许根（canonical 形态）。
func onlyBase(t *testing.T) string {
	t.Helper()
	bases := fileops.AllowedRoots()
	if len(bases) != 1 {
		t.Fatalf("期望恰好一条允许根，得到 %v", bases)
	}
	return bases[0]
}

// 范围外的路径必须是 403，而不是 400 或 404。
//
// 三者混起来用户就没法处置：400 会让他以为路径写错了，404 会让他以为文件没了，
// 只有 403 才指向「这里有个你没配到的边界」。
func TestResolvePathOutsideBaseIsForbidden(t *testing.T) {
	withBases(t, t.TempDir())

	baseCanonical := onlyBase(t)
	sub := filepath.ToSlash(filepath.Join(baseCanonical, "sub", "a.txt"))

	// 允许根之内：正常解析。
	if _, httpErr := resolvePath(baseCanonical); httpErr != nil {
		t.Fatalf("允许根自身不该报错：%v", httpErr)
	}
	if _, httpErr := resolvePath(sub); httpErr != nil {
		t.Fatalf("允许根之内不该报错：%v", httpErr)
	}

	// 允许根之外：403。
	outside := filepath.ToSlash(filepath.Dir(baseCanonical))
	if _, httpErr := resolvePath(outside); httpErr == nil {
		t.Fatal("允许根之外应当报错")
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

// 403 的消息里要带允许的范围（用户自己的配置），但**不能回显请求的那条路径**：
// 这个响应本身就是在拒绝他，把服务端目录结构写进去是白送信息。
func TestForbiddenMessageShowsBaseButNotRequestPath(t *testing.T) {
	withBases(t, t.TempDir())

	secret := filepath.ToSlash(filepath.Join(filepath.Dir(onlyBase(t)), "secret-folder", "passwords.txt"))
	_, httpErr := resolvePath(secret)
	if httpErr == nil {
		t.Fatal("范围外路径应当报错")
	}
	msg, _ := httpErr.Message.(string)
	if !contains(msg, onlyBase(t)) {
		t.Errorf("消息里应当写明允许根，得到 %q", msg)
	}
	if contains(msg, "secret-folder") || contains(msg, "passwords.txt") {
		t.Errorf("消息不该回显请求的路径，得到 %q", msg)
	}
}

// 消息里要列出**所有**允许的范围：只写第一条会让用户以为第二条没生效。
func TestForbiddenMessageListsAllBases(t *testing.T) {
	dirA, dirB := t.TempDir(), t.TempDir()
	withBases(t, dirA, dirB)

	_, httpErr := resolvePath(filepath.ToSlash(os.TempDir()) + "/definitely-outside.txt")
	if httpErr == nil {
		t.Fatal("范围外路径应当报错")
	}
	msg, _ := httpErr.Message.(string)
	for _, base := range fileops.AllowedRoots() {
		if !contains(msg, base) {
			t.Errorf("消息里少了 %q，得到 %q", base, msg)
		}
	}
}

func contains(haystack, needle string) bool {
	return needle != "" && strings.Contains(haystack, needle)
}

func withDrives(t *testing.T, drives []types.Drive) {
	t.Helper()
	origEnumerate := enumerateDrivesFn
	enumerateDrivesFn = func() []types.Drive { return drives }
	fileops.SetMounts(drives)
	t.Cleanup(func() {
		// 先还原枚举函数，再重建挂载表——顺序反过来会把测试用的假位置留在表里。
		enumerateDrivesFn = origEnumerate
		fileops.SetMounts(enumerateDrives())
		fileops.ClearAllowedRoots()
	})
}

// 配了 allowedRoots 之后，盘列表必须收窄到配置的范围。
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
	fileops.ClearAllowedRoots()
	all := visibleDrives()
	if len(all) == 0 {
		t.Fatal("未限制时不该返回空列表")
	}

	withBases(t, home)

	base := onlyBase(t)
	narrowed := visibleDrives()
	if len(narrowed) == 0 {
		t.Fatal("收窄后至少要留下覆盖允许根的位置，否则用户无处可去")
	}
	for _, d := range narrowed {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			t.Errorf("返回了无法解析的路径 %q", d.Path)
			continue
		}
		// 留下的必须在某条允许根之内（或就是它）。
		if !fileops.IsWithinRoots(root, []string{base}) {
			t.Errorf("位置 %q 在范围之外，不该出现", d.Path)
		}
	}
}

// 允许根是某个卷**内部**的目录时，那个卷的根必须从列表里消失。
//
// 这是实际反馈的问题：`D:` 包含 `D:/Projects/app/bin`，按「包含允许根就算在范围内」
// 的判据会把它留下，于是侧边栏仍然显示 D: 根，点进去就是 403。挂载点同时是
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
	// 用一个只含这个卷的枚举结果，模拟「允许根落在某个卷内部」。
	withDrives(t, []types.Drive{{Label: "VOL", Path: volumeCanonical, Kind: types.DriveKindVolume}})
	if err := fileops.SetAllowedRoots([]string{base}); err != nil {
		t.Fatal(err)
	}

	got := visibleDrives()

	for _, d := range got {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			t.Fatalf("返回了无法解析的路径 %q", d.Path)
		}
		if root == volumeCanonical {
			t.Errorf("包含允许根的卷根 %q 不该出现在列表里（点进去会 403）", d.Path)
		}
	}
	// 允许根本身必须在，而且要是可用的那一项。
	found := false
	for _, d := range got {
		if d.Path == onlyBase(t) {
			found = true
		}
	}
	if !found {
		t.Errorf("列表里应当有允许根 %q，得到 %+v", onlyBase(t), got)
	}
}

// 允许根**正好**是枚举结果里的某个根时，它就是根：不补、也不动它下面的其他位置。
//
// 判据必须是「正好是某一项」而不是「落在某个根之下」——后者会让这个分支永远走不到，
// 因为任何绝对路径都落在某个根之下（Windows 上至少落在盘符根之下）。
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
	if err := fileops.SetAllowedRoots([]string{base}); err != nil {
		t.Fatal(err)
	}

	got := visibleDrives()
	labels := make([]string, 0, len(got))
	for _, d := range got {
		labels = append(labels, d.Label)
	}

	// 允许根自己保留，它之下更深的挂载点也是范围内的位置，同样保留。
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
		t.Errorf("允许根已经是列表里的一项时不该补充合成项，得到 %v", labels)
	}
}

// visibleDrives 必须**幂等**：挂载表由它的结果建立，而它又被 /drives 反复调用。
//
// 这是实际反馈的那个 bug：判据去问了挂载表「允许根是不是已经有自己的根」。第一次
// 调用把合成的允许根项写进表里（registerFiles 就是这么做的），第二次就答「已经有」，
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
	if err := fileops.SetAllowedRoots([]string{base}); err != nil {
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

// 多条允许根时侧边栏列出**每一条**，且顺序与配置一致。
func TestVisibleDrivesListsEveryBase(t *testing.T) {
	dirA, dirB := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(dirA, "x"), 0o755); err != nil {
		t.Fatal(err)
	}

	withDrives(t, nil) // 空枚举：所有位置都靠允许根自己补出来
	if err := fileops.SetAllowedRoots([]string{dirA, dirB}); err != nil {
		t.Fatal(err)
	}

	got := visibleDrives()
	if len(got) != 2 {
		t.Fatalf("两条允许根应当列出两项，得到 %+v", got)
	}
	for i, want := range fileops.AllowedRoots() {
		if got[i].Path != want {
			t.Errorf("第 %d 项 = %q，期望 %q", i, got[i].Path, want)
		}
		if got[i].Kind == "" {
			t.Errorf("第 %d 项缺少 kind，前端据此选图标", i)
		}
	}
}

// 允许根不在任何挂载点之下时（Linux 上常见：只枚举了 /），要补一个合成挂载点。
//
// 没有它，「上一级」会停在允许根之外，用户按一下就拿到 403。
func TestVisibleDrivesSynthesizesBaseMount(t *testing.T) {
	// 构造一个空挂载表：任何路径都匹配不到挂载点。
	fileops.SetMounts(nil)
	t.Cleanup(func() { fileops.SetMounts(enumerateDrives()) })

	base := t.TempDir()
	if err := fileops.SetAllowedRoots([]string{base}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fileops.ClearAllowedRoots)

	baseCanonical := onlyBase(t)

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
		t.Errorf("应当为允许根 %q 合成一个挂载点", baseCanonical)
	}
}

// allowedRoots 要出现在 /auth 的响应里：前端需要一个途径把「为什么点不进去」讲清楚，
// 否则一个没有说明的 403 只会让人以为坏了。
func TestAuthInfoReportsAllowedRoots(t *testing.T) {
	e := echo.New()
	call := func() map[string]any {
		rec := httptest.NewRecorder()
		c := e.NewContext(httptest.NewRequest(http.MethodGet, "/api/files/auth", nil), rec)
		if err := getAuthInfo(c); err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}

	dirA, dirB := t.TempDir(), t.TempDir()
	withBases(t, dirA, dirB)

	raw, ok := call()["allowedRoots"].([]any)
	if !ok {
		t.Fatal("allowedRoots 应当是一个数组（允许多条）")
	}
	want := fileops.AllowedRoots()
	if len(raw) != len(want) {
		t.Fatalf("allowedRoots = %v，期望 %v", raw, want)
	}
	for i := range want {
		if raw[i] != want[i] {
			t.Errorf("allowedRoots[%d] = %v，期望 %q", i, raw[i], want[i])
		}
	}

	// 未限制时是空数组，前端据此不显示任何提示。
	fileops.ClearAllowedRoots()
	raw2, ok := call()["allowedRoots"].([]any)
	if !ok {
		t.Fatal("未限制时 allowedRoots 仍应当是数组")
	}
	if len(raw2) != 0 {
		t.Errorf("未限制时 allowedRoots = %v，期望空数组", raw2)
	}
}

// 收窄结果里的每一项都必须是合法的 types.Drive。
func TestVisibleDrivesReturnsUsableEntries(t *testing.T) {
	withBases(t, t.TempDir())

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
