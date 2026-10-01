package routes

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/utils"
)

// ---- PUT /api/fs/directories/{path} ----

// putDirectory 建目录（含缺失的父级），幂等：已存在回 200，新建回 201。
func putDirectory(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}
	if utils.IsReservedTempName(fileops.BaseName(res.Path)) {
		return apierr.BadRequest(apierr.CodeInvalidName, "Invalid name")
	}

	osPath := res.OSPath()
	if st, err := os.Stat(osPath); err == nil {
		if !st.IsDir() {
			return apierr.Conflict(apierr.CodeConflict, "Path is not a directory")
		}
		entry, ok := statEntry(res.Path)
		if !ok {
			return apierr.Conflict(apierr.CodeConflict, "Path already exists")
		}
		return c.JSON(http.StatusOK, map[string]any{"path": res.Path, "entry": entry})
	}

	// 先记下缺的每一级：MkdirAll 可能建到一半才失败，已经落盘的那些也要通知。
	missing := absentDirs(res.Path)
	err := os.MkdirAll(osPath, 0755)
	changes := &listingChangeSet{}
	for _, dir := range missing {
		changes.add(dir)
	}
	changes.broadcast()
	if err != nil {
		return fsError(err, res.Network())
	}

	payload := map[string]any{"path": res.Path}
	if entry, ok := statEntry(res.Path); ok {
		payload["entry"] = entry
	}
	return c.JSON(http.StatusCreated, payload)
}

// ---- PATCH /api/fs/entries/{path} ----

// patchEntry 改名：body 只给新名字（不含分隔符），路径里的目录不变。
//
// 跨目录移动属于任务（POST /api/tasks 的 move），不在这里做——那样同一件事就有了
// 两个入口，冲突策略与进度也会各走一套。
func patchEntry(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return apierr.BadRequest(apierr.CodeInvalidName, "Invalid name")
	}
	if utils.IsReservedTempName(name) {
		return apierr.BadRequest(apierr.CodeInvalidName, "Invalid name")
	}

	// 名字没变：改名是幂等的，直接回当前条目。
	if name == fileops.BaseName(res.Path) {
		entry, ok := statEntry(res.Path)
		if !ok {
			return apierr.NotFound(apierr.CodePathNotFound, "Path not found")
		}
		return c.JSON(http.StatusOK, map[string]any{"path": res.Path, "entry": entry})
	}

	toPath := canonicalChild(fileops.DirName(res.Path), name)
	to, apiErr := resolvePath(toPath)
	if apiErr != nil {
		return apiErr
	}

	fromOS, toOS := res.OSPath(), to.OSPath()
	if !isExist(fromOS) {
		return apierr.NotFound(apierr.CodePathNotFound, "Source path not found")
	}
	if isExist(toOS) {
		return apierr.Conflict(apierr.CodeConflict, "Destination path already exists")
	}
	fromInfo, err := os.Stat(fromOS)
	if err != nil {
		return fsError(err, res.Network())
	}
	// 词法判断，两侧都已经是 canonical 路径；大小写不折叠是有意的取舍
	// （见 utils.IsPathInsideOrEqual 的注释）。
	if fromInfo.IsDir() && utils.IsPathInsideOrEqual(toOS, fromOS) {
		return apierr.BadRequest(apierr.CodeOutOfScope, "The destination folder is a subfolder of the source folder")
	}
	if err := os.Rename(fromOS, toOS); err != nil {
		return fsError(err, res.Network() || to.Network())
	}

	srcDir := fileops.DirName(res.Path)
	dstDir := fileops.DirName(to.Path)
	entry, ok := statEntry(to.Path)
	if !ok {
		// 改名已经成功但读不出新条目：只给目录，让前端整表刷新，别只删掉旧名字。
		broadcastFSChanged(uniqueDirs(srcDir, dstDir), nil)
		return c.JSON(http.StatusOK, map[string]string{"path": to.Path})
	}
	changes := &listingChangeSet{}
	changes.remove(srcDir, fileops.BaseName(res.Path))
	changes.add(to.Path)
	changes.broadcast()
	return c.JSON(http.StatusOK, map[string]any{"path": to.Path, "entry": entry})
}

// ---- PUT /api/fs/content/{path} ----

