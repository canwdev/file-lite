package routes

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/labstack/echo/v4"
	etag "github.com/pablor21/echo-etag/v4"

	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/thumbnails"
	"file-lite-go/types"
	"file-lite-go/utils"
)

const readDirStatConcurrency = 64

func registerFiles(g *echo.Group) {
	// 挂载表要在任何路径解析之前就位：它决定一条路径属于哪个根。
	// 与侧边栏用同一份枚举结果（enumerateDrives），避免两者漂移。
	fileops.SetMounts(enumerateDrives())

	g.GET("/auth", func(c echo.Context) error { return getAuthInfo(c) })
	g.GET("/drives", func(c echo.Context) error { return getDrives(c) })
	g.GET("/start", func(c echo.Context) error { return getStartPath(c) })
	g.GET("/list", func(c echo.Context) error { return getFiles(c) }, etag.Etag())
	g.POST("/create-dir", func(c echo.Context) error { return createDirectory(c) })
	g.POST("/rename", func(c echo.Context) error { return renamePath(c) })
	g.POST("/open-in-host-explorer", func(c echo.Context) error { return openInHostExplorer(c) })
	g.GET("/stream", func(c echo.Context) error { return getFileStream(c) })
	g.HEAD("/stream", func(c echo.Context) error { return getFileStream(c) })
	g.GET("/thumbnail", func(c echo.Context) error { return getThumbnail(c) })
	g.GET("/download", func(c echo.Context) error { return downloadPath(c) })
	g.POST("/upload-file", func(c echo.Context) error { return uploadFile(c) })
	g.POST("/exists", func(c echo.Context) error { return existsPaths(c) })
}

// getAuthInfo 兼作登录态探测与能力上报。
// 前端启动时必调这里，所以没有 ffmpeg 时它就能知道视频封面不可用，
// 从而不必为每个视频发一次注定失败的请求。
func getAuthInfo(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"capabilities": map[string]any{
			"videoThumbnail": thumbnails.Default.VideoAvailable(),
			// config 里没开 allowSelfUpdate 时，/api/update、/api/update/restart
			// 与 /api/update/exit 根本没注册；前端据此决定要不要显示那几个菜单项。
			"selfUpdate": config.Config().AllowSelfUpdate,
		},
	})
}

func isExist(p string) bool { _, err := os.Stat(p); return err == nil }

// canonicalVFS 在边界处把路径归一化成 canonical 形式（分隔符、重复斜杠、"." / ".."）。
//
// 归一化失败（相对路径、越根）时原样返回，让下游走它本来的错误分支——这一步只是为了
// 让 `\`、重复斜杠、尾斜杠这些写法在所有平台都落到同一个路径上，不改变任何错误语义。
// 完整的解析（挂载点、错误码）见 docs/design/vfs-abstraction-plan.md 阶段 3 的调用点迁移。
func canonicalVFS(p string) string {
	if canonical, err := fileops.CanonicalizePath(p); err == nil {
		return canonical
	}
	return p
}

func sanitizeUploadFilename(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("invalid filename")
	}
	// 只有整个名字就是点的时候才会跳出目标目录：filepath.Join(dest, "..") 写到父目录，
	// Join(dest, ".") 就是 dest 自己。名字中间的点是合法的（"C.h.a.o.s.m.y.t.h..mp3"），
	// 所以不能像以前那样见到 ".." 就拒绝。
	if name == "." || name == ".." {
		return "", fmt.Errorf("invalid filename")
	}
	safeName := utils.Sanitize(name, "_")
	if safeName == "" {
		return "", fmt.Errorf("invalid filename")
	}
	return safeName, nil
}

// 判定条目是否为链接：符号链接 / Windows 目录链接（junction）/
// 硬链接（文件 nlink > 1；目录的 nlink 会随子目录增多，不能作为依据）。
func entryFromStat(name string, st os.FileInfo, path string, isSymbolicLink bool) types.Entry {
	isDir := st.IsDir()
	var size *int64
	if !isDir {
		s := st.Size()
		size = &s
	}

	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}

	isLink := isSymbolicLink
	if !isLink && !isDir && utils.HardLinkCount(st, path) > 1 {
		isLink = true
	}

	modTime := st.ModTime().UnixMilli()
	// 创建时间在部分平台 / 文件系统上拿不到，此时与修改时间保持一致（旧行为）。
	birthtime, ok := utils.BirthTime(path, st)
	if !ok {
		birthtime = modTime
	}
	return types.Entry{Name: name, Ext: ext, IsDirectory: isDir, IsLink: isLink, Hidden: strings.HasPrefix(name, "."), LastModified: modTime, Birthtime: birthtime, Size: size, Error: nil}
}

