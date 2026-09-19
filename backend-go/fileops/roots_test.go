package fileops

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"file-lite-go/types"
)

// 不限制是默认值，而且必须是**真的**不限制：这条路径上的每一次 Resolve 都会走到它，
// 任何一个「配了允许根才正常」的假设都会让默认部署出问题。
func TestAllowedRootsUnsetAllowsEverything(t *testing.T) {
	ClearAllowedRoots()
	t.Cleanup(ClearAllowedRoots)

	for _, p := range []string{"/", "/srv/files", "C:/Users/me", "//server/share/docs", "/etc/shadow"} {
		if _, err := Resolve(p); err != nil {
			t.Errorf("未配置允许根时 Resolve(%q) 不该报错，得到 %v", p, err)
		}
	}
}

// 段边界：允许根 /srv/files 不得匹配 /srv/files2。
//
// 这是裸 strings.HasPrefix 的经典漏洞，也是这个特性最容易写错的一处：
// 同级目录被放进来，等于「限制」只挡住了拼写完全相同的路径。
func TestAllowedRootsRespectSegmentBoundary(t *testing.T) {
	setAllowedRootsFrom([]string{"/srv/files"})
	t.Cleanup(ClearAllowedRoots)

	inside := []string{
		"/srv/files",
		"/srv/files/",
		"/srv/files/a.txt",
		"/srv/files/deep/nested/b.txt",
	}
	for _, p := range inside {
		if _, err := Resolve(p); err != nil {
			t.Errorf("Resolve(%q) 应当在范围内，得到 %v", p, err)
		}
	}

	outside := []string{
		"/srv/files2",       // 前缀相同但不同目录——段边界
		"/srv/files2/a.txt", // 同上，更深一层
		"/srv",              // 允许根的父目录
		"/srv/other",        // 允许根的同级
		"/",                 // 根在允许根之外
		"/srv/filesX",       // 又一个同级
		"/srv/files-backup", // 同级，带后缀
	}
	for _, p := range outside {
		if _, err := Resolve(p); err != ErrPathOutsideRoots {
			t.Errorf("Resolve(%q) 应当报 ErrPathOutsideRoots，得到 %v", p, err)
		}
	}
}

// 盘符与 UNC 主机名用比较键判断：C: 与 c: 是同一个卷，不该因为大小写被拒。
//
// 而路径**部分**的大小写按平台处理，见 TestAllowedRootsFolderCaseByPlatform。
func TestAllowedRootsComparisonKeySemantics(t *testing.T) {
	t.Run("盘符大小写不敏感", func(t *testing.T) {
		setAllowedRootsFrom([]string{"C:/Users/me"})
		t.Cleanup(ClearAllowedRoots)

		if _, err := Resolve("c:/Users/me/a.txt"); err != nil {
			t.Errorf("盘符大小写不该影响判定，得到 %v", err)
		}
		if _, err := Resolve("D:/Users/me/a.txt"); err != ErrPathOutsideRoots {
			t.Errorf("另一个盘符应当在范围外，得到 %v", err)
		}
	})

	t.Run("UNC 主机名大小写不敏感", func(t *testing.T) {
		setAllowedRootsFrom([]string{"//Server/Share"})
		t.Cleanup(ClearAllowedRoots)

		if _, err := Resolve("//server/Share/docs/a.txt"); err != nil {
			t.Errorf("主机名大小写不该影响判定，得到 %v", err)
		}
		// 共享名保持大小写敏感：不同 SMB 服务器对共享名大小写的行为不一致，
		// 误判为「同一个」会操作错位置（见 ComparisonKey）。
		if _, err := Resolve("//server/share/docs/a.txt"); err != ErrPathOutsideRoots {
			t.Errorf("共享名大小写不同应当判为范围外，得到 %v", err)
		}
	})
}

// 路径**部分**的大小写：按平台折叠。
//
// 这一条与挂载点匹配（LongestMount）刻意不同。挂载点匹配错一次只是「属于哪个卷」
// 判断错（并发档位、错误映射），而访问控制判错的后果是**把一个合法路径挡在门外**：
// Windows 上 `C:/Users/Me` 与允许根 `C:/Users/me` 是同一个目录，不是越权。
func TestAllowedRootsFolderCaseByPlatform(t *testing.T) {
	setAllowedRootsFrom([]string{"C:/Users/me"})
	t.Cleanup(ClearAllowedRoots)

	_, err := Resolve("C:/Users/ME/nested/a.txt")
	if caseInsensitivePaths {
		if err != nil {
			t.Errorf("Windows / macOS 上大小写不同的同一路径应当被接受，得到 %v", err)
		}
	} else if err != ErrPathOutsideRoots {
		t.Errorf("大小写敏感的平台上应当判为范围外，得到 %v", err)
	}

	// 无论哪个平台，「大小写折叠后仍不在允许根之下」都必须被拒——
	// 折叠不能把边界放宽成「同一个前缀就行」。
	if _, err := Resolve("C:/Users/me2/a.txt"); err != ErrPathOutsideRoots {
		t.Errorf("折叠大小写之后，段边界仍必须成立，得到 %v", err)
	}
}

