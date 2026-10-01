package routes

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/types"
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
		token, err := config.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: middlewares.AuthCookieName, Value: token})
		req.AddCookie(&http.Cookie{Name: middlewares.SessionCookieName, Value: "sess"})
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
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
