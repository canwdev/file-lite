package fileops

import (
	"testing"

	"file-lite-go/types"
)

// 挂载表与解析器的契约见 docs/design/vfs-abstraction-design.md §3、§5.2。
// 重点有两处：匹配必须按**段边界**，以及解析不到挂载点的路径仍然要通过。

func TestMountFromDrive(t *testing.T) {
	cases := []struct {
		name     string
		drive    types.Drive
		wantRoot string
		wantKind string
		wantOK   bool
	}{
		{"空路径", types.Drive{Path: ""}, "", "", false},
		{"Unix 根", types.Drive{Label: "/", Path: "/", Kind: types.DriveKindVolume}, "/", types.DriveKindVolume, true},
		{"带尾斜杠", types.Drive{Path: "/mnt/dev-drive/"}, "/mnt/dev-drive", types.DriveKindVolume, true},
		{"盘符", types.Drive{Path: "D:/"}, "D:", types.DriveKindVolume, true},
		{"UNC", types.Drive{Path: "\\\\server\\share"}, "//server/share", types.DriveKindVolume, true},
		{"网络挂载", types.Drive{Path: "/mnt/c", Kind: types.DriveKindNetwork}, "/mnt/c", types.DriveKindNetwork, true},
		{"kind 缺省按卷处理", types.Drive{Path: "/mnt/x"}, "/mnt/x", types.DriveKindVolume, true},
		{"相对路径拒绝", types.Drive{Path: "relative/dir"}, "", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, ok := mountFromDrive(c.drive)
			if ok != c.wantOK {
				t.Fatalf("ok = %v，期望 %v", ok, c.wantOK)
			}
			if !ok {
				return
			}
			if m.Root != c.wantRoot {
				t.Errorf("Root = %q，期望 %q", m.Root, c.wantRoot)
			}
			if m.Kind != c.wantKind {
				t.Errorf("Kind = %q，期望 %q", m.Kind, c.wantKind)
			}
		})
	}
}

func TestLongestMount(t *testing.T) {
	mounts := []Mount{
		{Root: "/", Kind: types.DriveKindVolume},
		{Root: "/home/me", Kind: types.DriveKindHome},
		{Root: "C:", Kind: types.DriveKindVolume},
		{Root: "//server/share", Kind: types.DriveKindNetwork},
		{Root: "//wsl.localhost/Debian", Kind: types.DriveKindNetwork},
	}

	cases := []struct {
		name     string
		path     string
		wantRoot string
		wantOK   bool
	}{
		{"根", "/", "/", true},
		{"根下的普通路径", "/srv/data/x", "/", true},
		{"最长前缀优先", "/home/me/docs", "/home/me", true},
		{"挂载点自身", "/home/me", "/home/me", true},
		// 段边界：裸 HasPrefix 会把这两个判进挂载点里。
		{"段边界：兄弟目录", "/home/men", "/", true},
		{"盘符", "C:/Users/me", "C:", true},
		{"盘符大小写无关", "c:/Users", "C:", true},
		{"盘符段边界", "C:", "C:", true},
		// 不落进任何挂载点：Windows 上 D: 可能根本没被枚举，而表里没有 "/"。
		{"不同盘符不匹配任何挂载点", "D:/x", "", false},
		{"UNC 子路径", "//server/share/docs", "//server/share", true},
		{"UNC 主机名大小写无关", "//SERVER/share/docs", "//server/share", true},
		{"WSL", "//wsl.localhost/Debian/home/me", "//wsl.localhost/Debian", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, ok := LongestMount(c.path, mounts)
			if ok != c.wantOK {
				t.Fatalf("匹配 = %v，期望 %v（得到 %q）", ok, c.wantOK, m.Root)
			}
			if ok && m.Root != c.wantRoot {
				t.Fatalf("匹配到 %q，期望 %q", m.Root, c.wantRoot)
			}
		})
	}
}

func TestSetMountsAndResolve(t *testing.T) {
	// 全局表在用例之间会被替换，结束前恢复成空表。
	defer SetMounts(nil)

	SetMounts([]types.Drive{
		{Label: "Home", Path: "/home/me", Kind: types.DriveKindHome},
		{Label: "/", Path: "/", Kind: types.DriveKindVolume},
		{Label: "/mnt/c", Path: "/mnt/c/", Kind: types.DriveKindNetwork},
		{Label: "Home", Path: "/home/me", Kind: types.DriveKindHome}, // 重复项应被去重
	})

	got := GetMounts()
	if len(got) != 3 {
		t.Fatalf("挂载表应有 3 项（重复项去掉），得到 %d：%+v", len(got), got)
	}

	cases := []struct {
		name      string
		path      string
		wantPath  string
		wantMount string
		wantErr   bool
	}{
		{"归一化并匹配挂载点", "/mnt/c/Users//me/", "/mnt/c/Users/me", "/mnt/c", false},
		{"最长前缀", "/home/me/docs", "/home/me/docs", "/home/me", false},
		{"折叠点点", "/mnt/c/a/../b", "/mnt/c/b", "/mnt/c", false},
		// 关键：解析不到挂载点也要通过。Linux 上只有 / 被枚举时，任何路径都会落到
		// "/"，所以这里用 Windows 盘符构造一个真正不匹配的路径；
		// 「表里根本没有匹配项」的情况见 TestResolveWithoutMatchingMount。
		{"未匹配挂载点仍然可用", "D:/work", "D:/work", "", false},
		{"相对路径拒绝", "relative", "", "", true},
		{"越根拒绝", "/a/../../b", "", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res, err := Resolve(c.path)
			if c.wantErr {
				if err == nil {
					t.Fatalf("Resolve(%q) 期望报错，得到 %+v", c.path, res)
				}
				return
			}
			if err != nil {
				t.Fatalf("Resolve(%q) 意外报错: %v", c.path, err)
			}
			if res.Path != c.wantPath {
				t.Errorf("Path = %q，期望 %q", res.Path, c.wantPath)
			}
			gotMount := ""
			if res.Mount != nil {
				gotMount = res.Mount.Root
			}
			if gotMount != c.wantMount {
				t.Errorf("Mount = %q，期望 %q", gotMount, c.wantMount)
			}
			if res.ViaMount() != (c.wantMount != "") {
				t.Errorf("ViaMount() = %v，与挂载点 %q 不一致", res.ViaMount(), c.wantMount)
			}
		})
	}
}

