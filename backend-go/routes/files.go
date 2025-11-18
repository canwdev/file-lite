package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/types"
	"file-lite-go/utils"
)

func registerFiles(g *echo.Group) {
	g.GET("/auth", func(c echo.Context) error { return c.JSON(http.StatusOK, map[string]any{}) })
	g.GET("/drives", func(c echo.Context) error { return getDrives(c) })
	g.GET("/list", func(c echo.Context) error { return getFiles(c) })
	g.POST("/create-dir", func(c echo.Context) error { return createDirectory(c) })
	g.POST("/rename", func(c echo.Context) error { return renamePath(c) })
	g.POST("/copy-paste", func(c echo.Context) error { return copyPastePath(c) })
	g.POST("/delete", func(c echo.Context) error { return deletePath(c) })
	g.GET("/stream", func(c echo.Context) error { return getFileStream(c) })
	g.GET("/download", func(c echo.Context) error { return downloadPath(c) })
	g.POST("/upload-file", func(c echo.Context) error { return uploadFile(c) })
}

func isPathSafe(p string) bool {
	if p == "" {
		return false
	}
	base := config.SafeBaseDir()
	if base == "" {
		return true
	}
	rp := filepath.Clean(p)
	rp = strings.ReplaceAll(rp, "\\", "/")
	base = strings.ReplaceAll(base, "\\", "/")
	return strings.HasPrefix(rp, base)
}

func isExist(p string) bool { _, err := os.Stat(p); return err == nil }

func getDrives(c echo.Context) error {
	if config.SafeBaseDir() != "" {
		return c.JSON(http.StatusOK, []types.Drive{{Label: config.SafeBaseDir(), Path: config.SafeBaseDir()}})
	}
	home, _ := os.UserHomeDir()
	homeDrive := types.Drive{Label: "Home", Path: home}
	var list []types.Drive
	if strings.EqualFold(os.Getenv("OS"), "Windows_NT") || runtime.GOOS == "windows" {
		for _, d := range utils.GetWindowsDrives() {
			list = append(list, types.Drive{Label: d, Path: d})
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
	if !isExist(path) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
	}
	st, _ := os.Stat(path)
	if !st.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not a directory"})
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed to read directory"})
	}
	res := make([]types.Entry, 0)
	for _, e := range entries {
		ep := filepath.Join(path, e.Name())
		st, err2 := os.Stat(ep)
		if err2 != nil {
			msg := err2.Error()
			res = append(res, types.Entry{Name: e.Name(), Ext: filepath.Ext(e.Name()), IsDirectory: false, Hidden: strings.HasPrefix(e.Name(), "."), LastModified: 0, Birthtime: 0, Size: ptrI64(0), Error: &msg})
			continue
		}
		isDir := st.IsDir()
		var size *int64
		if isDir {
			size = nil
		} else {
			s := st.Size()
			size = &s
		}
		res = append(res, types.Entry{Name: e.Name(), Ext: func() string {
			if isDir {
				return ""
			}
			return filepath.Ext(e.Name())
		}(), IsDirectory: isDir, Hidden: strings.HasPrefix(e.Name(), "."), LastModified: st.ModTime().UnixMilli(), Birthtime: st.ModTime().UnixMilli(), Size: size, Error: nil})
	}
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
	if isExist(body.Path) {
		return c.JSON(http.StatusOK, map[string]any{"existed": true, "path": body.Path})
	}
	if err := os.MkdirAll(body.Path, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
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
	if isExist(body.ToPath) {
		return c.JSON(http.StatusConflict, map[string]string{"message": "Destination path already exists"})
	}
	if err := os.Rename(body.FromPath, body.ToPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
	}
	return c.JSON(http.StatusOK, map[string]string{"path": body.ToPath})
}

func copyEntry(fromPath, toDir string, isMove bool) error {
	if !isPathSafe(fromPath) || !isPathSafe(toDir) {
		return fmtError("Path is not safe. From: %s, To: %s", fromPath, toDir)
	}
	if !isExist(fromPath) {
		return fmtError("Source path does not exist: %s", fromPath)
	}
	toPath := filepath.Join(toDir, filepath.Base(fromPath))
	if isExist(toPath) {
		return fmtError("Destination path already exists: %s", toPath)
	}
	st, _ := os.Stat(fromPath)
	if st.IsDir() {
		if err := copyDir(fromPath, toPath); err != nil {
			return err
		}
	} else {
		if err := copyFile(fromPath, toPath); err != nil {
			return err
		}
	}
	if isMove {
		_ = os.RemoveAll(fromPath)
	}
	return nil
}

func copyDir(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	for _, e := range entries {
		sp := filepath.Join(src, e.Name())
		dp := filepath.Join(dst, e.Name())
		st, _ := os.Stat(sp)
		if st.IsDir() {
			if err := copyDir(sp, dp); err != nil {
				return err
			}
		} else {
			if err := copyFile(sp, dp); err != nil {
				return err
			}
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyPastePath(c echo.Context) error {
	var body struct {
		FromPaths []string `json:"fromPaths"`
		ToPath    string   `json:"toPath"`
		IsMove    bool     `json:"isMove"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	for _, p := range body.FromPaths {
		if err := copyEntry(p, body.ToPath, body.IsMove); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": err.Error()})
		}
	}
	return c.JSON(http.StatusOK, map[string]string{"path": body.ToPath})
}

func deletePath(c echo.Context) error {
	var raw map[string]any
	if err := json.NewDecoder(c.Request().Body).Decode(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	v := raw["path"]
	var paths []string
	switch t := v.(type) {
	case string:
		paths = []string{t}
	case []any:
		for _, i := range t {
			if s, ok := i.(string); ok {
				paths = append(paths, s)
			}
		}
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Bad Request"})
	}
	for _, p := range paths {
		if !isPathSafe(p) {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe: " + p})
		}
		if !isExist(p) {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path not found: " + p})
		}
	}
	for _, p := range paths {
		_ = os.RemoveAll(p)
	}
	return c.JSON(http.StatusOK, map[string]any{"path": v})
}

func getFileStream(c echo.Context) error {
	path := c.QueryParam("path")
	if !isPathSafe(path) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not safe"})
	}
	if !isExist(path) {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "Path not found"})
	}
	st, _ := os.Stat(path)
	if st.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "Path is not a file"})
	}
	name := filepath.Base(path)
	c.Response().Header().Set("Content-Disposition", utils.InlineDisposition(name))
	return c.File(path)
}

func downloadMulti(paths []string, c echo.Context) error {
	if len(paths) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "No files to download"})
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
	for i := range paths {
		paths[i] = urlDecode(paths[i])
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
	}
	defer src.Close()
	name := f.Filename
	out, err := os.Create(filepath.Join(dest, name))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
	}
	defer out.Close()
	if _, err := io.Copy(out, src); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "Failed"})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "File uploaded successfully!"})
}

func urlDecode(s string) string {
	u, err := url.QueryUnescape(s)
	if err != nil {
		return s
	}
	return u
}

func ptrI64(v int64) *int64 { return &v }

func fmtError(f string, a ...any) error { return fmt.Errorf(f, a...) }
