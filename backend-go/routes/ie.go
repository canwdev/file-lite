package routes

import (
	"embed"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
	"golang.org/x/text/encoding/simplifiedchinese"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/middlewares"
	"file-lite-go/types"
	"file-lite-go/utils"
)

// 经典界面：给 IE8 这类老浏览器用的 HTML 版本。
//
// 只有登录 / 登出 / 浏览 / 下载，靠表单与链接完成；JS 只用在登录页切换两种登录方式，
// 关掉 JS 其余功能照常可用（降级为两条输入框都显示，由 radio 的值决定用哪一个）。
// 没有预览。它挂在 /ie 下，与 /api 的 JSON 接口、SPA 的静态资源并存，共用一个会话 cookie。
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
	g.POST("/upload", ieUpload, ieRequireAuth)
	g.POST("/mkdir", ieMkdir, ieRequireAuth)
	g.GET("/rename", ieRenamePage, ieRequireAuth)
	g.POST("/rename", ieRename, ieRequireAuth)
	g.GET("/delete", ieDeletePage, ieRequireAuth)
	g.POST("/delete", ieDelete, ieRequireAuth)
}

func ieIndex(c echo.Context) error {
	if handled, err := ieTicketLogin(c); handled || err != nil {
		return err
	}
	if !ieAuthenticated(c) {
		target := "/ie/login"
		// 票据没换成会话就带着它去登录页：那里会选中票据那一栏并说明原因。
		if ticket := c.QueryParam("ticket"); ticket != "" {
			target += "?ticket=" + url.QueryEscape(ticket)
		}
		return c.Redirect(http.StatusFound, target)
	}
	if drives := visibleDrives(); len(drives) > 0 {
		return c.Redirect(http.StatusFound, ieBrowseURL(drives[0].Path, 1))
	}
	return ieFail(c, http.StatusNotFound, "No drives")
}

// ieTicketLogin 处理 ?ticket=：票据本身就是一次性的登录凭据，GET 直接换会话并跳转，
// 这样把打印出来的登录链接粘进 IE 就能直接进来，不必先看表单再点一次 Sign in。
//
// 无效 / 过期的票据返回 false，由调用方决定怎么说明（登录页会选中票据栏并回填）。
func ieTicketLogin(c echo.Context) (bool, error) {
	ticket := c.QueryParam("ticket")
	if ticket == "" {
		return false, nil
	}
	token, ok := config.ConsumeAuthTicket(ticket)
	if !ok {
		return false, nil
	}
	// 票据是发给「另一台设备」的，默认记住；与前端 rememberAuth 的缺省值一致。
	if err := middlewares.SetAuthCookies(c, token, true); err != nil {
		return false, err
	}
	return true, c.Redirect(http.StatusFound, "/ie")
}

func ieLoginPage(c echo.Context) error {
	if handled, err := ieTicketLogin(c); handled || err != nil {
		return err
	}
	if ieAuthenticated(c) {
		return c.Redirect(http.StatusFound, "/ie")
	}
	next := ieSafeNext(c.QueryParam("next"))
	ticket := c.QueryParam("ticket")
	if ticket == "" {
		return ieLoginForm(c, http.StatusOK, next, "", "", "password")
	}
	// 链接里的票据没换成会话：多半过期了，或者被更新的票据顶掉了。
	return ieLoginForm(c, http.StatusOK, next,
		"This login link has expired. Enter the ticket again, or sign in with the password.",
		ticket, "ticket")
}

