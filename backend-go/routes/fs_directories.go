package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/types"
	"file-lite-go/utils"
)

// 列目录的分页边界。默认值保证一个普通目录一次就够，上限保证一次响应不会大到把
// 服务端与浏览器拖垮；需要更多时客户端翻页。
const (
	listDefaultLimit = 2000
	listMaxLimit     = 50000
)

// listResponse 是 GET /api/fs/directories/{path} 的响应。
//
// 与旧的 `GET /files/list` 不同，这里返回对象而不是裸数组：分页信息与路径必须
// 和条目一起回给调用方，否则前端要靠猜。
type listResponse struct {
	Path      string        `json:"path"`
	Offset    int           `json:"offset"`
	Limit     int           `json:"limit"`
	Total     int           `json:"total"`
	Truncated bool          `json:"truncated"`
	Entries   []types.Entry `json:"entries"`
}

// listDirectory 实现 GET /api/fs/directories/{path}（见 docs/design/api.md §6）。
//
// 非递归时返回一页条目；递归时把子树里的文件摊平（目录自身不出现），
// 上限由 flattenListLimit 决定，超过就报 400 而不是回一份不完整的结果。
func listDirectory(c echo.Context) error {
	raw, apiErr := entryPath(c)
	if apiErr != nil {
		return apiErr
	}
	res, apiErr := resolvePath(raw)
	if apiErr != nil {
		return apiErr
	}
	dir := res.OSPath()

	st, err := os.Stat(dir)
	if err != nil {
		return fsError(err, res.Network())
	}
	if !st.IsDir() {
		return apierr.Conflict(apierr.CodeConflict, "Path is not a directory")
	}

	if queryTruthy(c, "recursive") {
		return listDirectoryRecursive(c, res, dir)
	}
	return listDirectoryFlat(c, res, dir)
}

func listDirectoryFlat(c echo.Context, res fileops.Resolved, dir string) error {
	offset, limit := listPageParams(c)

	entries, err := readDirEntries(res, dir)
	if err != nil {
		return fsError(err, res.Network())
	}

	page := sliceEntries(entries, offset, limit)
	if page == nil {
		page = []types.Entry{}
	}
	return c.JSON(http.StatusOK, listResponse{
		Path:    res.Path,
		Offset:  offset,
		Limit:   limit,
		Total:   len(entries),
		Entries: page,
	})
}

// readDirEntries 读一个目录并返回全部条目：过滤掉内部临时文件、并发 stat。
//
// 不分页、不排序、不过滤隐藏项——JSON 接口按页切、经典 HTML 界面按名字排，
// 两者共用这一份读取。dir 是本机形态路径，res 用来决定并发档位与条目前缀。
func readDirEntries(res fileops.Resolved, dir string) ([]types.Entry, error) {
	raw, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	// 内部临时文件（复制中）永远不出现在列表里。
	filtered := raw[:0]
	for _, e := range raw {
		if !utils.IsReservedTempName(e.Name()) {
			filtered = append(filtered, e)
		}
	}

	out := make([]types.Entry, len(filtered))

	type statJob struct {
		index int
		entry os.DirEntry
	}
	jobs := make(chan statJob)
	// 并发档位由路径所属的挂载点决定：本机卷 64，网络位置 6。
	// 一千个文件按 64 并发在 SMB 上就是上千次网络往返，会把共享打到超时。
	workerCount := res.ReadDirConcurrency()
	if len(filtered) < workerCount {
		workerCount = len(filtered)
	}
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				name := job.entry.Name()
				ep := filepath.Join(dir, name)
				st, statErr := os.Stat(ep)
				if statErr != nil {
					out[job.index] = entryFromStatError(job.entry, statErr)
				} else {
					out[job.index] = entryFromStat(name, st, ep, job.entry.Type()&os.ModeSymlink != 0)
				}
				out[job.index].Path = canonicalChild(res.Path, name)
			}
		}()
	}
	for i, e := range filtered {
		jobs <- statJob{index: i, entry: e}
	}
	close(jobs)
	wg.Wait()

	return out, nil
}

// listPageParams 解析 offset / limit。畸形值按「没给」处理：分页参数不该让整个
// 目录打不开。
func listPageParams(c echo.Context) (int, int) {
	offset := queryInt(c.QueryParam("offset"))
	if offset < 0 {
		offset = 0
	}
	limit := queryInt(c.QueryParam("limit"))
	if limit <= 0 {
		limit = listDefaultLimit
	}
	if limit > listMaxLimit {
		limit = listMaxLimit
	}
	return offset, limit
}

func sliceEntries(entries []types.Entry, offset, limit int) []types.Entry {
	if offset >= len(entries) {
		return nil
	}
	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}
	return entries[offset:end]
}

func listDirectoryRecursive(c echo.Context, res fileops.Resolved, dir string) error {
	entries, walkErr := walkFilesFlat(res.Path, dir, queryTruthy(c, "showHidden"))
	if walkErr != nil {
		if walkErr == errFlattenLimit {
			return apierr.BadRequest(apierr.CodeBadRequest, walkErr.Error())
		}
		return fsError(walkErr, res.Network())
	}

	// 平铺列表可能上万条，**流式编码**：一条一条写出去，不在内存里再拼一份完整
	// JSON（那是与条目切片等量级的第二份拷贝）。代价是响应头先发出去，写到一半
	// 失败只能断流——这里唯一的失败源是客户端断开，本来也没有补救的意义。
	h := c.Response().Header()
	h.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	c.Response().WriteHeader(http.StatusOK)

	out := c.Response()
	pathJSON, err := json.Marshal(res.Path)
	if err != nil {
		return nil
	}
	if _, err := fmt.Fprintf(out, `{"path":%s,"offset":0,"limit":%d,"total":%d,"truncated":false,"entries":[`,
		pathJSON, len(entries), len(entries)); err != nil {
		return nil
	}

	enc := json.NewEncoder(out)
	for i := range entries {
		if i > 0 {
			if _, err := out.Write([]byte(",")); err != nil {
				return nil
			}
		}
		// Encode 会在值后面补一个换行，它在 JSON 数组里只是空白，合法。
		if err := enc.Encode(entries[i]); err != nil {
			return nil
		}
	}

	_, _ = out.Write([]byte("]}"))
	return nil
}

// walkFilesFlat 把 canonicalRoot 下每一层的文件摊成一份列表。
//
// 与旧的 listFilesRecursive 的区别在条目形状：`name` 永远是 basename，`path` 是
// canonical 完整路径，`relativePath` 才是相对被列出目录的路径。旧实现把相对路径
// 塞进 `name`，调用方必须知道自己在哪个模式才能解释这个字段。
//
// 目录自身不出现——平铺视图要的是跨文件夹的文件，不是再列一遍树。
// 不跟随指向目录的符号链接，避免环。showHidden 为 false 时跳过名字以点开头的项。
func walkFilesFlat(canonicalRoot, osRoot string, showHidden bool) ([]types.Entry, error) {
	out := make([]types.Entry, 0)
	err := filepath.WalkDir(osRoot, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if p == osRoot {
				return walkErr
			}
			return nil
		}
		if p == osRoot {
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

		rel, relErr := filepath.Rel(osRoot, p)
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
		entry := entryFromStat(name, st, p, isSymlink)
		entry.Path = canonicalChild(canonicalRoot, rel)
		entry.RelativePath = rel
		entry.Hidden = entryHiddenRel(rel)
		out = append(out, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
