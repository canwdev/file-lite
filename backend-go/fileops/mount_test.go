package fileops

import (
	"os"
	"path/filepath"
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
		})
	}
}

func TestResolveWithEmptyMountTable(t *testing.T) {
	SetMounts(nil)
	res, err := Resolve("/srv/data")
	if err != nil {
		t.Fatalf("挂载表为空时也应当能解析本地路径，得到错误: %v", err)
	}
	if res.Mount != nil {
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
	if res.Mount != nil {
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

// OSPath 是 canonical 形态与本机 os.* 调用之间唯一的一次转换。
func TestResolvedOSPath(t *testing.T) {
	res, err := Resolve("/data/x")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := res.OSPath(), filepath.FromSlash("/data/x"); got != want {
		t.Errorf("OSPath() = %q，期望 %q", got, want)
	}
}

// Network() 必须同时看形态与挂载点 Kind：/mnt/c 形态上像本机路径，只有挂载表知道
// 它其实是 WSL 的 9p 共享；反过来 UNC 路径在挂载表为空时也得按网络处理。
func TestResolvedNetwork(t *testing.T) {
	defer SetMounts(nil)
	setMountsFrom(mountsFromDrives([]types.Drive{
		{Label: "mnt", Path: "/mnt/c", Kind: types.DriveKindNetwork},
		{Label: "root", Path: "/", Kind: types.DriveKindVolume},
	}))

	cases := map[string]bool{
		"/mnt/c/Users":       true,  // 形态不像网络，靠挂载点 Kind
		"/etc":               false, // 落在 "/" 这个本机卷上
		"//server/share/doc": true,  // 形态是 UNC，且未匹配任何挂载点
	}
	for p, want := range cases {
		res, err := Resolve(p)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", p, err)
		}
		if got := res.Network(); got != want {
			t.Errorf("Resolve(%q).Network() = %v，期望 %v（Mount=%+v）", p, got, want, res.Mount)
		}
	}
}

// 网络档位必须显著低于本机档位：这是「一千个文件的目录在 SMB 上不要打成几千次
// 网络往返」的唯一执行点。
func TestReadDirConcurrencyTiers(t *testing.T) {
	defer SetMounts(nil)
	setMountsFrom(mountsFromDrives([]types.Drive{
		{Label: "z", Path: "Z:", Kind: types.DriveKindNetwork},
		{Label: "c", Path: "C:", Kind: types.DriveKindVolume},
	}))

	netRes, err := Resolve("Z:/photos")
	if err != nil {
		t.Fatal(err)
	}
	localRes, err := Resolve("C:/Users")
	if err != nil {
		t.Fatal(err)
	}
	if netRes.ReadDirConcurrency() >= localRes.ReadDirConcurrency() {
		t.Fatalf("网络档位 %d 不应大于等于本机档位 %d",
			netRes.ReadDirConcurrency(), localRes.ReadDirConcurrency())
	}
	if netRes.ReadDirConcurrency() < 1 {
		t.Fatalf("并发档位必须为正，得到 %d", netRes.ReadDirConcurrency())
	}
}

// canonical 路径在 Windows 上不能交给 filepath.Dir / filepath.Base：
// filepath.Dir("D:/a/b.txt") 返回 "."，于是「另存为副本」会写到进程的工作目录。
// 这里用临时目录（转成 canonical 形态）锁定住，在 Linux 上也会跑。
func TestUniquePathKeepsCanonicalDir(t *testing.T) {
	dir := t.TempDir()
	canonicalDir := filepath.ToSlash(dir)
	existing := canonicalDir + "/a.txt"
	if err := os.WriteFile(filepath.FromSlash(existing), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	got := UniquePath(existing)
	if gotDir := DirName(got); gotDir != canonicalDir {
		t.Fatalf("UniquePath 把目录算错了：%q 的目录是 %q，期望 %q", got, gotDir, canonicalDir)
	}
	if BaseName(got) != "a (1).txt" {
		t.Fatalf("UniquePath(%q) = %q，期望同目录下的 a (1).txt", existing, got)
	}
}

// 盘符根上的 DirName：Git Bash 之类的来源会拼出 "D:/a.txt"，父目录必须是 "D:/"——
// 返回 "D:" 会让调用方（拼子路径、os.Stat）落到进程的当前目录里。
func TestDirNameOnDriveRootForm(t *testing.T) {
	if got := DirName("D:/a.txt"); got != "D:/" {
		t.Fatalf("DirName(%q) = %q，期望 D:/", "D:/a.txt", got)
	}
	if got := DirName("D:/"); got != "D:" {
		t.Fatalf("盘符根（带斜杠写法）应归一化成 D:，得到 %q", got)
	}
	if got := DirName("D:"); got != "D:" {
		t.Fatalf("盘符根本身就是自己的父目录，得到 %q", got)
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
		// 盘符根必须带斜杠："C:" 是驱动器**相对**路径（靠进程当前目录解释），
		// 拿它去 os.Stat / 拼子路径都会指错位置。"C:" 与 "C:/" 都归一化成 "C:"，
		// 因为 canonical 的盘符根写法就是不带尾斜杠的 "C:"。
		"C:/Users":         "C:/",
		"C:":               "C:",
		"C:/":              "C:",
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
