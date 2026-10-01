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
	for _, want := range []string{"visible.txt", ".hidden.txt", "sub/", "/ie/download?path=", "Drives", "Favourites", "[Top]"} {
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
