package routes

import (
	"embed"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/types"
	"file-lite-go/utils"
)

// 经典界面：给 IE8 这类没有 JS 的浏览器用的纯 HTML 版本。
//
// 只有登录 / 登出 / 浏览 / 下载，全部靠表单和链接，没有一行 JS、没有预览。
// 它挂在 /ie 下，与 /api 的 JSON 接口、SPA 的静态资源并存，共用一个会话 cookie。
// 见 docs/design/api.md §15。

//go:embed ie_templates/*.html
var ieTemplatesFS embed.FS

var ieTemplates = template.Must(template.ParseFS(ieTemplatesFS, "ie_templates/*.html"))

// iePageSize 是每页条目数：老浏览器排十万行的表格会直接卡死，翻页链接便宜得多。
const iePageSize = 500

// 收藏与前端 LsKeys.STARED_PATH 是同一个键（frontend/src/enum/index.ts），
// 所以两边看到的是同一份收藏。
const ieStaredPathKey = "file_lite_stared_path"

// RegisterIE 在根路径下挂载经典界面。
func RegisterIE(e *echo.Echo) {
	g := e.Group("/ie")
	g.GET("", ieIndex)
	g.GET("/login", ieLoginPage)
	g.POST("/login", ieLoginSubmit, middlewares.LoginRateLimiter())
	g.POST("/logout", ieLogout)
	g.GET("/browse", ieBrowse, ieRequireAuth)
	g.GET("/download", ieDownload, ieRequireAuth)
}

func ieIndex(c echo.Context) error {
	if !ieAuthenticated(c) {
		return c.Redirect(http.StatusFound, "/ie/login")
	}
	if drives := visibleDrives(); len(drives) > 0 {
		return c.Redirect(http.StatusFound, ieBrowseURL(drives[0].Path, 1))
	}
	return ieFail(c, http.StatusNotFound, "No drives")
}

func ieLoginPage(c echo.Context) error {
	if ieAuthenticated(c) {
		return c.Redirect(http.StatusFound, "/ie")
	}
	return ieRender(c, http.StatusOK, "login.html", ieLoginView{
		Next:   ieSafeNext(c.QueryParam("next")),
		Ticket: c.QueryParam("ticket"),
	})
}

func ieLoginSubmit(c echo.Context) error {
	next := ieSafeNext(c.FormValue("next"))
	token, apiErr := authenticate(c, c.FormValue("password"), c.FormValue("ticket"))
	if apiErr != nil {
		return ieRender(c, apiErr.Status, "login.html", ieLoginView{
			Next:   next,
			Ticket: c.FormValue("ticket"),
			Error:  apiErr.Message,
		})
	}
	if err := middlewares.SetAuthCookies(c, token, c.FormValue("remember") != ""); err != nil {
		return ieFail(c, http.StatusInternalServerError, "Failed")
	}
	return c.Redirect(http.StatusFound, next)
}

func ieLogout(c echo.Context) error {
	// 与 JSON 的 logout 同一套语义：没有会话 cookie 也允许登出（过期的凭据也要能清掉），
	// 有就要求双提交——表单只能用隐藏字段，不能用 X-File-Lite-CSRF 头。
	if session, err := c.Cookie(middlewares.SessionCookieName); err == nil && session.Value != "" {
		if c.FormValue("csrf") != session.Value {
			return ieFail(c, http.StatusForbidden, "Forbidden")
		}
	}
	middlewares.ClearAuthCookies(c)
	return c.Redirect(http.StatusFound, "/ie/login")
}