func TestResolveWithEmptyMountTable(t *testing.T) {
	SetMounts(nil)
	res, err := Resolve("/srv/data")
	if err != nil {
		t.Fatalf("挂载表为空时也应当能解析本地路径，得到错误: %v", err)
	}
	if res.ViaMount() {
		t.Fatalf("空挂载表下不应匹配到挂载点，得到 %+v", res.Mount)
	}
}

// 「表里有挂载点，但都不是这条路径的前缀」也要通过——Windows 上很容易出现
// 某个盘符没有被枚举出来的情况。
func TestResolveWithoutMatchingMount(t *testing.T) {
	defer SetMounts(nil)
	setMountsFrom(mountsFromDrives([]types.Drive{
		{Label: "C:", Path: "C:", Kind: types.DriveKindVolume},
	}))

	res, err := Resolve("D:/work")
	if err != nil {
		t.Fatalf("未匹配挂载点不应报错: %v", err)
	}
	if res.Path != "D:/work" {
		t.Errorf("Path = %q，期望 D:/work", res.Path)
	}
	if res.ViaMount() {
		t.Fatalf("不应匹配到挂载点，得到 %+v", res.Mount)
	}
}

func TestNetworkPath(t *testing.T) {
	cases := map[string]bool{
		"//server/share":         true,
		"//server/share/docs":    true,
		"//wsl.localhost/Debian": true,
		"/mnt/c":                 false, // 形态是普通绝对路径，靠挂载点 Kind 才知道是网络位置
		"C:/Users":               false,
		"/":                      false,
		"":                       false,
	}
	for p, want := range cases {
		if got := NetworkPath(p); got != want {
			t.Errorf("NetworkPath(%q) = %v，期望 %v", p, got, want)
		}
	}
}

func TestSamePath(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		want bool
	}{
		{"同一个路径", "/data/a.txt", "/data/a.txt", true},
		{"盘符大小写", "C:/Users/me", "c:/Users/me", true},
		{"UNC 主机名大小写", "//SERVER/share/x", "//server/share/x", true},
		{"不同路径", "/data/a.txt", "/data/b.txt", false},
		{"空路径不算同一处", "", "/data/a.txt", false},
		// 有意不解析符号链接：同一个目标的两个不同路径判为不同（见 SamePath 注释）。
		{"不同路径即使指向同一目标", "/data/link", "/data/real", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := SamePath(c.a, c.b); got != c.want {
				t.Fatalf("SamePath(%q, %q) = %v，期望 %v", c.a, c.b, got, c.want)
			}
		})
	}
}

func TestBaseNameAndDirName(t *testing.T) {
	baseCases := map[string]string{
		"/data/a.txt":       "a.txt",
		"/data/sub/":        "sub",
		"/":                 "/",
		"C:/Users/me":       "me",
		"C:":                "C:",
		"//server/share":    "share",
		"//server/share/x/": "x",
	}
	for p, want := range baseCases {
		if got := BaseName(p); got != want {
			t.Errorf("BaseName(%q) = %q，期望 %q", p, got, want)
		}
	}

	dirCases := map[string]string{
		"/data/a.txt":      "/data",
		"/data/sub":        "/data",
		"/data":            "/",
		"/":                "/",
		"C:/Users/me":      "C:/Users",
		"C:/Users":         "C:",
		"C:":               "C:",
		"//server/share/x": "//server/share",
		"//server/share":   "//server/share", // 共享根之上不可导航
		// 词法父目录：挂载边界不在这里判断（见 DirName 注释）。
		"/mnt/dev-drive": "/mnt",
	}
	for p, want := range dirCases {
		if got := DirName(p); got != want {
			t.Errorf("DirName(%q) = %q，期望 %q", p, got, want)
		}
	}
}

func TestMountIsRoot(t *testing.T) {
	m := Mount{Root: "//server/share"}
	if !m.IsRoot("//server/share") {
		t.Error("共享根应被判定为根自身")
	}
	if !m.IsRoot("//SERVER/share/") {
		t.Error("根判定应当大小写与尾斜杠无关")
	}
	if m.IsRoot("//server/share/docs") {
		t.Error("子路径不是根")
	}
}
