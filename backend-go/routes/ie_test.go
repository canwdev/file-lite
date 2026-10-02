package routes

import (
	"bytes"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/types"
	"file-lite-go/utils"
)

func newIEServer() *echo.Echo {
	e := withAPIErrorHandler(echo.New())
	fileops.SetMounts(visibleDrives())
	RegisterIE(e)
	return e
}

// ieCall 发一个请求；withAuth 时带上与浏览器相同的两个 cookie。
func ieCall(t *testing.T, e *echo.Echo, method, target, form string, withAuth bool) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if form != "" {
		body = strings.NewReader(form)
	}
	req := httptest.NewRequest(method, target, body)
	if form != "" {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationForm)
	}
	if withAuth {
		ieAuthCookies(t, req)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// ieAuthCookies 给请求带上与浏览器相同的两个 cookie。
func ieAuthCookies(t *testing.T, req *http.Request) {
	t.Helper()
	token, err := config.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName, Value: token})
	req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName, Value: "sess"})
}

// ieUploadPart 描述一个 multipart part：普通字段，或一个文件（file 原样进 header，
// 好让测试能塞进 IE 那种非 UTF-8 的文件名）。
type ieUploadPart struct {
	name   string
	value  string
	isFile bool
	file   string
}

// ieUploadForm 拼一个 multipart 请求体，part 顺序就是传进来的顺序。
func ieUploadForm(t *testing.T, parts []ieUploadPart) (body, contentType string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for _, part := range parts {
		if !part.isFile {
			if err := writer.WriteField(part.name, part.value); err != nil {
				t.Fatal(err)
			}
			continue
		}
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="%s"; filename="%s"`, part.name, part.file))
		header.Set("Content-Type", "application/octet-stream")
		section, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := section.Write([]byte(part.value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.String(), writer.FormDataContentType()
}

// iePostRaw 发一个自带 body 与 Content-Type 的 POST。
func iePostRaw(t *testing.T, e *echo.Echo, target, body, contentType string, withAuth bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, contentType)
	if withAuth {
		ieAuthCookies(t, req)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// ieNoticeOf 从重定向的 Location 里取出 notice。
func ieNoticeOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	location, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("Location 解析失败：%v", err)
	}
	return location.Query().Get("notice")
}

func TestIEClassicNeedsLogin(t *testing.T) {
	e := newIEServer()

	anon := ieCall(t, e, http.MethodGet, "/ie", "", false)
	if anon.Code != http.StatusFound || anon.Header().Get("Location") != "/ie/login" {
		t.Fatalf("/ie 未登录 = %d %q，期望 302 /ie/login", anon.Code, anon.Header().Get("Location"))
	}

	browse := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape("/tmp"), "", false)
	location := browse.Header().Get("Location")
	if browse.Code != http.StatusFound || !strings.HasPrefix(location, "/ie/login?next=") {
		t.Fatalf("未登录浏览 = %d %q，期望 302 到登录页并带 next", browse.Code, location)
	}

	login := ieCall(t, e, http.MethodGet, "/ie/login", "", false)
	if login.Code != http.StatusOK {
		t.Fatalf("登录页 = %d", login.Code)
	}
	if contentType := login.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("登录页 Content-Type = %q", contentType)
	}
	// 纯 HTML 表单：没有 JS，登录只能靠 POST。
	if body := login.Body.String(); !strings.Contains(body, `action="/ie/login"`) || !strings.Contains(body, `name="password"`) {
		t.Fatalf("登录页缺少表单：%s", body)
	}
	// Remember me 默认勾上（票据登录也是记住的，两边一致）。
	if body := login.Body.String(); !strings.Contains(body, "checked") {
		t.Fatalf("Remember me 应当默认勾上：%s", body)
	}
}

// 票据登录：链接本身就能进，不需要先看表单再点一次。
func TestIEClassicTicketLogin(t *testing.T) {
	e := newIEServer()

	ticket, err := config.NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{
		"/ie?ticket=" + url.QueryEscape(ticket.Value),
		"/ie/login?ticket=" + url.QueryEscape(ticket.Value),
	} {
		rec := ieCall(t, e, http.MethodGet, target, "", false)
		if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/ie" {
			t.Fatalf("%s = %d %q，期望 302 /ie", target, rec.Code, rec.Header().Get("Location"))
		}
		if !strings.Contains(strings.Join(rec.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName) {
			t.Fatalf("%s 没有换成会话 cookie", target)
		}
	}

	// 过期 / 用过的票据：留在登录页并说明原因，而不是白屏或 401。
	bad := ieCall(t, e, http.MethodGet, "/ie/login?ticket=not-a-ticket", "", false)
	if bad.Code != http.StatusOK {
		t.Fatalf("无效票据 = %d，期望停在登录页", bad.Code)
	}
	if !strings.Contains(bad.Body.String(), "expired") {
		t.Fatalf("无效票据应当说明原因：%s", bad.Body.String())
	}
}

// 登录页提供 password / ticket 两种方式，由 radio 决定，服务端按选中的那一栏校验。
func TestIEClassicLoginFormModes(t *testing.T) {
	e := newIEServer()

	page := ieCall(t, e, http.MethodGet, "/ie/login", "", false)
	body := page.Body.String()
	if !strings.Contains(body, `value="password" checked`) {
		t.Fatalf("默认应当选中密码登录：%s", body)
	}
	if !strings.Contains(body, `value="ticket"`) {
		t.Fatalf("缺少票据选项：%s", body)
	}

	// 链接里的票据无效：选中票据栏、回填输入、说明原因。
	bad := ieCall(t, e, http.MethodGet, "/ie/login?ticket=deadbeef", "", false)
	if bad.Code != http.StatusOK {
		t.Fatalf("无效票据 = %d，期望停在登录页", bad.Code)
	}
	badBody := bad.Body.String()
	for _, want := range []string{`value="ticket" checked`, `value="deadbeef"`, "expired"} {
		if !strings.Contains(badBody, want) {
			t.Errorf("无效票据页缺少 %q", want)
		}
	}
}

func TestIEClassicLoginSubmitModes(t *testing.T) {
	e := newIEServer()
	ticket, err := config.NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}

	// 选了票据：成功换会话并跳转。
	ok := ieCall(t, e, http.MethodPost, "/ie/login",
		"mode=ticket&ticket="+url.QueryEscape(ticket.Value)+"&next=/ie", false)
	if ok.Code != http.StatusFound {
		t.Fatalf("票据登录 = %d：%s", ok.Code, ok.Body.String())
	}
	if !strings.Contains(strings.Join(ok.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName) {
		t.Fatal("票据登录应当设置 cookie")
	}

	// 选了票据却没填：400，不算一次凭据尝试（不进失败封禁）。
	empty := ieCall(t, e, http.MethodPost, "/ie/login", "mode=ticket", false)
	if empty.Code != http.StatusBadRequest || !strings.Contains(empty.Body.String(), "Enter the ticket") {
		t.Fatalf("空票据 = %d：%s", empty.Code, empty.Body.String())
	}

	// radio 是权威：选了密码就必须用密码，表单里带着有效票据也不能绕过。
	spare, err := config.NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}
	bypass := ieCall(t, e, http.MethodPost, "/ie/login",
		"mode=password&password=wrong&ticket="+url.QueryEscape(spare.Value), false)
	if bypass.Code != http.StatusUnauthorized {
		t.Fatalf("选密码时不该用票据登录 = %d", bypass.Code)
	}
	if len(bypass.Header().Values("Set-Cookie")) != 0 {
		t.Fatal("失败的密码登录不该设置 cookie")
	}

	// 没带 mode 的老式提交：谁填了用谁。
	legacyTicket, err := config.NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}
	legacy := ieCall(t, e, http.MethodPost, "/ie/login", "ticket="+url.QueryEscape(legacyTicket.Value), false)
	if legacy.Code != http.StatusFound {
		t.Fatalf("无 mode 的票据提交 = %d", legacy.Code)
	}
}

// 侧栏只显示最后一段文件夹名（完整路径留在 title 里），路径框可以手输并点 Go 跳转。
func TestIEClassicSidebarLabelsAndPathForm(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	favourite := filepath.ToSlash(filepath.Join(dir, "deep", "notes"))

	// 收藏是只读展示，键与前端 LsKeys.STARED_PATH 一致。
	if _, err := utils.SetSettingsValue(ieStaredPathKey, []any{favourite}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = utils.DeleteSettingsValue(ieStaredPathKey) })

	e := newIEServer()
	page := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(filepath.ToSlash(dir)), "", true)
	body := page.Body.String()

	if !strings.Contains(body, `title="`+favourite+`"`) {
		t.Errorf("收藏项应当把完整路径放进 title")
	}
	if !strings.Contains(body, `>notes</a>`) {
		t.Errorf("收藏项应当只显示最后一段文件夹名")
	}

	// 驱动器同样只显示最后一段。
	if drives := visibleDrives(); len(drives) > 0 {
		label := fileops.BaseName(drives[0].Path)
		if !strings.Contains(body, `>`+label+`</a>`) {
			t.Errorf("驱动器项应当只显示 %q", label)
		}
	}

	// 路径框 + Go：GET 表单，手输路径后由服务端渲染目标目录。
	for _, want := range []string{`action="/ie/browse"`, `name="path"`, `value="Go"`, `value="` + filepath.ToSlash(dir) + `"`} {
		if !strings.Contains(body, want) {
			t.Errorf("路径框缺少 %q", want)
		}
	}
}

// 多选上传：一个 file 输入框带 multiple，服务端按 part 顺序流式收下。
func TestIEClassicUpload(t *testing.T) {
	dir := t.TempDir()
	slash := filepath.ToSlash(dir)
	body, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "sess"},
		{name: "files", value: "alpha", isFile: true, file: "a.txt"},
		{name: "files", value: "beta", isFile: true, file: "b.txt"},
	})

	e := newIEServer()
	rec := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash), body, contentType, true)
	if rec.Code != http.StatusFound {
		t.Fatalf("上传 = %d：%s", rec.Code, rec.Body.String())
	}
	if location := rec.Header().Get("Location"); !strings.HasPrefix(location, "/ie/browse?path=") {
		t.Fatalf("上传后应当回到目录，得到 %q", location)
	}
	if notice := ieNoticeOf(t, rec); !strings.Contains(notice, "Uploaded 2") {
		t.Fatalf("notice = %q", notice)
	}
	for name, want := range map[string]string{"a.txt": "alpha", "b.txt": "beta"} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s 没写进去：%v", name, err)
		}
		if string(got) != want {
			t.Errorf("%s 内容 = %q，期望 %q", name, got, want)
		}
	}

	// 没有会话 cookie 时不该收任何东西。
	anon := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash), body, contentType, false)
	if anon.Code != http.StatusFound || !strings.HasPrefix(anon.Header().Get("Location"), "/ie/login") {
		t.Fatalf("未登录上传 = %d %q", anon.Code, anon.Header().Get("Location"))
	}
}

// 同名策略、CSRF 与越界：都要在**写之前**挡住。
func TestIEClassicUploadGuards(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "dest")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	slash := filepath.ToSlash(dir)

	// 已存在：默认跳过，原内容不动，notice 说明被跳过。
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	body, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "sess"},
		{name: "files", value: "new", isFile: true, file: "a.txt"},
	})
	e := newIEServer()
	rec := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash), body, contentType, true)
	if notice := ieNoticeOf(t, rec); !strings.Contains(notice, "skipped 1") {
		t.Fatalf("已有同名文件时应当跳过：%q", notice)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(got) != "old" {
		t.Errorf("跳过的文件被改了：%q", got)
	}

	// ?onConflict=overwrite 覆盖，?onConflict=keep-both 另存。
	overwrite, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "sess"},
		{name: "files", value: "new", isFile: true, file: "a.txt"},
	})
	iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash)+"&onConflict=overwrite", overwrite, contentType, true)
	if got, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(got) != "new" {
		t.Errorf("overwrite 没生效：%q", got)
	}

	keepBoth, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "sess"},
		{name: "files", value: "copy", isFile: true, file: "a.txt"},
	})
	iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash)+"&onConflict=keep-both", keepBoth, contentType, true)
	if _, err := os.Stat(filepath.Join(dir, "a (1).txt")); err != nil {
		t.Errorf("keep-both 应当另存为 a (1).txt：%v", err)
	}

	// CSRF 不对：403，且一个字节都不写。
	wrongCSRF, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "not-the-session"},
		{name: "files", value: "x", isFile: true, file: "csrf-miss.txt"},
	})
	forbidden := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash), wrongCSRF, contentType, true)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("CSRF 不对 = %d，期望 403", forbidden.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "csrf-miss.txt")); !os.IsNotExist(err) {
		t.Error("CSRF 没过却写了文件")
	}

	// 文件排在 csrf 之前：顺序保证不了就 fail closed。
	reordered, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "files", value: "x", isFile: true, file: "reordered.txt"},
		{name: "csrf", value: "sess"},
	})
	early := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash), reordered, contentType, true)
	if early.Code != http.StatusForbidden {
		t.Fatalf("文件先到 = %d，期望 403", early.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "reordered.txt")); !os.IsNotExist(err) {
		t.Error("未校验的 part 被写了")
	}

	// 目标在允许根之外：403 HTML。
	withBases(t, dir)
	outside := iePostRaw(t, newIEServer(), "/ie/upload?path="+url.QueryEscape(filepath.ToSlash(base)), body, contentType, true)
	if outside.Code != http.StatusForbidden {
		t.Fatalf("越界上传 = %d，期望 403", outside.Code)
	}

	// 目标不是目录：400。
	notDir := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(slash+"/a.txt"), body, contentType, true)
	if notDir.Code != http.StatusBadRequest {
		t.Fatalf("往文件上上传 = %d，期望 400", notDir.Code)
	}
}

// IE 发来的文件名是系统 ANSI 代码页（中文 Windows 是 GBK），落盘前要转成 UTF-8。
func TestIEClassicUploadGBKFilename(t *testing.T) {
	dir := t.TempDir()
	gbkName := "\xb1\xa8\xb8\xe6.txt" // GBK 的「报告.txt」，不是合法 UTF-8
	body, contentType := ieUploadForm(t, []ieUploadPart{
		{name: "csrf", value: "sess"},
		{name: "files", value: "report", isFile: true, file: gbkName},
	})

	e := newIEServer()
	rec := iePostRaw(t, e, "/ie/upload?path="+url.QueryEscape(filepath.ToSlash(dir)), body, contentType, true)
	if rec.Code != http.StatusFound {
		t.Fatalf("上传 = %d：%s", rec.Code, rec.Body.String())
	}
	if got, err := os.ReadFile(filepath.Join(dir, "报告.txt")); err != nil || string(got) != "report" {
		t.Fatalf("GBK 文件名没转成 UTF-8：err=%v got=%q", err, got)
	}
}

func TestDecodeUploadFilename(t *testing.T) {
	if got := decodeUploadFilename("plain.txt"); got != "plain.txt" {
		t.Errorf("合法 UTF-8 不该被动：%q", got)
	}
	if got := decodeUploadFilename("报告.txt"); got != "报告.txt" {
		t.Errorf("UTF-8 中文不该被动：%q", got)
	}
	if got := decodeUploadFilename("\xb1\xa8\xb8\xe6.txt"); got != "报告.txt" {
		t.Errorf("GBK 应当被解码：%q", got)
	}
	// 既非 UTF-8 也解不出 GBK：退化成替换非法字节，而不是留一个坏名字。
	if got := decodeUploadFilename("\xff\xfe.txt"); !utf8.ValidString(got) {
		t.Errorf("兜底结果仍是非法 UTF-8：%q", got)
	}
}

// 新建文件夹、重命名、删除：都是表单 + PRG，删除必须先过一次确认页。
func TestIEClassicMkdirRenameDelete(t *testing.T) {
	dir := t.TempDir()
	slash := filepath.ToSlash(dir)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "tree", "inner"), 0755); err != nil {
		t.Fatal(err)
	}

	e := newIEServer()

	// 新建文件夹。
	created := ieCall(t, e, http.MethodPost, "/ie/mkdir?path="+url.QueryEscape(slash), "csrf=sess&name=photos", true)
	if notice := ieNoticeOf(t, created); !strings.Contains(notice, "Created folder photos") {
		t.Fatalf("mkdir notice = %q", notice)
	}
	if st, err := os.Stat(filepath.Join(dir, "photos")); err != nil || !st.IsDir() {
		t.Fatalf("目录没建出来：%v", err)
	}

	// 重名、越界名、CSRF 不对：都只回一行说明，不建东西。
	again := ieCall(t, e, http.MethodPost, "/ie/mkdir?path="+url.QueryEscape(slash), "csrf=sess&name=photos", true)
	if notice := ieNoticeOf(t, again); !strings.Contains(notice, "already exists") {
		t.Errorf("重名 notice = %q", notice)
	}
	escape := ieCall(t, e, http.MethodPost, "/ie/mkdir?path="+url.QueryEscape(slash), "csrf=sess&name=../evil", true)
	if notice := ieNoticeOf(t, escape); !strings.Contains(notice, "Invalid folder name") {
		t.Errorf("越界名 notice = %q", notice)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "evil")); !os.IsNotExist(err) {
		t.Error("越界建目录了")
	}
	noCSRF := ieCall(t, e, http.MethodPost, "/ie/mkdir?path="+url.QueryEscape(slash), "csrf=nope&name=sneaky", true)
	if noCSRF.Code != http.StatusForbidden {
		t.Errorf("CSRF 不对 = %d，期望 403", noCSRF.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "sneaky")); !os.IsNotExist(err) {
		t.Error("CSRF 没过却建了目录")
	}

	// 改名对话框：GET 不写任何东西，输入框预填当前名字。
	dialog := ieCall(t, e, http.MethodGet, "/ie/rename?path="+url.QueryEscape(slash+"/a.txt"), "", true)
	if dialog.Code != http.StatusOK || !strings.Contains(dialog.Body.String(), `value="a.txt"`) {
		t.Fatalf("改名页 = %d：%s", dialog.Code, dialog.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); err != nil {
		t.Fatal("GET 不该动文件")
	}

	renamed := ieCall(t, e, http.MethodPost, "/ie/rename?path="+url.QueryEscape(slash+"/a.txt"), "csrf=sess&name=b.txt", true)
	if notice := ieNoticeOf(t, renamed); !strings.Contains(notice, "Renamed a.txt to b.txt") {
		t.Fatalf("rename notice = %q", notice)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); err != nil {
		t.Fatalf("改名没生效：%v", err)
	}

	// 改成已存在的名字：说明冲突，源文件不能消失。
	conflict := ieCall(t, e, http.MethodPost, "/ie/rename?path="+url.QueryEscape(slash+"/b.txt"), "csrf=sess&name=photos", true)
	if notice := ieNoticeOf(t, conflict); !strings.Contains(notice, "already exists") {
		t.Errorf("冲突 notice = %q", notice)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); err != nil {
		t.Error("冲突时源文件不该消失")
	}

	// 删除确认页：GET 只问不做；目录那页要说明会连内容一起删。
	confirm := ieCall(t, e, http.MethodGet, "/ie/delete?path="+url.QueryEscape(slash+"/b.txt"), "", true)
	if confirm.Code != http.StatusOK || !strings.Contains(confirm.Body.String(), "cannot be undone") {
		t.Fatalf("确认页 = %d：%s", confirm.Code, confirm.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); err != nil {
		t.Fatal("确认页不该删东西")
	}
	treeConfirm := ieCall(t, e, http.MethodGet, "/ie/delete?path="+url.QueryEscape(slash+"/tree"), "", true)
	if !strings.Contains(treeConfirm.Body.String(), "everything inside") {
		t.Error("目录的确认页应当说明会删掉里面所有东西")
	}

	// POST 才真删：文件、以及带内容的目录。
	deleted := ieCall(t, e, http.MethodPost, "/ie/delete?path="+url.QueryEscape(slash+"/b.txt"), "csrf=sess", true)
	if notice := ieNoticeOf(t, deleted); !strings.Contains(notice, "Deleted b.txt") {
		t.Fatalf("delete notice = %q", notice)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); !os.IsNotExist(err) {
		t.Error("文件没删掉")
	}
	ieCall(t, e, http.MethodPost, "/ie/delete?path="+url.QueryEscape(slash+"/tree"), "csrf=sess", true)
	if _, err := os.Stat(filepath.Join(dir, "tree")); !os.IsNotExist(err) {
		t.Error("目录没连内容一起删掉")
	}

	// 未登录：什么都不做。
	anon := ieCall(t, e, http.MethodPost, "/ie/delete?path="+url.QueryEscape(slash+"/photos"), "csrf=sess", false)
	if anon.Code != http.StatusFound || !strings.HasPrefix(anon.Header().Get("Location"), "/ie/login") {
		t.Fatalf("未登录删除 = %d %q", anon.Code, anon.Header().Get("Location"))
	}
	if _, err := os.Stat(filepath.Join(dir, "photos")); err != nil {
		t.Error("未登录却删了目录")
	}

	// 位置根不给删。把允许范围收窄到临时目录，那个目录本身就是枚举出来的位置——
	// 即便这条保护将来失效，代价也只是删掉一个测试临时目录。
	scoped := t.TempDir()
	withBases(t, scoped)
	refused := ieCall(t, newIEServer(), http.MethodPost,
		"/ie/delete?path="+url.QueryEscape(filepath.ToSlash(scoped)), "csrf=sess", true)
	if notice := ieNoticeOf(t, refused); !strings.Contains(notice, "Refusing to delete") {
		t.Errorf("位置根 notice = %q", notice)
	}
	if _, err := os.Stat(scoped); err != nil {
		t.Error("位置根被删了")
	}
}

// 翻页位置要留住：在第 2 页改名 / 删除之后仍然回到第 2 页。
func TestIEClassicKeepsPage(t *testing.T) {
	dir := t.TempDir()
	// 超过一页（iePageSize）才有"第 2 页"这回事。
	for i := 0; i <= iePageSize; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%03d.txt", i)), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	slash := filepath.ToSlash(dir)
	// 升序排完，第 1 页是 f000..f499，第 2 页只有 f500。
	last := filepath.Join(slash, "f500.txt")

	e := newIEServer()
	page2 := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(slash)+"&page=2", "", true)
	body := page2.Body.String()
	if !strings.Contains(body, "page 2/2") {
		t.Fatalf("第 2 页没渲染出来：%s", body)
	}
	if !strings.Contains(body, "&amp;page=2") {
		t.Error("第 2 页的行内操作链接应当带上页码")
	}
	if !strings.Contains(body, "path="+url.QueryEscape(slash)+"&amp;page=2") {
		t.Error("第 2 页的上传 / 新建表单应当带上页码")
	}

	// 确认页把页码带进表单（Go 侧拼的 URL，`&` 可能被转义成 &amp;）。
	confirm := ieCall(t, e, http.MethodGet, "/ie/delete?path="+url.QueryEscape(last)+"&page=2", "", true)
	if confirmBody := html.UnescapeString(confirm.Body.String()); !strings.Contains(confirmBody, "page=2") {
		t.Fatalf("确认页应当把页码带下去：%s", confirmBody)
	}

	renamed := ieCall(t, e, http.MethodPost,
		"/ie/rename?path="+url.QueryEscape(last)+"&page=2", "csrf=sess&name=f500-renamed.txt", true)
	if location := renamed.Header().Get("Location"); !strings.Contains(location, "page=2") {
		t.Fatalf("改名后应当回到第 2 页，得到 %q", location)
	}
	if _, err := os.Stat(filepath.Join(dir, "f500-renamed.txt")); err != nil {
		t.Fatalf("改名没生效：%v", err)
	}

	// 把改名后的那个条目删掉：501 → 500 条，第 2 页随之消失。
	renamedPath := filepath.Join(slash, "f500-renamed.txt")
	deleted := ieCall(t, e, http.MethodPost, "/ie/delete?path="+url.QueryEscape(renamedPath)+"&page=2", "csrf=sess", true)
	if location := deleted.Header().Get("Location"); !strings.Contains(location, "page=2") {
		t.Fatalf("删除后应当回到第 2 页，得到 %q", location)
	}
	if _, err := os.Stat(filepath.Join(dir, "f500-renamed.txt")); !os.IsNotExist(err) {
		t.Error("文件没删掉")
	}

	// 第 2 页被删空之后：跳回干净的第 1 页（地址栏不留一个不存在的页码），
	// 而不是渲染一个空表格。
	empty := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(slash)+"&page=2", "", true)
	if location := empty.Header().Get("Location"); empty.Code != http.StatusFound || strings.Contains(location, "page=") {
		t.Fatalf("页码越界应当跳回第 1 页，得到 %d %q", empty.Code, location)
	}

	// 手输一个离谱的页码也一样，而且带上来的 notice 不能丢。
	over := ieCall(t, e, http.MethodGet,
		"/ie/browse?path="+url.QueryEscape(slash)+"&page=99&notice=hello", "", true)
	overLocation := over.Header().Get("Location")
	if over.Code != http.StatusFound || strings.Contains(overLocation, "page=") || !strings.Contains(overLocation, "notice=hello") {
		t.Fatalf("越界跳转应当丢掉页码、留住 notice，得到 %d %q", over.Code, overLocation)
	}

	// 跳过去之后落在第 1 页，内容正常。
	landed := ieCall(t, e, http.MethodGet, overLocation, "", true)
	if body := landed.Body.String(); !strings.Contains(body, "f000.txt") || !strings.Contains(body, "500 shown") {
		t.Fatalf("跳转后的第 1 页应当正常渲染：%s", body)
	}

	// 上传 / 新建也沿用它：第 1 页不带页码后缀。
	one := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(slash), "", true)
	if strings.Contains(one.Body.String(), "&amp;page=") {
		t.Error("第 1 页不该出现页码后缀")
	}
}

func TestIEIsRoot(t *testing.T) {
	drives := []types.Drive{{Path: "/", Label: "/"}, {Path: "/home/user", Label: "Home"}}
	for _, p := range []string{"/", "//host/share", "/home/user"} {
		if !ieIsRoot(p, drives) {
			t.Errorf("%s 应当算位置根", p)
		}
	}
	for _, p := range []string{"/tmp", "/home/user/docs"} {
		if ieIsRoot(p, drives) {
			t.Errorf("%s 不该算位置根", p)
		}
	}
}

// 打印出来的登录链接落在根路径上，SPA 需要 JS；这里验证服务端的兜底。
func TestTicketLoginMiddleware(t *testing.T) {
	newServer := func() *echo.Echo {
		e := withAPIErrorHandler(echo.New())
		RegisterTicketLogin(e)
		// 模拟静态资源回落：任意方法都回一份 index.html。
		e.Any("/", func(c echo.Context) error { return c.String(http.StatusOK, "spa") })
		return e
	}
	call := func(e *echo.Echo, method, target, userAgent string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, nil)
		if userAgent != "" {
			req.Header.Set("User-Agent", userAgent)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}
	ticketURL := func(t *testing.T) string {
		t.Helper()
		ticket, err := config.NewAuthTicket()
		if err != nil {
			t.Fatal(err)
		}
		return "/?ticket=" + url.QueryEscape(ticket.Value)
	}

	const ie8 = "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1; Trident/4.0)"
	const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"

	// 老 IE：SPA 跑不起来，直接送进经典界面。
	legacy := call(newServer(), http.MethodGet, ticketURL(t), ie8)
	if legacy.Code != http.StatusFound || legacy.Header().Get("Location") != "/ie" {
		t.Fatalf("IE 票据登录 = %d %q，期望 302 /ie", legacy.Code, legacy.Header().Get("Location"))
	}
	if !strings.Contains(strings.Join(legacy.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName) {
		t.Fatal("IE 票据登录没有设置 cookie")
	}

	// 现代浏览器：回干净的根路径，SPA 照常启动。
	modern := call(newServer(), http.MethodGet, ticketURL(t), chrome)
	if modern.Code != http.StatusFound || modern.Header().Get("Location") != "/" {
		t.Fatalf("现代浏览器票据登录 = %d %q，期望 302 /", modern.Code, modern.Header().Get("Location"))
	}

	// 无效票据：原样放行，交给 SPA 自己报错。
	passthrough := call(newServer(), http.MethodGet, "/?ticket=nope", chrome)
	if passthrough.Code != http.StatusOK || passthrough.Body.String() != "spa" {
		t.Fatalf("无效票据应当放行 = %d %q", passthrough.Code, passthrough.Body.String())
	}

	// 只有 GET 消费票据。
	posted := call(newServer(), http.MethodPost, ticketURL(t), chrome)
	if posted.Code != http.StatusOK || posted.Body.String() != "spa" {
		t.Fatalf("POST 不该被票据中间件拦下 = %d %q", posted.Code, posted.Body.String())
	}
}

func TestIEClassicLoginLogout(t *testing.T) {
	e := newIEServer()

	// 一次性票据登录：成功即设置 cookie 并跳到列表。
	ticket, err := config.NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}
	ok := ieCall(t, e, http.MethodPost, "/ie/login", "ticket="+url.QueryEscape(ticket.Value)+"&next=/ie", false)
	if ok.Code != http.StatusFound {
		t.Fatalf("票据登录 = %d：%s", ok.Code, ok.Body.String())
	}
	if !strings.Contains(strings.Join(ok.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName) {
		t.Fatalf("登录成功必须设置鉴权 cookie：%v", ok.Header().Values("Set-Cookie"))
	}

	// 密码错误：401 + 明确文案，且不设置任何 cookie。
	bad := ieCall(t, e, http.MethodPost, "/ie/login", "password=definitely-not-it", false)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码 = %d，期望 401", bad.Code)
	}
	if !strings.Contains(bad.Body.String(), "Unauthorized") {
		t.Fatalf("错误密码应重绘表单并带原因：%s", bad.Body.String())
	}
	if len(bad.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("登录失败不该设置 cookie：%v", bad.Header().Values("Set-Cookie"))
	}

	// 登出：CSRF 不对拒绝，对了清 cookie 并跳回登录页。
	forbidden := ieCall(t, e, http.MethodPost, "/ie/logout", "csrf=wrong", true)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("登出 CSRF 不匹配 = %d，期望 403", forbidden.Code)
	}
	logout := ieCall(t, e, http.MethodPost, "/ie/logout", "csrf=sess", true)
	if logout.Code != http.StatusFound || logout.Header().Get("Location") != "/ie/login" {
		t.Fatalf("登出 = %d %q", logout.Code, logout.Header().Get("Location"))
	}
	if !strings.Contains(strings.Join(logout.Header().Values("Set-Cookie"), "\n"), middlewares.AuthCookieName+"=") {
		t.Fatalf("登出必须清掉鉴权 cookie：%v", logout.Header().Values("Set-Cookie"))
	}
}

func TestIEClassicBrowseAndDownload(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "visible.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	// 默认显示隐藏文件：经典界面不过滤，也不需要任何参数。
	if err := os.WriteFile(filepath.Join(dir, ".hidden.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	slash := filepath.ToSlash(dir)

	e := newIEServer()
	page := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(slash), "", true)
	if page.Code != http.StatusOK {
		t.Fatalf("浏览 = %d：%s", page.Code, page.Body.String())
	}
	body := page.Body.String()
	for _, want := range []string{"visible.txt", ".hidden.txt", "sub/", "/ie/download?path=", "Drives", "Favourites", ">Top</a>"} {
		if !strings.Contains(body, want) {
			t.Errorf("页面里缺少 %q", want)
		}
	}
	// 目录排在同级文件之前（服务端排序）。
	if strings.Index(body, "sub/") > strings.Index(body, "visible.txt") {
		t.Error("目录应当排在文件前面")
	}

	file := filepath.Join(dir, "visible.txt")
	download := ieCall(t, e, http.MethodGet, "/ie/download?path="+url.QueryEscape(filepath.ToSlash(file)), "", true)
	if download.Code != http.StatusOK {
		t.Fatalf("下载 = %d：%s", download.Code, download.Body.String())
	}
	if got := download.Body.String(); got != "hello" {
		t.Fatalf("下载内容 = %q", got)
	}
	if disposition := download.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, "attachment") {
		t.Fatalf("下载必须带附件头，得到 %q", disposition)
	}
}

// 越界路径在经典界面里也是 HTML 错误页，而不是 JSON。
func TestIEClassicOutsideRootsIsHTML(t *testing.T) {
	base := t.TempDir()
	withBases(t, base)
	e := newIEServer()

	outside := filepath.ToSlash(filepath.Dir(base))
	rec := ieCall(t, e, http.MethodGet, "/ie/browse?path="+url.QueryEscape(outside), "", true)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("越界浏览 = %d，期望 403", rec.Code)
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("错误页 Content-Type = %q", contentType)
	}
	if !strings.Contains(rec.Body.String(), "outside the configured allowed roots") {
		t.Fatalf("错误页应当说明边界：%s", rec.Body.String())
	}
}

func TestIESizeAndTimeHelpers(t *testing.T) {
	size := int64(2048)
	if got := ieSize(&size); got != "2.0 KB" {
		t.Errorf("ieSize = %q", got)
	}
	if got := ieSize(nil); got != "" {
		t.Errorf("目录没有大小，得到 %q", got)
	}
	if got := ieTime(0); got != "" {
		t.Errorf("零时间戳应当是空，得到 %q", got)
	}
}

func TestIEParentStopsAtRoot(t *testing.T) {
	if got := ieParent("/", nil); got != "" {
		t.Errorf("/ 没有上一级，得到 %q", got)
	}
	if got := ieParent("//host/share", nil); got != "" {
		t.Errorf("UNC 共享根没有上一级，得到 %q", got)
	}
	if got := ieParent("/tmp/a", nil); got != "/tmp" {
		t.Errorf("/tmp/a 的上一级应当是 /tmp，得到 %q", got)
	}
	// 枚举出来的位置根也是停点：主目录本身不该再往上走。
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		root := filepath.ToSlash(home)
		if got := ieParent(root+"/child", []types.Drive{{Path: root}}); got != "" {
			t.Errorf("位置根之下应当停住，得到 %q", got)
		}
	}
}