func entryFromStatError(e os.DirEntry, err error) types.Entry {
	name := e.Name()
	isDir := e.IsDir()
	var size *int64
	if !isDir {
		size = ptrI64(0)
	}

	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}

	msg := err.Error()
	return types.Entry{Name: name, Ext: ext, IsDirectory: isDir, IsLink: e.Type()&os.ModeSymlink != 0, Hidden: strings.HasPrefix(name, "."), LastModified: 0, Birthtime: 0, Size: size, Error: &msg}
}

func getDrives(c echo.Context) error {
	return c.JSON(http.StatusOK, enumerateDrives())
}

// enumerateDrives 枚举可导航的位置：Home + 本机卷 / 网络位置。
//
// 侧边栏展示它，启动时也用它填充 fileops 的挂载表——两者必须是同一份数据，
// 否则「界面上的盘」与「解析器认识的挂载点」会漂移。
func enumerateDrives() []types.Drive {
	home, _ := os.UserHomeDir()
	list := make([]types.Drive, 0, 8)
	if home != "" {
		list = append(list, types.Drive{Label: "Home", Path: home, Kind: types.DriveKindHome})
	}
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") || runtime.GOOS == "windows" {
		list = append(list, utils.GetWindowsDrives()...)
	} else {
		list = append(list, utils.GetUnixMounts()...)
	}
	return list
}

// getStartPath 返回配置里的起始目录（未配置时为空串）。
//
// 前端只在首次打开标签页时用一次：空串表示从挂载点列表开始，由用户自己选位置。
func getStartPath(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"path": config.StartPath()})
}

func getFiles(c echo.Context) error {
	path := canonicalVFS(c.QueryParam("path"))
	if path == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path parameter is required"})
	}

	st, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	if !st.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not a directory"})
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed to read directory"})
	}

	type statJob struct {
		index int
		entry os.DirEntry
	}

	filtered := entries[:0]
	for _, e := range entries {
		// 内部临时文件（复制中）永远不出现在列表里
		if utils.IsReservedTempName(e.Name()) {
			continue
		}
		filtered = append(filtered, e)
	}
	entries = filtered

	res := make([]types.Entry, len(entries))
	jobs := make(chan statJob)
	workerCount := readDirStatConcurrency
	if len(entries) < workerCount {
		workerCount = len(entries)
	}
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				ep := filepath.Join(path, job.entry.Name())
				st, statErr := os.Stat(ep)
				if statErr != nil {
					res[job.index] = entryFromStatError(job.entry, statErr)
					continue
				}
				res[job.index] = entryFromStat(job.entry.Name(), st, ep, job.entry.Type()&os.ModeSymlink != 0)
			}
		}()
	}

	for i, e := range entries {
		jobs <- statJob{index: i, entry: e}
	}
	close(jobs)
	wg.Wait()

	return c.JSON(http.StatusOK, res)
}

func createDirectory(c echo.Context) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	body.Path = canonicalVFS(body.Path)
	if body.Path == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path is required"})
	}
	if utils.IsReservedTempName(fileops.BaseName(body.Path)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	if isExist(body.Path) {
		return c.JSON(http.StatusOK, map[string]any{"existed": true, "path": body.Path})
	}
	if err := os.MkdirAll(body.Path, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	c.Response().Status = http.StatusCreated
	return c.JSON(http.StatusCreated, map[string]string{"path": body.Path})
}

func renamePath(c echo.Context) error {
	var body struct {
		FromPath string `json:"fromPath"`
		ToPath   string `json:"toPath"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	if body.FromPath == "" || body.ToPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "fromPath or toPath is required"})
	}
	if body.FromPath == body.ToPath {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Paths cannot be the same"})
	}
	if !isExist(body.FromPath) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Source path not found"})
	}
	if utils.IsReservedTempName(fileops.BaseName(body.ToPath)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	if isExist(body.ToPath) {
		return c.JSON(http.StatusConflict, map[string]string{"message": "Destination path already exists"})
	}
	fromInfo, err := os.Stat(body.FromPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	if fromInfo.IsDir() && utils.IsPathInsideOrEqual(body.ToPath, body.FromPath) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "The destination folder is a subfolder of the source folder"})
	}
	if err := os.Rename(body.FromPath, body.ToPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]string{"path": body.ToPath})
}

func openInHostExplorer(c echo.Context) error {
	var body struct {
		Paths any `json:"paths"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}

	var paths []string
	switch t := body.Paths.(type) {
	case string:
		if t != "" {
			paths = []string{t}
		}
	case []any:
		for _, i := range t {
			if s, ok := i.(string); ok && s != "" {
				paths = append(paths, s)
			}
		}
	}

	if len(paths) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "paths parameter is required"})
	}

	for _, p := range paths {
		if !isExist(p) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found: " + p})
		}
	}

	if err := utils.RevealInHostExplorer(paths); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]any{"paths": paths})
}

