package fileops

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 不限制是默认值，而且必须是**真的**不限制：这条路径上的每一次 Resolve 都会走到它，
// 任何一个「配了基目录才正常」的假设都会让默认部署出问题。
func TestBaseDirUnsetAllowsEverything(t *testing.T) {
	ClearBaseDir()
	t.Cleanup(ClearBaseDir)

	for _, p := range []string{"/", "/srv/files", "C:/Users/me", "//server/share/docs", "/etc/shadow"} {
		if _, err := Resolve(p); err != nil {
			t.Errorf("未配置基目录时 Resolve(%q) 不该报错，得到 %v", p, err)
		}
	}
}

// 段边界：基目录 /srv/files 不得匹配 /srv/files2。
//
// 这是裸 strings.HasPrefix 的经典漏洞，也是这个特性最容易写错的一处：
// 同级目录被放进来，等于「限制」只挡住了拼写完全相同的路径。
func TestBaseDirRespectsSegmentBoundary(t *testing.T) {
	setBaseDirFrom("/srv/files")
	t.Cleanup(ClearBaseDir)

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
		"/srv",              // 基目录的父目录
		"/srv/other",        // 基目录的同级
		"/",                 // 根在基目录之外
		"/srv/filesX",       // 又一个同级
		"/srv/files-backup", // 同级，带后缀
	}
	for _, p := range outside {
		if _, err := Resolve(p); err != ErrPathOutsideBase {
			t.Errorf("Resolve(%q) 应当报 ErrPathOutsideBase，得到 %v", p, err)
		}
	}
}

// 盘符与 UNC 主机名用比较键判断：C: 与 c: 是同一个卷，不该因为大小写被拒。
//
// 而路径**部分**的大小写按平台处理，见 TestBaseDirFolderCaseByPlatform。
func TestBaseDirComparisonKeySemantics(t *testing.T) {
	t.Run("盘符大小写不敏感", func(t *testing.T) {
		setBaseDirFrom("C:/Users/me")
		t.Cleanup(ClearBaseDir)

		if _, err := Resolve("c:/Users/me/a.txt"); err != nil {
			t.Errorf("盘符大小写不该影响判定，得到 %v", err)
		}
		if _, err := Resolve("D:/Users/me/a.txt"); err != ErrPathOutsideBase {
			t.Errorf("另一个盘符应当在范围外，得到 %v", err)
		}
	})

	t.Run("UNC 主机名大小写不敏感", func(t *testing.T) {
		setBaseDirFrom("//Server/Share")
		t.Cleanup(ClearBaseDir)

		if _, err := Resolve("//server/Share/docs/a.txt"); err != nil {
			t.Errorf("主机名大小写不该影响判定，得到 %v", err)
		}
		// 共享名保持大小写敏感：不同 SMB 服务器对共享名大小写的行为不一致，
		// 误判为「同一个」会操作错位置（见 ComparisonKey）。
		if _, err := Resolve("//server/share/docs/a.txt"); err != ErrPathOutsideBase {
			t.Errorf("共享名大小写不同应当判为范围外，得到 %v", err)
		}
	})
}

// 路径**部分**的大小写：按平台折叠。
//
// 这一条与挂载点匹配（LongestMount）刻意不同。挂载点匹配错一次只是「属于哪个卷」
// 判断错（并发档位、错误映射），而访问控制判错的后果是**把一个合法路径挡在门外**：
// Windows 上 `C:/Users/Me` 与基目录 `C:/Users/me` 是同一个目录，不是越权。
func TestBaseDirFolderCaseByPlatform(t *testing.T) {
	setBaseDirFrom("C:/Users/me")
	t.Cleanup(ClearBaseDir)

	_, err := Resolve("C:/Users/ME/nested/a.txt")
	if caseInsensitivePaths {
		if err != nil {
			t.Errorf("Windows / macOS 上大小写不同的同一路径应当被接受，得到 %v", err)
		}
	} else if err != ErrPathOutsideBase {
		t.Errorf("大小写敏感的平台上应当判为范围外，得到 %v", err)
	}

	// 无论哪个平台，「大小写折叠后仍不在基目录之下」都必须被拒——
	// 折叠不能把边界放宽成「同一个前缀就行」。
	if _, err := Resolve("C:/Users/me2/a.txt"); err != ErrPathOutsideBase {
		t.Errorf("折叠大小写之后，段边界仍必须成立，得到 %v", err)
	}
}

// UNC 是独立命名空间：基目录是 Unix 根下的目录时，UNC 路径不该被判成「在范围之内」。
func TestBaseDirDoesNotLeakAcrossNamespaces(t *testing.T) {
	setBaseDirFrom("/srv/files")
	t.Cleanup(ClearBaseDir)

	if _, err := Resolve("//server/share/docs"); err != ErrPathOutsideBase {
		t.Errorf("UNC 路径不应被判成落在 Unix 基目录之内，得到 %v", err)
	}

	// 反向：基目录是 UNC 时，本机路径也不能被放进来。
	setBaseDirFrom("//server/share")
	if _, err := Resolve("/srv/files"); err != ErrPathOutsideBase {
		t.Errorf("本机路径不应被判成落在 UNC 基目录之内，得到 %v", err)
	}
}

// 形态错误优先于范围错误：一条相对路径应当报「不合法」（400），而不是「超出范围」（403）。
// 后者会让用户去翻配置，而真正的问题是他少写了一个斜杠。
func TestBaseDirShapeErrorsTakePrecedence(t *testing.T) {
	setBaseDirFrom("/srv/files")
	t.Cleanup(ClearBaseDir)

	for _, p := range []string{"relative/dir", "/a/../../b", "C:relative", "//onlyhost", ""} {
		_, err := Resolve(p)
		if err == nil {
			t.Errorf("Resolve(%q) 应当报错", p)
			continue
		}
		if errors.Is(err, ErrPathOutsideBase) {
			t.Errorf("Resolve(%q) 应当报形态错误而不是范围错误", p)
		}
	}
}