func ieLoginSubmit(c echo.Context) error {
	next := ieSafeNext(c.FormValue("next"))
	mode := c.FormValue("mode")
	password := c.FormValue("password")
	ticket := c.FormValue("ticket")
	// 没有 mode 的提交（脚本、书签、老书签）：谁填了就用谁。
	if mode != "password" && mode != "ticket" {
		if ticket != "" {
			mode = "ticket"
		} else {
			mode = "password"
		}
	}

	var (
		token  string
		apiErr *apierr.Error
	)
	switch mode {
	case "ticket":
		if ticket == "" {
			// 空字段是「没填完」，不是一次凭据尝试：400 不计入失败封禁。
			return ieLoginForm(c, http.StatusBadRequest, next, "Enter the ticket.", "", "ticket")
		}
		// radio 是权威：选了票据就不看密码字段，反之亦然。
		token, apiErr = authenticate(c, "", ticket)
	default:
		if password == "" {
			return ieLoginForm(c, http.StatusBadRequest, next, "Enter the password.", "", "password")
		}
		token, apiErr = authenticate(c, password, "")
	}
	if apiErr != nil {
		return ieLoginForm(c, apiErr.Status, next, apiErr.Message, ticket, mode)
	}
	if err := middlewares.SetAuthCookies(c, token, c.FormValue("remember") != ""); err != nil {
		return ieFail(c, http.StatusInternalServerError, "Failed")
	}
	return c.Redirect(http.StatusFound, next)
}

// ieLoginForm 渲染登录表单。mode 决定哪个 radio 选中，ticket 用于票据登录失败后回填
// （8 位票据手打容易错，让用户能改而不是重来）。
func ieLoginForm(c echo.Context, status int, next, errMsg, ticket, mode string) error {
	return ieRender(c, status, "login.html", ieLoginView{
		Next:   next,
		Error:  errMsg,
		Ticket: ticket,
		Mode:   mode,
	})
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
		Path:   res.Path,
		CSRF:   ieCSRF(c),
		Parent: ieParent(res.Path, drives),
		Notice: ieNotice(c),
	}
	for _, drive := range drives {
		view.Drives = append(view.Drives, ieLink{Path: drive.Path, Label: fileops.BaseName(drive.Path)})
	}
	for _, favourite := range ieFavourites() {
		view.Favourites = append(view.Favourites, ieLink{Path: favourite, Label: fileops.BaseName(favourite)})
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

// ieUpload 收下经典界面的上传（POST /ie/upload?path=<目录>）。
//
// 表单里只有一个 file 输入框，带 multiple：支持的浏览器一次能选多个，IE8 之类不认识
// multiple 的会把属性忽略掉，同一个框照常一次传一个文件——两边共用这一条路径。
//
// 目标目录走 query 而不是隐藏字段，原因和 CSRF 有关：multipart 请求上用
// c.FormValue / c.MultipartForm 会先把**每个文件**落到临时文件再拷一次（双写，
// 大文件在临时目录小的机器上直接失败），所以这里自己拿 MultipartReader 顺序读 part。
// 于是普通字段必须在文件之前到达：csrf 排在表单最前面，文件先到就直接拒绝，不猜。
//
// 同名策略默认「跳过并回报」，同时认 ?onConflict=overwrite / keep-both，与 REST 一致。
func ieUpload(c echo.Context) error {
	dir, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	if st, err := os.Stat(dir.OSPath()); err != nil || !st.IsDir() {
		return ieFail(c, http.StatusBadRequest, "Not a directory")
	}

	reader, err := c.Request().MultipartReader()
	if err != nil {
		return ieFail(c, http.StatusBadRequest, "Expected a multipart/form-data upload")
	}

	onConflict := c.QueryParam("onConflict")
	csrfOK := false
	stats := &ieUploadStats{}
	changes := &listingChangeSet{}
	defer changes.broadcast()

	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return ieFail(c, http.StatusBadRequest, "Malformed upload")
		}

		// 没有文件名的 part 是普通字段（csrf，以及浏览器可能捎带的空文件框）。
		if part.FileName() == "" {
			if part.FormName() == "csrf" {
				value, readErr := io.ReadAll(io.LimitReader(part, 256))
				_ = part.Close()
				if readErr != nil {
					return ieFail(c, http.StatusBadRequest, "Malformed upload")
				}
				if string(value) != ieCSRF(c) {
					return ieFail(c, http.StatusForbidden, "Forbidden")
				}
				csrfOK = true
				continue
			}
			_ = part.Close()
			continue
		}
		if !csrfOK {
			// 文件排在 csrf 之前：宁可不收，也不写一个没校验过的字节。
			_ = part.Close()
			return ieFail(c, http.StatusForbidden, "Forbidden")
		}

		// 先解码再取末段：GBK 的双字节字符第二字节可能是 0x5C（反斜杠），
		// 在原始字节上切分会把一个汉字切成两半。
		name, nameErr := sanitizeUploadFilename(fileops.BaseName(decodeUploadFilename(part.FileName())))
		if nameErr != nil || utils.IsReservedTempName(name) {
			_ = part.Close()
			stats.addRejected(name, "invalid name")
			continue
		}

		destPath := canonicalChild(dir.Path, name)
		destOS := filepath.FromSlash(destPath)
		existed := false
		if st, statErr := os.Stat(destOS); statErr == nil {
			if st.IsDir() {
				_ = part.Close()
				stats.addRejected(name, "is a directory")
				continue
			}
			existed = true
		}
		switch {
		case !existed:
		case onConflict == "keep-both":
			destPath = fileops.UniquePath(destPath)
			destOS = filepath.FromSlash(destPath)
		case onConflict == "overwrite":
		default:
			_ = part.Close()
			stats.addSkipped(name)
			continue
		}

		// 与 REST 的 PUT 一样：内容直接流进 PublishFile 的临时文件再原子改名，
		// 中断的上传不会在目标目录留下半个文件。
		writeErr := fileops.PublishFile(destOS, fileops.PublishOptions{
			Mode:          0644,
			NetworkTarget: dir.Network(),
		}, func(w io.Writer) error {
			_, copyErr := io.Copy(w, part)
			return copyErr
		})
		_ = part.Close()
		if writeErr != nil {
			stats.addRejected(name, "write failed")
			continue
		}

		stats.uploaded++
		changes.add(canonicalChild(dir.Path, fileops.BaseName(destPath)))
	}

	// PRG：刷新不会重传，IE8 那个「是否重新提交表单？」也不会弹出来。
	return ieBackTo(c, dir.Path, stats.notice())
}

