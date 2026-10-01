package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
	"file-lite-go/utils"
)

// 目录大小测量（docs/design/api.md §9）。
//
// 属性窗口要的是「这个文件夹一共多大」，在大目录 / 网络位置上可能要跑很久。它不是
// 任务：不会改动文件，也不该出现在传输面板里。所以它有自己的资源与生命周期：
// POST 建一个、结果通过 WebSocket 推、DELETE 取消。
//
// 状态留在进程内存里：测量结果只对发起它的那个窗口有意义，没必要时隔天还在。

// measurementTTL 是一个测量的最长生命期。
//
// 正常的窗口会在关闭 / 换目标时 DELETE；这个上限是兜底：页面直接关掉、或调用方
// 再也不来取结果时，条目连同它还在跑的遍历一起被回收。所以过期判定不看是否完成——
// 只看完成的话，一个卡住的遍历会永远留在表里。
const measurementTTL = 10 * time.Minute

type measurement struct {
	id           string
	path         string
	name         string
	ext          string
	isDirectory  bool
	isLink       bool
	size         int64
	fileCount    *int
	folderCount  *int
	lastModified int64
	birthtime    int64
	complete     bool
	createdAt    time.Time
	cancel       context.CancelFunc
}

// measurementPayload 同时是 REST 表示与 WebSocket 事件的载荷。
type measurementPayload struct {
	Scope        string `json:"scope,omitempty"`
	Type         string `json:"type,omitempty"`
	ID           string `json:"id"`
	Path         string `json:"path"`
	Name         string `json:"name"`
	Ext          string `json:"ext"`
	IsDirectory  bool   `json:"isDirectory"`
	IsLink       bool   `json:"isLink"`
	Size         int64  `json:"size"`
	FileCount    *int   `json:"fileCount"`
	FolderCount  *int   `json:"folderCount"`
	LastModified int64  `json:"lastModified"`
	Birthtime    int64  `json:"birthtime"`
	Complete     bool   `json:"complete"`
}

var measurements = struct {
	sync.Mutex
	byID map[string]*measurement
}{byID: map[string]*measurement{}}

func newMeasurementID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "m_" + hex.EncodeToString([]byte(time.Now().Format("150405.000")))
	}
	return "m_" + hex.EncodeToString(buf)
}

// createMeasurement 实现 POST /api/fs/measurements。
func createMeasurement(c echo.Context) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := c.Bind(&body); err != nil {
		return apierr.BadRequest(apierr.CodeBadRequest, "Bad Request")
	}
	if body.Path == "" {
		return apierr.BadRequest(apierr.CodeBadRequest, "path is required")
	}

	res, apiErr := resolvePath(body.Path)
	if apiErr != nil {
		return apiErr
	}
	osPath := res.OSPath()
	info, err := os.Stat(osPath)
	if err != nil {
		return fsError(err, res.Network())
	}

	m := &measurement{
		id:           newMeasurementID(),
		path:         res.Path,
		name:         fileops.BaseName(res.Path),
		isDirectory:  info.IsDir(),
		isLink:       isLinkEntry(osPath, info),
		lastModified: info.ModTime().UnixMilli(),
		createdAt:    time.Now(),
	}
	if birthtime, ok := utils.BirthTime(osPath, info); ok {
		m.birthtime = birthtime
	} else {
		m.birthtime = m.lastModified
	}
	if !info.IsDir() {
		m.ext = filepath.Ext(m.name)
		m.size = info.Size()
		m.complete = true
	}

	sweepMeasurements(time.Now())

	measurements.Lock()
	measurements.byID[m.id] = m
	measurements.Unlock()

	if !m.isDirectory {
		// 文件不需要遍历：直接给结果，前端拿到的第一条就是终态。
		pushMeasurement(m, "result")
		return c.JSON(http.StatusCreated, m.payload("", ""))
	}

	// 目录：先把名字 / 时间告诉窗口，再后台递归统计。
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	pushMeasurement(m, "progress")
	go runMeasurement(ctx, m)

	return c.JSON(http.StatusCreated, m.payload("", ""))
}