// putContent 写入一个文件：请求体就是文件内容。
//
// 同名策略用标准前置条件表达（docs/design/api.md §6）：
//   - If-None-Match: *   只新建，已存在回 412（前端据此弹冲突对话框）
//   - If-Match: <etag>   只有当前内容仍是这个版本时才覆盖，否则 412
//   - 都不带             覆盖或新建
//   - ?onConflict=keep-both  已存在时改写成 "name (1).ext"
//
// 请求体直接流进 PublishFile 的临时文件再原子改名：没有 multipart，也没有
// 「先落临时文件再拷一份」的双写。
func putContent(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}

	name, err := sanitizeUploadFilename(fileops.BaseName(res.Path))
	if err != nil {
		return apierr.BadRequest(apierr.CodeInvalidName, "Invalid name")
	}
	if utils.IsReservedTempName(name) {
		return apierr.BadRequest(apierr.CodeInvalidName, "Invalid name")
	}
	destPath := canonicalChild(fileops.DirName(res.Path), name)

	// 已存在时先看清目标是什么：目录不能覆盖，文件要拿 ETag 做前置条件。
	existed := false
	existingETag := ""
	if st, statErr := os.Stat(filepath.FromSlash(destPath)); statErr == nil {
		if st.IsDir() {
			return apierr.Conflict(apierr.CodeConflict, "Destination path is a directory")
		}
		existed = true
		existingETag = fileETag(st)
	}

	keepBoth := c.QueryParam("onConflict") == "keep-both"
	ifNoneMatch := strings.TrimSpace(c.Request().Header.Get("If-None-Match"))
	ifMatch := strings.TrimSpace(c.Request().Header.Get("If-Match"))

	switch {
	case keepBoth && existed:
		// 保留两者优先于前置条件：调用方要的就是「别覆盖」。
		destPath = fileops.UniquePath(destPath)
		name = fileops.BaseName(destPath)
		existed = false
	case ifNoneMatch == "*" && existed:
		return apierr.PreconditionFailed("Destination path already exists").
			WithDetails(map[string]any{"path": destPath, "name": name})
	case ifMatch != "" && ifMatch != "*":
		if !existed {
			return apierr.PreconditionFailed("Path does not exist")
		}
		if ifMatch != existingETag {
			return apierr.PreconditionFailed("The file changed since it was last listed")
		}
	}

	destOS := filepath.FromSlash(destPath)
	changes := &listingChangeSet{}
	defer changes.broadcast()

	if err := fileops.PublishFile(destOS, fileops.PublishOptions{
		Mode: 0644,
		// 网络位置：仍然「临时文件 + 改名」（中断的上传不留半个文件），
		// 但跳过 fsync 与发布前的 chmod——见 PublishOptions.NetworkTarget。
		NetworkTarget: res.Network(),
	}, func(w io.Writer) error {
		_, copyErr := io.Copy(w, c.Request().Body)
		return copyErr
	}); err != nil {
		apiErr := fsError(err, res.Network())
		if apiErr.Status == http.StatusInternalServerError {
			return apiErr.WithMessage("Failed to write the file")
		}
		return apiErr
	}

	if existed {
		changes.update(destPath)
	} else {
		changes.add(destPath)
	}

	c.Response().Header().Set(echo.HeaderLocation, "/api/fs/content/"+url.PathEscape(destPath))
	payload := map[string]any{"path": destPath, "name": name}
	if entry, ok := statEntry(destPath); ok {
		payload["entry"] = entry
	}
	if existed {
		return c.JSON(http.StatusOK, payload)
	}
	return c.JSON(http.StatusCreated, payload)
}

// ---- POST /api/fs/entry-queries ----

// queryEntries 批量回答「这些路径现在存在吗」。
//
// 上传前的冲突对话框要一次问清一批文件，一次请求比每个文件问一次省掉 N-1 次往返；
// 写的时候仍然由 PUT 的前置条件兜底，所以这里的答案只用于展示，不承担正确性。
func queryEntries(c echo.Context) error {
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	if len(body.Paths) > queryEntriesMaxPaths {
		return apierr.BadRequest(apierr.CodeTooManyPaths, "Too many paths")
	}

	// 并发 stat：网络位置上几百个路径串行问会明显卡住对话框。
	flags := make([]bool, len(body.Paths))
	sem := make(chan struct{}, queryEntriesConcurrency)
	var wg sync.WaitGroup
	for i, p := range body.Paths {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, p string) {
			defer wg.Done()
			defer func() { <-sem }()
			res, err := fileops.Resolve(p)
			if err != nil {
				return
			}
			flags[i] = fileops.ExistsAt(res.OSPath())
		}(i, p)
	}
	wg.Wait()

	existing := make([]string, 0, len(body.Paths))
	for i, p := range body.Paths {
		if flags[i] {
			existing = append(existing, p)
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"existing": existing})
}

const (
	queryEntriesMaxPaths    = 20000
	queryEntriesConcurrency = 16
)

// fileETag 是内容端点的强校验器：大小 + 毫秒 mtime。前置条件用它比较版本。
func fileETag(st os.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, st.Size(), st.ModTime().UnixMilli())
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
