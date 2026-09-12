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
	g.GET("/auth", func(c echo.Context) error { return getAuthInfo(c) })
	g.GET("/drives", func(c echo.Context) error { return getDrives(c) })
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
		},
	})
}

func isPathSafe(p string) bool {
	return fileops.IsPathSafe(p)
}

func isExist(p string) bool { _, err := os.Stat(p); return err == nil }

func sanitizeUploadFilename(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
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
	if config.SafeBaseDir() != "" {
		return c.JSON(http.StatusOK, []types.Drive{{Label: config.SafeBaseDir(), Path: config.SafeBaseDir()}})
	}
	home, _ := os.UserHomeDir()
	homeDrive := types.Drive{Label: "Home", Path: home}
	var list []types.Drive
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") || runtime.GOOS == "windows" {
		// 此时 d 直接就是 types.Drive 对象了
		for _, d := range utils.GetWindowsDrives() {
			list = append(list, d)
		}
	} else {
		for _, m := range utils.GetUnixMounts() {
			list = append(list, types.Drive{Label: m, Path: m})
		}
	}
	return c.JSON(http.StatusOK, append([]types.Drive{homeDrive}, list...))
}

func getFiles(c echo.Context) error {
	path := c.QueryParam("path")
	if !isPathSafe(path) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe"})
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
	if !isPathSafe(body.Path) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe"})
	}
	if utils.IsReservedTempName(filepath.Base(body.Path)) {
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
	if !isPathSafe(body.FromPath) || !isPathSafe(body.ToPath) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "A specified path is not safe"})
	}
	if !isExist(body.FromPath) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Source path not found"})
	}
	if utils.IsReservedTempName(filepath.Base(body.ToPath)) {
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
		if !isPathSafe(p) {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe: " + p})
		}
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
	path := c.QueryParam("path")
	if !isPathSafe(path) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe"})
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
	name := filepath.Base(path)
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
		downloadName = filepath.Base(paths[0])
	} else if len(paths) > 1 && paths[0] != "" {
		downloadName = filepath.Base(filepath.Dir(paths[0]))
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
	for _, p := range paths {
		if !isPathSafe(p) {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe: " + p})
		}
	}
	if len(paths) == 1 {
		p := paths[0]
		if !isExist(p) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
		}
		st, _ := os.Stat(p)
		if !st.IsDir() {
			name := filepath.Base(p)
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
		if !isPathSafe(qPath) {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe: " + qPath})
		}
		dest = filepath.Dir(qPath)
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
		Mode:  0644,
		Fsync: config.CopyFsyncEnabled(),
	}, func(w io.Writer) error {
		_, err := io.Copy(w, src)
		return err
	}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "File uploaded successfully!",
		"path":    destPath,
		"name":    filepath.Base(destPath),
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
		if !isPathSafe(p) {
			continue
		}
		if fileops.ExistsAt(p) {
			existing = append(existing, p)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"existing": existing})
}
func ptrI64(v int64) *int64 { return &v }
