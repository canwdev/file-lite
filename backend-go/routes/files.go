package routes

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
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

func registerFiles(g *echo.Group) {
	// 挂载表要在任何路径解析之前就位：它决定一条路径属于哪个根。
	// 与侧边栏用同一份枚举结果（visibleDrives），避免两者漂移。
	fileops.SetMounts(visibleDrives())

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
			// config 里没开 allowSelfUpdate 时，/api/update、/api/update/restart
			// 与 /api/update/exit 根本没注册；前端据此决定要不要显示那几个菜单项。
			"selfUpdate": config.Config().AllowSelfUpdate,
		},
		// allowedRoots 生效时的允许范围，空表示不限制。
		// 前端用它把「为什么这里点不进去」讲清楚：一个没有说明的 403 只会让人以为坏了。
		"allowedRoots": fileops.AllowedRoots(),
	})
}

func isExist(p string) bool { _, err := os.Stat(p); return err == nil }

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
	return c.JSON(http.StatusOK, visibleDrives())
}

// enumerateDrivesFn 间接一层，便于测试注入固定的位置列表：`visibleDrives` 的输入
// 就是「枚举结果」，只注入挂载表的话构造不出它真正要处理的那份输入。
// 生产路径上恒为 enumerateDrives。
var enumerateDrivesFn = enumerateDrives

// visibleDrives 返回配置的访问范围之内可以暴露的位置。
//
// 未配 allowedRoots 时就是 enumerateDrives() 的原样结果。
//
// 配了之后，**允许的根本身就是列表里的根**：
//
//   - 只保留**落在某个允许根之内**的挂载点——这同时解决两件事：列表就是枚举面，
//     不收窄等于继续告诉调用方「这台机器上有什么」；而挂载点又是「上一级」的停点，
//     留下范围外的就等于把出口留在范围外。
//   - **包含允许根的那个挂载点会被这条规则挡住**，这正是要的效果：`D:` 包含
//     `D:/Projects/app/bin`，如果按「包含允许根就保留」的直觉留下它，侧边栏就会
//     显示 D: 根，用户点进去只拿到 403（这个例子来自实际反馈）。
//   - 允许根**之内**更深的挂载点是范围内的位置，保留（reload、容量这些信息仍然有用）。
//
// 每条允许根随后都作为一个位置列出来，除非它已经恰好是枚举结果里的某一项。
// 多条时没有「唯一根」可推导，所以直接列出用户配置的那几条——最不会误解的呈现。
// 嵌套的允许根已由 fileops 折叠。
//
// **必须是幂等的**：挂载表由本函数的结果建立，而本函数又被 /drives 反复调用。
// 判断「这条允许根是不是已经列出来了」不能去问挂载表——第一次调用把合成的项写进
// 表里之后，第二次就会答「已经有」，于是原样返回全盘列表。这一条是实测踩出来的。
func visibleDrives() []types.Drive {
	roots := fileops.AllowedRoots()
	all := enumerateDrivesFn()
	if len(roots) == 0 {
		return all
	}

	// 范围内更深的挂载点保留下来。
	out := make([]types.Drive, 0, len(all)+len(roots))
	for _, d := range all {
		root, err := fileops.CanonicalizePath(d.Path)
		if err != nil {
			continue
		}
		if fileops.IsWithinRoots(root, roots) {
			out = append(out, d)
		}
	}

	// 每条允许根都作为一个位置列出，除非它已经恰好是枚举结果里的某个根
	// （那种情况下上面的循环已经把它留下了）。判据只看**枚举结果**，不看挂载表，
	// 理由见上面的幂等说明。
	for _, root := range fileops.TopLevelAllowedRoots() {
		if fileops.InDrives(all, root) {
			continue
		}
		kind := types.DriveKindVolume
		if fileops.IsNetworkTarget(root) {
			kind = types.DriveKindNetwork
		}
		out = append(out, types.Drive{Label: fileops.BaseName(root), Path: root, Kind: kind})
	}
	return out
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

func getFiles(c echo.Context) error {
	raw := c.QueryParam("path")
	if raw == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path parameter is required"})
	}
	res, httpErr := resolvePath(raw)
	if httpErr != nil {
		return httpErr
	}
	dir := res.OSPath()

	st, err := os.Stat(dir)
	if err != nil {
		status, message := fsErrorStatus(err, res.Network())
		return jsonFSError(c, status, message)
	}
	if !st.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not a directory"})
	}

	if queryTruthy(c, "recursive") {
		entries, walkErr := listFilesRecursive(dir, queryTruthy(c, "showHidden"))
		if walkErr != nil {
			if errors.Is(walkErr, errFlattenLimit) {
				return c.JSON(http.StatusBadRequest, map[string]string{"message": walkErr.Error()})
			}
			status, message := fsErrorStatus(walkErr, res.Network())
			return jsonFSError(c, status, message)
		}
		return c.JSON(http.StatusOK, entries)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		status, message := fsErrorStatus(err, res.Network())
		return jsonFSError(c, status, message)
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

	res2 := make([]types.Entry, len(entries))
	jobs := make(chan statJob)
	// 并发档位由路径所属的挂载点决定：本机卷 64，网络位置 6。
	// 一千个文件按 64 并发在 SMB 上就是上千次网络往返，会把共享打到超时。
	workerCount := res.ReadDirConcurrency()
	if len(entries) < workerCount {
		workerCount = len(entries)
	}
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				ep := filepath.Join(dir, job.entry.Name())
				st, statErr := os.Stat(ep)
				if statErr != nil {
					res2[job.index] = entryFromStatError(job.entry, statErr)
					continue
				}
				res2[job.index] = entryFromStat(job.entry.Name(), st, ep, job.entry.Type()&os.ModeSymlink != 0)
			}
		}()
	}

	for i, e := range entries {
		jobs <- statJob{index: i, entry: e}
	}
	close(jobs)
	wg.Wait()

	return c.JSON(http.StatusOK, res2)
}