func getFileStream(c echo.Context) error {
	path := canonicalVFS(c.QueryParam("path"))
	if path == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path parameter is required"})
	}
	if !isExist(path) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
	}
	st, err := os.Stat(path)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	if st.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not a file"})
	}
	// 浏览器按文件校验器复用缓存:文件未变化时返回 304,避免网格/预览场景反复整张
	// 下载大图(c.File 内部还会按 Last-Modified / If-Modified-Since 处理条件请求)。
	// 不允许长缓存:文件可能原地被修改,每次都必须按校验器重新验证。
	etagValue := fmt.Sprintf(`"%x-%x"`, st.Size(), st.ModTime().UnixMilli())
	if inm := c.Request().Header.Get("If-None-Match"); inm != "" && inm == etagValue {
		c.Response().Header().Set("ETag", etagValue)
		return c.NoContent(http.StatusNotModified)
	}
	c.Response().Header().Set("ETag", etagValue)
	c.Response().Header().Set(echo.HeaderCacheControl, "public, max-age=0, must-revalidate")
	name := fileops.BaseName(path)
	c.Response().Header().Set("Content-Disposition", utils.InlineDisposition(name))
	return c.File(path)
}

func downloadMulti(paths []string, c echo.Context) error {
	if len(paths) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "No files to download"})
	}
	// 写响应头之前先预检所有路径可读（文件被占用/不可读时直接报错，
	// 避免压缩流开始后才失败、客户端拿到缺文件的 zip 却无法得知）。
	if err := utils.VerifyZipPathsReadable(paths); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	var downloadName string
	if len(paths) == 1 && paths[0] != "" {
		downloadName = fileops.BaseName(paths[0])
	} else if len(paths) > 1 && paths[0] != "" {
		downloadName = fileops.BaseName(fileops.DirName(paths[0]))
	}
	if downloadName == "" {
		downloadName = "download"
	}
	t := downloadName + ".zip"
	c.Response().Header().Set("Content-Disposition", utils.AttachmentDisposition(t))
	c.Response().Header().Set("Content-Type", "application/zip")
	c.Response().WriteHeader(http.StatusOK)
	return utils.ZipPathsToWriter(paths, c.Response())
}

func downloadPath(c echo.Context) error {
	q := c.QueryParams()
	path := q.Get("path")
	var paths []string
	if path != "" {
		paths = []string{path}
	} else {
		paths = q["paths"]
	}
	if len(paths) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path(s) parameter is required"})
	}
	if len(paths) == 1 {
		p := paths[0]
		if !isExist(p) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
		}
		st, _ := os.Stat(p)
		if !st.IsDir() {
			name := fileops.BaseName(p)
			c.Response().Header().Set("Content-Disposition", utils.AttachmentDisposition(name))
			return c.File(p)
		}
	}
	return downloadMulti(paths, c)
}

// uploadFile 写单文件。onConflict 决定同名时怎么办：
//   - "error"（缺省）：返回 409，绝不覆盖
//   - "overwrite"：替换目标
//   - "keep-both"：改名为 "name (1).ext" 后写入
//
// 写入统一走 fileops.PublishFile：先写目标同目录的临时文件再原子改名，
// 因此上传中断也不会留下半个文件（客户端不必再自己做清理）。
func uploadFile(c echo.Context) error {
	qPath := c.QueryParam("path")
	var dest string
	if qPath != "" {
		dest = fileops.DirName(qPath)
	} else {
		dest = filepath.Join(config.DataBaseDir(), "uploads")
	}
	if _, err := os.Stat(dest); err != nil {
		_ = os.MkdirAll(dest, 0755)
	}
	f, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	src, err := f.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	defer src.Close()
	name, err := sanitizeUploadFilename(f.Filename)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	if utils.IsReservedTempName(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}

	destPath := filepath.Join(dest, name)
	switch c.QueryParam("onConflict") {
	case "overwrite":
		// 调用方已确认要替换
	case "keep-both":
		destPath = fileops.UniquePath(destPath)
	default:
		if fileops.ExistsAt(destPath) {
			return c.JSON(http.StatusConflict, map[string]any{
				"message": "Destination path already exists: " + name,
				"path":    destPath,
				"name":    name,
			})
		}
	}

	if err := fileops.PublishFile(destPath, fileops.PublishOptions{
		Mode: 0644,
	}, func(w io.Writer) error {
		_, err := io.Copy(w, src)
		return err
	}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "File uploaded successfully!",
		"path":    destPath,
		"name":    fileops.BaseName(destPath),
	})
}

// existsPaths 批量查询路径是否存在，用于上传前的冲突预检。
// 走服务端而不是前端列表，是为了让嵌套路径（文件夹上传）也能被正确检查。
func existsPaths(c echo.Context) error {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	if len(body.Paths) > 20000 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Too many paths"})
	}
	existing := make([]string, 0, len(body.Paths))
	for _, p := range body.Paths {
		if fileops.ExistsAt(p) {
			existing = append(existing, p)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"existing": existing})
}
func ptrI64(v int64) *int64 { return &v }