// `..` 穿越由 canonical 化负责，与基目录无关：越出根就已经是形态错误。
// 在基目录之内用 `..` 回到基目录本身是合法的（那是同一个位置）。
func TestBaseDirTraversalHandling(t *testing.T) {
	setBaseDirFrom("/srv/files")
	t.Cleanup(ClearBaseDir)

	// 用 .. 从子目录回到基目录：结果是基目录本身，在范围内。
	if _, err := Resolve("/srv/files/a/../b.txt"); err != nil {
		t.Errorf("在基目录内用 .. 归位应当被接受，得到 %v", err)
	}
	// 用 .. 从基目录越出去：canonical 化后就落到 /srv，属于范围外。
	if _, err := Resolve("/srv/files/../other"); err != ErrPathOutsideBase {
		t.Errorf("用 .. 越出基目录应当被拒绝，得到 %v", err)
	}
}

// 基目录本身的所有写法都应当被接受（尾斜杠、反斜杠、"." 段）。
func TestBaseDirAcceptsEquivalentSpellings(t *testing.T) {
	setBaseDirFrom("/srv/files")
	t.Cleanup(ClearBaseDir)

	for _, p := range []string{"/srv/files", "/srv/files/", "/srv/./files", `/srv\files`, "/srv//files"} {
		if _, err := Resolve(p); err != nil {
			t.Errorf("Resolve(%q) 应当被接受（与基目录是同一个位置），得到 %v", p, err)
		}
	}
}

// SetBaseDir 的启动期校验：空串合法（不限制），非绝对路径与不存在的目录必须报错。
func TestSetBaseDirValidation(t *testing.T) {
	t.Cleanup(ClearBaseDir)

	if err := SetBaseDir(""); err != nil {
		t.Fatalf("空串应当合法（表示不限制），得到 %v", err)
	}
	if got := BaseDir(); got != "" {
		t.Fatalf("空串之后 BaseDir() = %q，期望空串", got)
	}

	if err := SetBaseDir("relative/dir"); err == nil {
		t.Error("相对路径应当报错（canonical 化会拒绝）")
	}
	if err := SetBaseDir(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("不存在的目录应当报错")
	}
	// 配置错了不能留下「半个生效」的状态：失败的 SetBaseDir 必须保持不限制。
	if got := BaseDir(); got != "" {
		t.Errorf("SetBaseDir 失败后 BaseDir() = %q，期望保持空串", got)
	}

	// 存在的目录：接受，并归一化成 canonical 形态（Windows 上会把反斜杠变成正斜杠）。
	dir := t.TempDir()
	if err := SetBaseDir(dir); err != nil {
		t.Fatalf("存在的目录应当被接受，得到 %v", err)
	}
	want, err := CanonicalizePath(filepath.ToSlash(dir))
	if err != nil {
		t.Fatal(err)
	}
	if got := BaseDir(); got != want {
		t.Errorf("BaseDir() = %q，期望 %q", got, want)
	}
}

// foldForBase 是范围比较的全部细节所在，单独钉住它。
//
// 它必须做比较键那件事（盘符大写、UNC 主机名小写、共享名原样），
// 再加上按平台的大小写折叠——这几条混起来很容易写漏一条。
func TestFoldForBase(t *testing.T) {
	// splitBaseNamespace 只负责**切分**，不做任何大小写归一化：
	// 归一化是 foldForBase 的事（它才知道平台）。
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
		host, share, rest := splitBaseNamespace(c.in)
		if host != c.wantHost || share != c.wantShare || rest != c.wantRest {
			t.Errorf("splitBaseNamespace(%q) = (%q, %q, %q)，期望 (%q, %q, %q)",
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
		if foldForBase(pair[0]) != foldForBase(pair[1]) {
			t.Errorf("foldForBase(%q)=%q 与 foldForBase(%q)=%q 应当相同",
				pair[0], foldForBase(pair[0]), pair[1], foldForBase(pair[1]))
		}
	}

	// 共享名永远不能被折叠：不同 SMB 服务器对共享名大小写的行为不一致，
	// 把两个不同的共享折成同一个键会指向另一个位置。
	shareFolded := foldForBase("//Server/Share/Docs")
	if strings.Contains(shareFolded, "/share/") {
		t.Errorf("共享名被折叠了：%q", shareFolded)
	}
	if !strings.HasPrefix(shareFolded, "//server/") {
		t.Errorf("主机名应当小写，得到 %q", shareFolded)
	}

	// 折叠不能把边界放宽：折完之后仍必须是段边界匹配。
	if pathWithinBaseIn("/srv/files2", "/srv/files") {
		t.Error("折叠之后 /srv/files2 仍不该算在 /srv/files 之内")
	}
	if !pathWithinBaseIn("/srv/files/a", "/srv/files") {
		t.Error("折叠之后 /srv/files/a 应当算在 /srv/files 之内")
	}
}

// pathWithinBaseIn 用给定的基目录做一次范围判定（不改全局状态）。
func pathWithinBaseIn(path, base string) bool {
	return IsWithinRoot(foldForBase(path), foldForBase(base))
}

// 文件不是目录：明确拒绝，而不是等到请求时才出现一堆莫名其妙的失败。
func TestSetBaseDirRejectsFile(t *testing.T) {
	t.Cleanup(ClearBaseDir)

	file := filepath.Join(t.TempDir(), "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := SetBaseDir(file); err == nil {
		t.Error("基目录指向一个文件时应当报错")
	}
}