// ieMkdir 新建文件夹。表单只有 csrf 与 name，读普通字段就够了——不像上传那样要绕开
// multipart 的临时文件。目录的创建与广播复用 JSON 接口那一份（createDirectory）。
func ieMkdir(c echo.Context) error {
	dir, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	if !ieCheckCSRF(c) {
		return ieFail(c, http.StatusForbidden, "Forbidden")
	}
	name, nameErr := sanitizeUploadFilename(c.FormValue("name"))
	if nameErr != nil || utils.IsReservedTempName(name) {
		return ieBackTo(c, dir.Path, "Invalid folder name")
	}
	res, apiErr := resolvePath(canonicalChild(dir.Path, name))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	if isExist(res.OSPath()) {
		return ieBackTo(c, dir.Path, name+" already exists")
	}
	if err := createDirectory(res); err != nil {
		return ieBackTo(c, dir.Path, "Could not create "+name+": "+err.Error())
	}
	return ieBackTo(c, dir.Path, "Created folder "+name)
}

// ieRenamePage 渲染改名对话框。GET 不写任何东西，所以列表里的链接点错了也没有代价。
func ieRenamePage(c echo.Context) error {
	res, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	name := fileops.BaseName(res.Path)
	return ieRender(c, http.StatusOK, "dialog.html", ieDialogView{
		Title:      "Rename",
		Action:     "/ie/rename?path=" + url.QueryEscape(res.Path),
		CSRF:       ieCSRF(c),
		Message:    "Rename " + name + ":",
		FieldLabel: "New name:",
		Field:      name,
		Submit:     "Rename",
		Cancel:     ieBrowseURL(fileops.DirName(res.Path), 1),
	})
}

func ieRename(c echo.Context) error {
	res, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	dir := fileops.DirName(res.Path)
	oldName := fileops.BaseName(res.Path)
	if !ieCheckCSRF(c) {
		return ieFail(c, http.StatusForbidden, "Forbidden")
	}
	newPath, apiErr := renameEntry(res, c.FormValue("name"))
	if apiErr != nil {
		return ieBackTo(c, dir, oldName+": "+apiErr.Message)
	}
	if newPath == res.Path {
		return ieBackTo(c, dir, "Name unchanged")
	}
	return ieBackTo(c, dir, "Renamed "+oldName+" to "+fileops.BaseName(newPath))
}