// getMeasurement 实现 GET /api/fs/measurements/{id}，供错过推送或想轮询的客户端。
func getMeasurement(c echo.Context) error {
	m := findMeasurement(c)
	if m == nil {
		return apierr.NotFound(apierr.CodeMeasurementNotFound, "Measurement not found")
	}
	return c.JSON(http.StatusOK, m.payload("", ""))
}

// deleteMeasurement 实现 DELETE /api/fs/measurements/{id}：取消并忘记它。
func deleteMeasurement(c echo.Context) error {
	id, apiErr := measurementID(c)
	if apiErr != nil {
		return apiErr
	}

	measurements.Lock()
	m := measurements.byID[id]
	delete(measurements.byID, id)
	measurements.Unlock()

	if m == nil {
		return apierr.NotFound(apierr.CodeMeasurementNotFound, "Measurement not found")
	}
	if m.cancel != nil {
		m.cancel()
	}
	return c.NoContent(http.StatusNoContent)
}

func runMeasurement(ctx context.Context, m *measurement) {
	root := filepath.FromSlash(m.path)
	// 目录链接用解析后的真实路径遍历，避免把链接自身当成一个文件。
	if m.isLink {
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			root = resolved
		}
	}

	result := fileops.MeasureTree(ctx, root)
	if ctx.Err() != nil {
		// 客户端已经取消：条目也从表里删掉了，不必再写状态或推送。
		return
	}

	files, folders := result.Files, result.Folders
	measurements.Lock()
	m.size = result.Bytes
	m.fileCount = &files
	m.folderCount = &folders
	m.complete = result.Complete
	measurements.Unlock()

	pushMeasurement(m, "result")
}

func (m *measurement) payload(scope, typ string) measurementPayload {
	measurements.Lock()
	defer measurements.Unlock()
	return measurementPayload{
		Scope:        scope,
		Type:         typ,
		ID:           m.id,
		Path:         m.path,
		Name:         m.name,
		Ext:          m.ext,
		IsDirectory:  m.isDirectory,
		IsLink:       m.isLink,
		Size:         m.size,
		FileCount:    m.fileCount,
		FolderCount:  m.folderCount,
		LastModified: m.lastModified,
		Birthtime:    m.birthtime,
		Complete:     m.complete,
	}
}

func pushMeasurement(m *measurement, typ string) {
	payload := m.payload("measurements", typ)
	for _, client := range snapshotSharedWSClients() {
		sendSharedWSJSON(client, payload)
	}
}

func findMeasurement(c echo.Context) *measurement {
	id, apiErr := measurementID(c)
	if apiErr != nil {
		return nil
	}
	measurements.Lock()
	defer measurements.Unlock()
	return measurements.byID[id]
}

func measurementID(c echo.Context) (string, *apierr.Error) {
	raw := c.Param("*")
	id, err := url.PathUnescape(raw)
	if err != nil || id == "" {
		return "", apierr.BadRequest(apierr.CodeBadRequest, "Invalid measurement id")
	}
	return id, nil
}

// sweepMeasurements 回收过期的测量：从表里删掉，并取消它还在跑的遍历。
//
// 取消放在锁外做：context 的取消会唤醒遍历协程，而那个协程完成时还要拿同一把锁。
func sweepMeasurements(now time.Time) {
	measurements.Lock()
	var expired []*measurement
	for id, m := range measurements.byID {
		if now.Sub(m.createdAt) > measurementTTL {
			delete(measurements.byID, id)
			expired = append(expired, m)
		}
	}
	measurements.Unlock()

	for _, m := range expired {
		if m.cancel != nil {
			m.cancel()
		}
	}
}

// isLinkEntry 判定一个条目是否为链接：符号链接 / Windows 目录链接（junction）/
// 硬链接（文件 nlink > 1；目录的 nlink 会随子目录增多，不能作为依据）。
func isLinkEntry(path string, info os.FileInfo) bool {
	if lstat, err := os.Lstat(path); err == nil && lstat.Mode()&os.ModeSymlink != 0 {
		return true
	}
	if !info.IsDir() && utils.HardLinkCount(info, path) > 1 {
		return true
	}
	return false
}