// UNC 是独立命名空间：允许根是 Unix 根下的目录时，UNC 路径不该被判成「在范围之内」。
func TestAllowedRootsDoNotLeakAcrossNamespaces(t *testing.T) {
	setAllowedRootsFrom([]string{"/srv/files"})
	t.Cleanup(ClearAllowedRoots)

	if _, err := Resolve("//server/share/docs"); err != ErrPathOutsideRoots {
		t.Errorf("UNC 路径不应被判成落在 Unix 允许根之内，得到 %v", err)
	}

	// 反向：允许根是 UNC 时，本机路径也不能被放进来。
	setAllowedRootsFrom([]string{"//server/share"})
	if _, err := Resolve("/srv/files"); err != ErrPathOutsideRoots {
		t.Errorf("本机路径不应被判成落在 UNC 允许根之内，得到 %v", err)
	}
}

// 形态错误优先于范围错误：一条相对路径应当报「不合法」（400），而不是「超出范围」（403）。
// 后者会让用户去翻配置，而真正的问题是他少写了一个斜杠。
func TestAllowedRootsShapeErrorsTakePrecedence(t *testing.T) {
	setAllowedRootsFrom([]string{"/srv/files"})
	t.Cleanup(ClearAllowedRoots)

	for _, p := range []string{"relative/dir", "/a/../../b", "C:relative", "//onlyhost", ""} {
		_, err := Resolve(p)
		if err == nil {
			t.Errorf("Resolve(%q) 应当报错", p)
			continue
		}
		if errors.Is(err, ErrPathOutsideRoots) {
			t.Errorf("Resolve(%q) 应当报形态错误而不是范围错误", p)
		}
	}
}

// `..` 穿越由 canonical 化负责，与允许根无关：越出根就已经是形态错误。
// 在允许根之内用 `..` 回到允许根本身是合法的（那是同一个位置）。
func TestAllowedRootsTraversalHandling(t *testing.T) {
	setAllowedRootsFrom([]string{"/srv/files"})
	t.Cleanup(ClearAllowedRoots)

	// 用 .. 从子目录回到允许根：结果是允许根本身，在范围内。
	if _, err := Resolve("/srv/files/a/../b.txt"); err != nil {
		t.Errorf("在允许根内用 .. 归位应当被接受，得到 %v", err)
	}
	// 用 .. 从允许根越出去：canonical 化后就落到 /srv，属于范围外。
	if _, err := Resolve("/srv/files/../other"); err != ErrPathOutsideRoots {
		t.Errorf("用 .. 越出允许根应当被拒绝，得到 %v", err)
	}
}

// 允许根本身的所有写法都应当被接受（尾斜杠、反斜杠、"." 段）。
func TestAllowedRootsAcceptEquivalentSpellings(t *testing.T) {
	setAllowedRootsFrom([]string{"/srv/files"})
	t.Cleanup(ClearAllowedRoots)

	for _, p := range []string{"/srv/files", "/srv/files/", "/srv/./files", `/srv\files`, "/srv//files"} {
		if _, err := Resolve(p); err != nil {
			t.Errorf("Resolve(%q) 应当被接受（与允许根是同一个位置），得到 %v", p, err)
		}
	}
}