func queryTruthy(c echo.Context, key string) bool {
	v := strings.ToLower(strings.TrimSpace(c.QueryParam(key)))
	return v == "1" || v == "true" || v == "yes"
}

const flattenListLimit = 1000000

var errFlattenLimit = errors.New("this folder has too many files to flatten")

// listFilesRecursive 把 root 下每一层的文件摊成一份列表，Name 是相对 root 的路径
// （正斜杠）。目录本身不出现——平铺视图要的是跨文件夹的文件，不是再列一遍树。
// 不跟随指向目录的符号链接，避免环。showHidden 为 false 时跳过名字以点开头的项。
func listFilesRecursive(root string, showHidden bool) ([]types.Entry, error) {
	out := make([]types.Entry, 0)
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if p == root {
				return walkErr
			}
			return nil
		}
		if p == root {
			return nil
		}
		name := d.Name()
		if utils.IsReservedTempName(name) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		hidden := strings.HasPrefix(name, ".")
		if !showHidden && hidden {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		isSymlink := d.Type()&os.ModeSymlink != 0
		if d.IsDir() {
			if isSymlink {
				return filepath.SkipDir
			}
			return nil
		}

		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." || strings.HasPrefix(rel, "../") {
			return nil
		}

		st, statErr := d.Info()
		if isSymlink {
			st, statErr = os.Stat(p)
			if statErr != nil {
				return nil
			}
			if st.IsDir() {
				return nil
			}
		}
		if statErr != nil {
			return nil
		}
		if len(out) >= flattenListLimit {
			return errFlattenLimit
		}
		entry := entryFromStat(rel, st, p, isSymlink)
		entry.Hidden = entryHiddenRel(rel)
		out = append(out, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func entryHiddenRel(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func createDirectory(c echo.Context) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	if body.Path == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path is required"})
	}
	res, httpErr := resolvePath(body.Path)
	if httpErr != nil {
		return httpErr
	}
	body.Path = res.Path
	if utils.IsReservedTempName(fileops.BaseName(body.Path)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	osPath := res.OSPath()
	if isExist(osPath) {
		return c.JSON(http.StatusOK, map[string]any{"existed": true, "path": body.Path})
	}
	// 先记下缺的每一级：MkdirAll 可能建到一半才失败，已经落盘的那些也要通知。
	missing := absentDirs(body.Path)
	err := os.MkdirAll(osPath, 0755)
	changes := &listingChangeSet{}
	for _, dir := range missing {
		changes.add(dir)
	}
	changes.broadcast()
	if err != nil {
		status, message := fsErrorStatus(err, res.Network())
		return jsonFSError(c, status, message)
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
	from, httpErr := resolvePath(body.FromPath)
	if httpErr != nil {
		return httpErr
	}
	to, httpErr := resolvePath(body.ToPath)
	if httpErr != nil {
		return httpErr
	}
	// 规范化之后再判「同一个路径」：C:\ 与 C:/ 是同一个位置，不该被当成合法重命名。
	if from.Path == to.Path {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Paths cannot be the same"})
	}
	fromOS, toOS := from.OSPath(), to.OSPath()
	if !isExist(fromOS) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Source path not found"})
	}
	if utils.IsReservedTempName(fileops.BaseName(to.Path)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	if isExist(toOS) {
		return c.JSON(http.StatusConflict, map[string]string{"message": "Destination path already exists"})
	}
	fromInfo, err := os.Stat(fromOS)
	if err != nil {
		status, message := fsErrorStatus(err, from.Network())
		return jsonFSError(c, status, message)
	}
	// 词法判断，两侧都已经是 canonical 路径；大小写不折叠是有意的取舍
	// （见 utils.IsPathInsideOrEqual 的注释）。
	if fromInfo.IsDir() && utils.IsPathInsideOrEqual(toOS, fromOS) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "The destination folder is a subfolder of the source folder"})
	}
	if err := os.Rename(fromOS, toOS); err != nil {
		status, message := fsErrorStatus(err, from.Network() || to.Network())
		return jsonFSError(c, status, message)
	}
	srcDir := fileops.DirName(from.Path)
	dstDir := fileops.DirName(to.Path)
	if _, ok := statEntry(to.Path); !ok {
		// 改名已经成功但读不出新条目：只给目录，让前端整表刷新，别只删掉旧名字。
		broadcastFSChanged(uniqueDirs(srcDir, dstDir), nil)
		return c.JSON(http.StatusOK, map[string]string{"path": to.Path})
	}
	changes := &listingChangeSet{}
	changes.remove(srcDir, fileops.BaseName(from.Path))
	changes.add(to.Path)
	changes.broadcast()
	return c.JSON(http.StatusOK, map[string]string{"path": to.Path})
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

	// 交给外部程序的是本机路径（资源管理器只认本机路径），但先按 VFS 规则解析一次：
	// 这样非法路径报的是 400，而不是把一条畸形路径直接喂给 ShellExecute。
	osPaths := make([]string, 0, len(paths))
	for _, p := range paths {
		res, httpErr := resolvePath(p)
		if httpErr != nil {
			return httpErr
		}
		if !isExist(res.OSPath()) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found: " + p})
		}
		osPaths = append(osPaths, res.OSPath())
	}

	if err := utils.RevealInHostExplorer(osPaths); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]any{"paths": paths})
}