// ieDeletePage 是删除的确认页：真正动手的是 POST，所以列表里那个链接（GET）永远
// 删不掉东西——确认这一步在无 JS 的浏览器上也成立。
func ieDeletePage(c echo.Context) error {
	res, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	name := fileops.BaseName(res.Path)
	message := "Delete " + name + "? This cannot be undone."
	if st, err := os.Stat(res.OSPath()); err == nil && st.IsDir() {
		message = "Delete folder " + name + " and everything inside it? This cannot be undone."
	}
	return ieRender(c, http.StatusOK, "dialog.html", ieDialogView{
		Title:   "Delete",
		Action:  "/ie/delete?path=" + url.QueryEscape(res.Path),
		CSRF:    ieCSRF(c),
		Message: message,
		Submit:  "Delete",
		Cancel:  ieBrowseURL(fileops.DirName(res.Path), 1),
	})
}

func ieDelete(c echo.Context) error {
	res, apiErr := resolvePath(c.QueryParam("path"))
	if apiErr != nil {
		return ieError(c, apiErr)
	}
	dir := fileops.DirName(res.Path)
	name := fileops.BaseName(res.Path)
	if !ieCheckCSRF(c) {
		return ieFail(c, http.StatusForbidden, "Forbidden")
	}
	if ieIsRoot(res.Path, visibleDrives()) {
		// 位置根不给删：那等于把整个界面拆了，而且经典界面没有任何恢复手段。
		return ieBackTo(c, dir, "Refusing to delete "+name)
	}
	// 与任务队列同一个删除实现：链接与硬链接只删自己，不跟着递归。
	if err := fileops.RemoveEntry(res.OSPath()); err != nil {
		return ieBackTo(c, dir, "Could not delete "+name+": "+err.Error())
	}
	changes := &listingChangeSet{}
	changes.remove(dir, name)
	changes.broadcast()
	return ieBackTo(c, dir, "Deleted "+name)
}

// ieIsRoot 判断这是不是一个「位置根」：语法根（"/"、"//host/share"）或枚举出来的
// 位置（Home、盘符、挂载点）。这些在经典界面里是导航的支点，不给删。
func ieIsRoot(p string, drives []types.Drive) bool {
	if fileops.DirName(p) == p {
		return true
	}
	for _, drive := range drives {
		if drive.Path == p {
			return true
		}
	}
	return false
}

// ieUploadStats 汇总一次上传，转成状态栏里的一行话。
type ieUploadStats struct {
	uploaded int
	skipped  []string
	rejected []string
}

// addSkipped 记一个「目标已存在、按策略没动」的文件。
func (s *ieUploadStats) addSkipped(name string) { s.skipped = append(s.skipped, name) }

// addRejected 记一个没写成的文件（名字非法、目标是目录、写入失败）。
func (s *ieUploadStats) addRejected(name, reason string) {
	s.rejected = append(s.rejected, name+" ("+reason+")")
}

func (s *ieUploadStats) notice() string {
	parts := []string{fmt.Sprintf("Uploaded %d file(s)", s.uploaded)}
	if len(s.skipped) > 0 {
		parts = append(parts, fmt.Sprintf("skipped %d already there: %s", len(s.skipped), strings.Join(head(s.skipped, 3), ", ")))
	}
	if len(s.rejected) > 0 {
		parts = append(parts, fmt.Sprintf("failed %d: %s", len(s.rejected), strings.Join(head(s.rejected, 3), ", ")))
	}
	return strings.Join(parts, "; ")
}

// head 只取前 n 项：状态栏是给人扫一眼的，堆二十个名字反而看不见重点。
func head(items []string, n int) []string {
	if len(items) > n {
		return items[:n]
	}
	return items
}

// decodeUploadFilename 把老浏览器发来的文件名转成 UTF-8。
//
// IE 一直按系统 ANSI 代码页发 filename（中文 Windows 是 GBK），Go 拿到的是非法 UTF-8
// 字节串，直接落盘就是乱码名字。能按 GBK 解就解，解不了再退回替换非法字节。
// golang.org/x/text 本来就在依赖里（间接依赖），不需要新模块。
func decodeUploadFilename(name string) string {
	if utf8.ValidString(name) {
		return name
	}
	if decoded, err := simplifiedchinese.GBK.NewDecoder().String(name); err == nil {
		return decoded
	}
	return strings.ToValidUTF8(name, "_")
}