// SetAllowedRoots 的启动期校验：空合法（不限制），非绝对路径与不存在的目录必须报错。
func TestSetAllowedRootsValidation(t *testing.T) {
	t.Cleanup(ClearAllowedRoots)

	if err := SetAllowedRoots(nil); err != nil {
		t.Fatalf("空应当合法（表示不限制），得到 %v", err)
	}
	if got := AllowedRoots(); len(got) != 0 {
		t.Fatalf("空之后 AllowedRoots() = %v，期望空", got)
	}
	// 只写了空串的项当作「没写」，不该报错也不该让整条规则失效。
	if err := SetAllowedRoots([]string{"", "   "}); err != nil {
		t.Fatalf("空白项应当被忽略，得到 %v", err)
	}
	if got := AllowedRoots(); len(got) != 0 {
		t.Fatalf("空白项之后 AllowedRoots() = %v，期望空", got)
	}

	if err := SetAllowedRoots([]string{"relative/dir"}); err == nil {
		t.Error("相对路径应当报错（canonical 化会拒绝）")
	}
	if err := SetAllowedRoots([]string{filepath.Join(t.TempDir(), "nope")}); err == nil {
		t.Error("不存在的目录应当报错")
	}
	// 其中一项有问题就不能「半个生效」：整体保持不限制。
	if got := AllowedRoots(); len(got) != 0 {
		t.Errorf("SetAllowedRoots 失败后 AllowedRoots() = %v，期望保持空", got)
	}

	// 存在的目录：接受，并归一化成 canonical 形态（Windows 上会把反斜杠变成正斜杠）。
	dirA, dirB := t.TempDir(), t.TempDir()
	if err := SetAllowedRoots([]string{dirA, dirB}); err != nil {
		t.Fatalf("存在的目录应当被接受，得到 %v", err)
	}
	wantA, err := CanonicalizePath(filepath.ToSlash(dirA))
	if err != nil {
		t.Fatal(err)
	}
	wantB, err := CanonicalizePath(filepath.ToSlash(dirB))
	if err != nil {
		t.Fatal(err)
	}
	got := AllowedRoots()
	if len(got) != 2 || got[0] != wantA || got[1] != wantB {
		t.Errorf("AllowedRoots() = %v，期望 [%q %q]", got, wantA, wantB)
	}
}

// 多条允许根是**并集**：落在任意一条之内都放行。
func TestMultipleBasesAreUnion(t *testing.T) {
	t.Cleanup(ClearAllowedRoots)

	dirA, dirB := t.TempDir(), t.TempDir()
	if err := SetAllowedRoots([]string{dirA, dirB}); err != nil {
		t.Fatal(err)
	}
	canonA, _ := CanonicalizePath(filepath.ToSlash(dirA))
	canonB, _ := CanonicalizePath(filepath.ToSlash(dirB))

	for _, p := range []string{canonA, canonA + "/x", canonB, canonB + "/y/z"} {
		if _, err := Resolve(p); err != nil {
			t.Errorf("Resolve(%q) 应当在并集之内，得到 %v", p, err)
		}
	}
	// 两条之外的第三个目录仍然被拒。
	other, _ := CanonicalizePath(filepath.ToSlash(t.TempDir()))
	if _, err := Resolve(other); err != ErrPathOutsideRoots {
		t.Errorf("第三条路径应当在范围外，得到 %v", err)
	}
}

// 嵌套的允许根被折叠成外层那一条：内层不会让任何新路径变得可访问。
func TestNestedBasesAreDeduped(t *testing.T) {
	parent := t.TempDir()
	child := filepath.Join(parent, "inner")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	canonParent, _ := CanonicalizePath(filepath.ToSlash(parent))
	canonChild, _ := CanonicalizePath(filepath.ToSlash(child))

	cases := [][]string{
		{canonParent, canonChild}, // 外在前
		{canonChild, canonParent}, // 内在前——顺序无关
	}
	for _, in := range cases {
		t.Cleanup(ClearAllowedRoots)
		if err := SetAllowedRoots(in); err != nil {
			t.Fatal(err)
		}
		got := AllowedRoots()
		if len(got) != 1 || got[0] != canonParent {
			t.Errorf("SetAllowedRoots(%v) 之后 AllowedRoots() = %v，期望只剩外层 [%q]", in, got, canonParent)
		}
	}
}

// TopLevelAllowedRoots 只给不与别的允许根重叠的那些，且已折叠（两者都保证了不重复）。
func TestTopLevelAllowedRoots(t *testing.T) {
	t.Cleanup(ClearAllowedRoots)

	parent := t.TempDir()
	child := filepath.Join(parent, "inner")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()

	if err := SetAllowedRoots([]string{parent, child, other}); err != nil {
		t.Fatal(err)
	}
	got := TopLevelAllowedRoots()
	if len(got) != 2 {
		t.Fatalf("TopLevelAllowedRoots() = %v，期望 2 项（嵌套的那个被折叠）", got)
	}
	canonParent, _ := CanonicalizePath(filepath.ToSlash(parent))
	canonOther, _ := CanonicalizePath(filepath.ToSlash(other))
	seen := map[string]bool{}
	for _, p := range got {
		seen[p] = true
	}
	if !seen[canonParent] || !seen[canonOther] {
		t.Errorf("TopLevelAllowedRoots() = %v，期望包含 %q 与 %q", got, canonParent, canonOther)
	}
}