func getFileStream(c echo.Context) error {
	raw := c.QueryParam("path")
	if raw == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "path parameter is required"})
	}
	res, httpErr := resolvePath(raw)
	if httpErr != nil {
		return httpErr
	}
	osPath := res.OSPath()
	st, err := os.Stat(osPath)
	if err != nil {
		status, message := fsErrorStatus(err, res.Network())
		if status == http.StatusInternalServerError {
			message = "Failed to read the path"
		}
		return jsonFSError(c, status, message)
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
	name := fileops.BaseName(res.Path)
	c.Response().Header().Set("Content-Disposition", utils.InlineDisposition(name))
	return c.File(osPath)
}

// resolveDownloadPaths 把下载请求里的路径统一解析成本机路径。
//
// 多选打包（zip）不接受「一半能读一半不能读」：先全部解析再开始写响应，
// 否则用户在压缩流已经开始之后才拿到错误，客户端只会得到一个缺文件的 zip。
func resolveDownloadPaths(paths []string) ([]string, *echo.HTTPError) {
	osPaths := make([]string, 0, len(paths))
	for _, p := range paths {
		res, httpErr := resolvePath(p)
		if httpErr != nil {
			return nil, httpErr
		}
		osPaths = append(osPaths, res.OSPath())
	}
	return osPaths, nil
}