// RegisterTicketLogin 让打印出来的登录链接在经典界面里直接可用。
//
// SPA 在路由守卫里消费 ?ticket=，那条路需要 JS。这里在静态资源中间件**之前**拦下
// 根路径上带有效票据的 GET：换成会话 cookie，然后按 User-Agent 选落点——老 IE 进
// 经典界面（SPA 在 IE 上跑不起来），其它浏览器回干净的根路径。票据无效就原样放行，
// 交给 SPA 自己处理（它的提示更完整）。
//
// 必须在注册静态资源中间件之前调用，否则 HTML5 回落会先回一份 index.html。
func RegisterTicketLogin(e *echo.Echo) {
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Request().Method != http.MethodGet || c.Request().URL.Path != "/" {
				return next(c)
			}
			ticket := c.QueryParam("ticket")
			if ticket == "" {
				return next(c)
			}
			token, ok := config.ConsumeAuthTicket(ticket)
			if !ok {
				return next(c)
			}
			if err := middlewares.SetAuthCookies(c, token, true); err != nil {
				return next(c)
			}
			if isLegacyBrowser(c.Request().UserAgent()) {
				return c.Redirect(http.StatusFound, "/ie")
			}
			return c.Redirect(http.StatusFound, "/")
		}
	})
}

// isLegacyBrowser 判断这是不是跑不动 SPA 的老浏览器。
// IE 6-10 都带 "MSIE "，IE 11 只带 "Trident/"；Edge 与其它浏览器两者都没有。
func isLegacyBrowser(userAgent string) bool {
	return strings.Contains(userAgent, "MSIE ") || strings.Contains(userAgent, "Trident/")
}

// ---- 视图数据（字段必须导出，模板才能取） ----

// ieLoginView 是登录表单的数据。Mode 决定哪个 radio 选中（password / ticket），
// Ticket 用于票据那一栏的回填。
type ieLoginView struct {
	Next   string
	Error  string
	Ticket string
	Mode   string
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

// ieLink 是侧栏里的一项：链接指向完整 Path，显示的 Label 只取最后一段（完整路径放在
// title 里，鼠标悬停还能看到；根路径没有最后一段，fileops.BaseName 会退回 "/" 或 "C:"）。
type ieLink struct {
	Path  string
	Label string
}

// ieDialogView 是改名 / 删除确认这种「一问一答」页面的数据。
type ieDialogView struct {
	Title   string
	Action  string
	CSRF    string
	Message string
	// Field 非空时多给一行输入框（改名用；删除确认只有一句话和两个按钮）。
	FieldLabel string
	Field      string
	Submit     string
	Cancel     string
}

type ieBrowseView struct {
	Path       string
	CSRF       string
	Drives     []ieLink
	Favourites []ieLink
	Parent     string
	Entries    []ieEntryView
	PrevURL    string
	NextURL    string
	PageInfo   string
	Notice     string
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

// ieCheckCSRF 写操作的隐藏字段双提交：表单设不了 X-File-Lite-CSRF 头，所以比的是
// 会话 cookie 的值。没有会话就直接算失败——这些操作都要先登录。
func ieCheckCSRF(c echo.Context) bool {
	session := ieCSRF(c)
	return session != "" && c.FormValue("csrf") == session
}

// ieBackTo 回到目录并带上一行结果说明（PRG：刷新不会把刚才那一步再做一遍）。
func ieBackTo(c echo.Context, dirPath, notice string) error {
	return c.Redirect(http.StatusFound, ieBrowseURL(dirPath, 1)+"&notice="+url.QueryEscape(notice))
}

// ieNotice 读 PRG 带回来的一行结果（上传统计之类），截断后原样交给模板转义。
func ieNotice(c echo.Context) string {
	notice := c.QueryParam("notice")
	if utf8.RuneCountInString(notice) > 200 {
		notice = string([]rune(notice)[:200]) + "…"
	}
	return notice
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