// InDrives 判「恰好是某一项」，不是「落在其下」：这个区别曾经害我留下过 D: 根。
func TestInDrivesIsExactMatch(t *testing.T) {
	drives := []types.Drive{
		{Label: "C:", Path: "C:"},
		{Label: "base", Path: "C:/work/bin"},
	}
	if !InDrives(drives, "C:/work/bin") {
		t.Error("完全相同应当匹配")
	}
	if InDrives(drives, "C:/work/bin/sub") {
		t.Error("落在其下不算「已经是列表里的一项」")
	}
	if InDrives(drives, "C:") != true {
		t.Error("盘符根应当匹配")
	}
	// 盘符大小写不敏感（同一套折叠规则）。
	if !InDrives(drives, "c:") {
		t.Error("盘符大小写不该影响相等判定")
	}
}

// foldForComparison 是范围比较的全部细节所在，单独钉住它。
//
// 它必须做比较键那件事（盘符大写、UNC 主机名小写、共享名原样），
// 再加上按平台的大小写折叠——这几条混起来很容易写漏一条。
func TestFoldForComparison(t *testing.T) {
	// splitNamespace 只负责**切分**，不做任何大小写归一化：
	// 归一化是 foldForComparison 的事（它才知道平台）。
	split := []struct {
		in                            string
		wantHost, wantShare, wantRest string
	}{
		{"/srv/files", "", "", "/srv/files"},
		{"C:/Users/me", "C:", "", "/Users/me"},
		{"//Server/Share/Docs", "//Server", "/Share", "/Docs"},
		{"//Server/Share", "//Server", "/Share", ""},
		// 只给到主机名：不拆分，交给 canonical 化去拒。
		{"//onlyhost", "//onlyhost", "", ""},
	}
	for _, c := range split {
		host, share, rest := splitNamespace(c.in)
		if host != c.wantHost || share != c.wantShare || rest != c.wantRest {
			t.Errorf("splitNamespace(%q) = (%q, %q, %q)，期望 (%q, %q, %q)",
				c.in, host, share, rest, c.wantHost, c.wantShare, c.wantRest)
		}
	}

	// 折叠后的形态不需要精确断言（大小写不敏感平台上盘符也会被折成小写，那没问题）：
	// 要钉住的是三条**性质**——同一位置的不同写法折到同一个键、共享名不被改动、
	// 折叠不破坏段边界。
	sameFold := [][2]string{
		{"c:/Users/me", "C:/Users/me"},                 // 盘符大小写是同一个卷
		{"//Server/Share/Docs", "//server/Share/Docs"}, // 主机名大小写同一个共享
	}
	if caseInsensitivePaths {
		sameFold = append(sameFold,
			[2]string{"/srv/Files/A.TXT", "/srv/files/a.txt"}, // 路径部分随平台折叠
			[2]string{"C:/Users/Me/A.TXT", "c:/users/me/a.txt"},
		)
	}
	for _, pair := range sameFold {
		if foldForComparison(pair[0]) != foldForComparison(pair[1]) {
			t.Errorf("foldForComparison(%q)=%q 与 foldForComparison(%q)=%q 应当相同",
				pair[0], foldForComparison(pair[0]), pair[1], foldForComparison(pair[1]))
		}
	}

	// 共享名永远不能被折叠：不同 SMB 服务器对共享名大小写的行为不一致，
	// 把两个不同的共享折成同一个键会指向另一个位置。
	shareFolded := foldForComparison("//Server/Share/Docs")
	if strings.Contains(shareFolded, "/share/") {
		t.Errorf("共享名被折叠了：%q", shareFolded)
	}
	if !strings.HasPrefix(shareFolded, "//server/") {
		t.Errorf("主机名应当小写，得到 %q", shareFolded)
	}

	// 折叠不能把边界放宽：折完之后仍必须是段边界匹配。
	if allowedPathIn("/srv/files2", "/srv/files") {
		t.Error("折叠之后 /srv/files2 仍不该算在 /srv/files 之内")
	}
	if !allowedPathIn("/srv/files/a", "/srv/files") {
		t.Error("折叠之后 /srv/files/a 应当算在 /srv/files 之内")
	}
}

// allowedPathIn 用给定的允许根做一次范围判定（不改全局状态）。
func allowedPathIn(path, base string) bool {
	return IsWithinRoot(foldForComparison(path), foldForComparison(base))
}

// 文件不是目录：明确拒绝，而不是等到请求时才出现一堆莫名其妙的失败。
func TestSetAllowedRootsRejectsFile(t *testing.T) {
	t.Cleanup(ClearAllowedRoots)

	file := filepath.Join(t.TempDir(), "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := SetAllowedRoots([]string{file}); err == nil {
		t.Error("允许根指向一个文件时应当报错")
	}
}