func downloadMulti(paths []string, c echo.Context) error {
	if len(paths) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "No files to download"})
	}
	osPaths, httpErr := resolveDownloadPaths(paths)
	if httpErr != nil {
		return httpErr
	}
	// 写响应头之前先预检所有路径可读（文件被占用/不可读时直接报错，
	// 避免压缩流开始后才失败、客户端拿到缺文件的 zip 却无法得知）。
	if err := utils.VerifyZipPathsReadable(osPaths); err != nil {
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
	return utils.ZipPathsToWriter(osPaths, c.Response())
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
		res, httpErr := resolvePath(paths[0])
		if httpErr != nil {
			return httpErr
		}
		st, err := os.Stat(res.OSPath())
		if err != nil {
			status, message := fsErrorStatus(err, res.Network())
			if status == http.StatusInternalServerError {
				message = "Path not found"
			}
			return jsonFSError(c, status, message)
		}
		if !st.IsDir() {
			name := fileops.BaseName(res.Path)
			c.Response().Header().Set("Content-Disposition", utils.AttachmentDisposition(name))
			return c.File(res.OSPath())
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
	var network bool
	if qPath != "" {
		// path 是**目标文件**的完整路径（前端把要写入的位置整条传过来），
		// 目录取它的父目录。父目录用 canonical 语义算（fileops.DirName），
		// 不能用 filepath.Dir：后者在非 Windows 上对 "C:/x" 返回 "."。
		res, httpErr := resolvePath(qPath)
		if httpErr != nil {
			return httpErr
		}
		dest = fileops.DirName(res.Path)
		network = res.Network()
	} else {
		dest = filepath.ToSlash(filepath.Join(config.DataBaseDir(), "uploads"))
		if canonical, err := fileops.CanonicalizePath(dest); err == nil {
			dest = canonical
		}
	}
	// 父目录可能是这次顺便建出来的。先记下来，写入失败或同名冲突时也要广播这些目录；
	// 文件本身只在写成功之后才放进同一条通知。
	changes := &listingChangeSet{}
	defer changes.broadcast()
	destOS := filepath.FromSlash(dest)
	if created := absentDirs(dest); len(created) > 0 {
		// 失败不在这里返回：后面的写入会带上真正的原因。已经建出来的目录照样通知。
		_ = os.MkdirAll(destOS, 0755)
		for _, dir := range created {
			changes.add(dir)
		}
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
	// f.Filename 可能带目录前缀（老浏览器发完整路径，Windows 上还带 "\"）。
	// 必须先取最后一段：filepath.Base 只认本机分隔符，在 Linux 上对
	// "C:\Users\a.txt" 会原样返回，于是 sanitizeUploadFilename 里的
	// Base 检查把它当成含分隔符而拒绝——同一个上传在 Windows 上成功、
	// 在 Linux 上 400，正是这条链路最难查的形态。
	name, err := sanitizeUploadFilename(fileops.BaseName(f.Filename))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}
	if utils.IsReservedTempName(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Invalid filename"})
	}

	destPath := path.Join(dest, name)
	destPathOS := filepath.FromSlash(destPath)
	replaced := false
	switch c.QueryParam("onConflict") {
	case "overwrite":
		// 调用方已确认要替换。写之前看一眼：已有文件走 updated，新建走 added。
		replaced = fileops.ExistsAt(destPathOS)
	case "keep-both":
		destPath = fileops.UniquePath(destPath)
		destPathOS = filepath.FromSlash(destPath)
	default:
		if fileops.ExistsAt(destPathOS) {
			return c.JSON(http.StatusConflict, map[string]any{
				"message": "Destination path already exists: " + name,
				"path":    destPath,
				"name":    name,
			})
		}
	}
	// 报告落盘时的真实名字：keep-both 会把目标改成 "a (1).txt"，
	// 响应里仍写请求名会让传输记录对不上磁盘上的文件。
	name = fileops.BaseName(destPath)

	if err := fileops.PublishFile(destPathOS, fileops.PublishOptions{
		Mode: 0644,
		// 网络位置：仍然「临时文件 + 改名」（中断的上传不留半个文件），
		// 但跳过 fsync 与发布前的 chmod——见 PublishOptions.NetworkTarget。
		NetworkTarget: network,
	}, func(w io.Writer) error {
		_, err := io.Copy(w, src)
		return err
	}); err != nil {
		status, message := fsErrorStatus(err, network)
		if status == http.StatusInternalServerError {
			message = "Failed to write the file"
		}
		return jsonFSError(c, status, message)
	}
	if replaced {
		changes.update(destPath)
	} else {
		changes.add(destPath)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "File uploaded successfully!",
		"path":    destPath,
		"name":    name,
	})
}

// existsPaths 批量查询路径是否存在，用于上传前的冲突预检。
// 走服务端而不是前端列表，是为了让嵌套路径（文件夹上传）也能被正确检查。
//
// 回显的是调用方传进来的原字符串（而不是 canonical 形式）：调用方拿它去跟自己
// 持有的路径做等值比较，改写这一侧只会让两边对不上。解析失败（相对路径等）记为
// 「不存在」——预检问的是「这个位置有没有东西」，畸形路径的答案是「没有」。
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
		res, err := fileops.Resolve(p)
		if err != nil {
			continue
		}
		if fileops.ExistsAt(res.OSPath()) {
			existing = append(existing, p)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"existing": existing})
}
func ptrI64(v int64) *int64 { return &v }