func ieBrowse(c echo.Context) error {
	raw := c.QueryParam("path")
	if raw == "" {
		return c.Redirect(http.StatusFound, "/ie")
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	entries, err := readDirEntries(res, res.OSPath())
	if err != nil {
		return ieError(c, fsError(err, res.Network()))
	}

	// 经典界面没有客户端排序：目录在前、名字升序，在服务端排好再切页。
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].IsDirectory != entries[j].IsDirectory {
			return entries[i].IsDirectory
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	page := iePageParam(c)
	start := (page - 1) * iePageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := start + iePageSize
	if end > len(entries) {
		end = len(entries)
	}

	drives := visibleDrives()
	view := ieBrowseView{
		Path:       res.Path,
		CSRF:       ieCSRF(c),
		Drives:     drives,
		Favourites: ieFavourites(),
		Parent:     ieParent(res.Path, drives),
	}
	for _, entry := range entries[start:end] {
		view.Entries = append(view.Entries, ieEntryView{
			Name:  entry.Name,
			Path:  entry.Path,
			IsDir: entry.IsDirectory,
			Size:  ieSize(entry.Size),
			Time:  ieTime(entry.LastModified),
		})
	}
	if page > 1 {
		view.PrevURL = ieBrowseURL(res.Path, page-1)
	}
	if end < len(entries) {
		view.NextURL = ieBrowseURL(res.Path, page+1)
	}
	if len(entries) > iePageSize {
		view.PageInfo = fmt.Sprintf("page %d/%d, %d entries", page, (len(entries)+iePageSize-1)/iePageSize, len(entries))
	}
	return ieRender(c, http.StatusOK, "browse.html", view)
}

func ieDownload(c echo.Context) error {
	res, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	if err := serveFileContent(c, res, true); err != nil {
		// 目录、读不到之类的失败在响应发出前转成 HTML 错误页；已经开始写字节就原样返回。
		if apiErr, ok := err.(*apierr.Error); ok && !c.Response().Committed {
			return ieError(c, apiErr)
		}
		return err
	}
	return nil
}

// ---- 视图数据（字段必须导出，模板才能取） ----

type ieLoginView struct {
	Next   string
	Ticket string
	Error  string
}

type ieErrorView struct {
	Status  int
	Message string
}

type ieEntryView struct {
	Name  string
	Path  string
	IsDir bool
	Size  string
	Time  string
}

type ieBrowseView struct {
	Path       string
	CSRF       string
	Drives     []types.Drive
	Favourites []string
	Parent     string
	Entries    []ieEntryView
	PrevURL    string
	NextURL    string
	PageInfo   string
}

// ---- 辅助 ----

func ieAuthenticated(c echo.Context) bool {
	// 浏览器带着 HttpOnly 的鉴权 cookie；Authorization 头留给脚本。
	if cookie, err := c.Cookie(middlewares.AuthCookieName); err == nil && cookie.Value != "" {
		return config.VerifyAuthJWT(cookie.Value)
	}
	token := c.Request().Header.Get("Authorization")
	return token != "" && config.VerifyAuthJWT(token)
}

func ieRequireAuth(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !ieAuthenticated(c) {
			return c.Redirect(http.StatusFound,
				"/ie/login?next="+url.QueryEscape(c.Request().URL.RequestURI()))
		}
		return next(c)
	}
}

// ieSafeNext 只接受站内 /ie 路径：next 会被回显进表单，不校验就是开放重定向。
func ieSafeNext(next string) string {
	if !strings.HasPrefix(next, "/ie") {
		return "/ie"
	}
	return next
}

func ieCSRF(c echo.Context) string {
	if session, err := c.Cookie(middlewares.SessionCookieName); err == nil {
		return session.Value
	}
	return ""
}

func ieRender(c echo.Context, status int, name string, data any) error {
	c.Response().Header().Set(echo.HeaderContentType, "text/html; charset=utf-8")
	c.Response().WriteHeader(status)
	return ieTemplates.ExecuteTemplate(c.Response(), name, data)
}

func ieError(c echo.Context, apiErr *apierr.Error) error {
	return ieFail(c, apiErr.Status, apiErr.Message)
}

func ieFail(c echo.Context, status int, message string) error {
	return ieRender(c, status, "error.html", ieErrorView{Status: status, Message: message})
}

func iePageParam(c echo.Context) int {
	page, err := strconv.Atoi(c.QueryParam("page"))
	if err != nil || page < 1 {
		return 1
	}
	return page
}

func ieBrowseURL(path string, page int) string {
	out := "/ie/browse?path=" + url.QueryEscape(path)
	if page > 1 {
		out += "&page=" + strconv.Itoa(page)
	}
	return out
}

// ieParent 返回上一级；已经是位置根就返回空（模板据此不显示 Up）。
func ieParent(p string, drives []types.Drive) string {
	parent := fileops.DirName(p)
	// "C:/Users" 的父级是 "C:"（canonical 的盘符根写法），补上斜杠才是可浏览的根。
	if strings.HasSuffix(parent, ":") {
		parent += "/"
	}
	// 语法根、UNC 的主机名（"//host" 不是一个能浏览的位置）。
	if parent == "" || parent == p || (strings.HasPrefix(parent, "//") && strings.Count(parent, "/") == 2) {
		return ""
	}
	for _, drive := range drives {
		if parent == drive.Path {
			return ""
		}
	}
	return parent
}

// ieFavourites 读服务端设置里的收藏列表（前端写在 file_lite_stared_path）。
func ieFavourites() []string {
	value, err := utils.GetSettingsValue(ieStaredPathKey)
	if err != nil {
		return nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if path, ok := item.(string); ok && path != "" {
			out = append(out, path)
		}
	}
	return out
}

func ieSize(size *int64) string {
	if size == nil {
		return ""
	}
	switch n := *size; {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

func ieTime(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).Format("2006-01-02 15:04")
}
