package routes

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/utils"
)

// getContent 实现 GET /api/fs/content/{path}。
//
// `disposition=attachment` 时按下载处理，否则内联（图片 / 视频播放）。
func getContent(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}
	return serveFileContent(c, res, c.QueryParam("disposition") == "attachment")
}

// serveFileContent 把文件交给 http.ServeContent。
//
// 条件请求（If-None-Match / If-Modified-Since）、Range 与 If-Range 全部由标准库处理：
// 视频拖动、下载断点续传因此不需要自己写一套 304 逻辑。ETag 必须在调用前设好，
// ServeContent 会读响应头里的它。
func serveFileContent(c echo.Context, res fileops.Resolved, attachment bool) error {
	osPath := res.OSPath()
	f, err := os.Open(osPath)
	if err != nil {
		return fsError(err, res.Network())
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return fsError(err, res.Network())
	}
	if st.IsDir() {
		return apierr.Conflict(apierr.CodeConflict, "Path is not a file")
	}

	// 浏览器按校验器复用缓存：文件未变化时返回 304，避免网格/预览场景反复整张下载
	// 大图。不允许长缓存：文件可能原地被修改，每次都必须按校验器重新验证。
	h := c.Response().Header()
	h.Set("ETag", fileETag(st))
	h.Set(echo.HeaderCacheControl, "public, max-age=0, must-revalidate")
	// 流式返回的文件内容不可信。nosniff 阻止浏览器重新解释它；HTML/SVG 文档再被
	// sandbox 到独立源——以内联方式挂在同源上，它就能读 session cookie 并调用 API。
	h.Set("X-Content-Type-Options", "nosniff")
	if isActiveDocument(res.Path) {
		h.Set("Content-Security-Policy", "sandbox allow-scripts")
	}
	name := fileops.BaseName(res.Path)
	if attachment {
		h.Set(echo.HeaderContentDisposition, utils.AttachmentDisposition(name))
	} else {
		h.Set(echo.HeaderContentDisposition, utils.InlineDisposition(name))
	}

	http.ServeContent(c.Response(), c.Request(), name, st.ModTime(), f)
	return nil
}

// getDownloads 实现 GET /api/fs/downloads?paths=…&paths=…。
//
// 单选且确实是普通文件时直接给字节（可断点续传、无需解压）；目录或多选才打包成 zip。
// 调用方（下载按钮）并不总是知道目标是文件还是目录，所以两种形态由这里判断。
func getDownloads(c echo.Context) error {
	paths := c.QueryParams()["paths"]
	if len(paths) == 0 {
		return apierr.BadRequest(apierr.CodeBadRequest, "paths parameter is required")
	}
	if len(paths) == 1 {
		res, apiErr := resolvePath(paths[0])
		if apiErr != nil {
			return apiErr
		}
		st, err := os.Stat(res.OSPath())
		if err != nil {
			return fsError(err, res.Network())
		}
		if !st.IsDir() {
			return serveFileContent(c, res, true)
		}
	}
	return downloadMulti(paths, c)
}

// activeDocumentExtensions are the extensions a browser renders as a document
// that can execute script.
var activeDocumentExtensions = map[string]bool{
	".html":  true,
	".htm":   true,
	".xhtml": true,
	".svg":   true,
}

func isActiveDocument(p string) bool {
	return activeDocumentExtensions[strings.ToLower(filepath.Ext(p))]
}

// resolveDownloadPaths 把下载请求里的路径统一解析成本机路径。
//
// 多选打包（zip）不接受「一半能读一半不能读」：先全部解析再开始写响应，
// 否则用户在压缩流已经开始之后才拿到错误，客户端只会得到一个缺文件的 zip。
func resolveDownloadPaths(paths []string) ([]string, *apierr.Error) {
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
		return apierr.BadRequest(apierr.CodeBadRequest, "No files to download")
	}
	osPaths, httpErr := resolveDownloadPaths(paths)
	if httpErr != nil {
		return httpErr
	}
	// 写响应头之前先预检所有路径可读（文件被占用/不可读时直接报错，
	// 避免压缩流开始后才失败、客户端拿到缺文件的 zip 却无法得知）。
	if err := utils.VerifyZipPathsReadable(osPaths); err != nil {
		return apierr.Internal(apierr.CodeIOError, err.Error())
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
