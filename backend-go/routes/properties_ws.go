package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
	"file-lite-go/utils"
)

// propertiesWSPayload 同时用于 meta（目录：先给出名字 / 时间）与
// result（文件立即返回；目录后台统计完再推）。字段超集让前端可以合并处理。
type propertiesWSPayload struct {
	Scope        string `json:"scope"`
	Type         string `json:"type"`
	RequestID    string `json:"requestId"`
	Name         string `json:"name"`
	Path         string `json:"path"`
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

type sharedWSPropertiesClientMessage struct {
	Scope     string `json:"scope"`
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Path      string `json:"path,omitempty"`
}

func parseSharedWSPropertiesMessage(raw []byte) (sharedWSPropertiesClientMessage, error) {
	var base sharedWSBaseMessage
	if err := json.Unmarshal(raw, &base); err != nil {
		return sharedWSPropertiesClientMessage{}, err
	}
	if base.Scope != "properties" {
		return sharedWSPropertiesClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}

	var msg sharedWSPropertiesClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return sharedWSPropertiesClientMessage{}, err
	}

	switch msg.Type {
	case "get":
		if msg.RequestID == "" || msg.Path == "" {
			return sharedWSPropertiesClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	case "cancel":
		if msg.RequestID == "" {
			return sharedWSPropertiesClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	default:
		return sharedWSPropertiesClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	return msg, nil
}

func handleSharedWSPropertiesMessage(client *sharedWSClient, msg sharedWSPropertiesClientMessage) {
	if msg.Type == "cancel" {
		cancelSharedWSPropertiesScan(client, msg.RequestID)
		return
	}

	// 路径来自 wire，先按 VFS 规则解析再碰文件系统：canonical 路径恒用 "/"，
	// 而 Windows 的 os.* 只认 "\"，不转的话这里永远 stat 不到东西。
	osPath, ok := resolveWSPath(client, "properties", msg.RequestID, msg.Path)
	if !ok {
		return
	}

	info, err := os.Stat(osPath)
	if err != nil {
		sendSharedWSError(client, "properties", msg.RequestID, pathErrorMessage(err))
		return
	}

	isLink := isLinkEntry(osPath, info)
	name := fileops.BaseName(msg.Path)
	ext := ""
	if !info.IsDir() {
		ext = filepath.Ext(name)
	}
	modTime := info.ModTime().UnixMilli()
	birthtime, ok := utils.BirthTime(osPath, info)
	if !ok {
		birthtime = modTime
	}

	payload := propertiesWSPayload{
		Scope:        "properties",
		RequestID:    msg.RequestID,
		Name:         name,
		Path:         msg.Path,
		Ext:          ext,
		IsDirectory:  info.IsDir(),
		IsLink:       isLink,
		LastModified: modTime,
		Birthtime:    birthtime,
	}

	if !info.IsDir() {
		payload.Type = "result"
		payload.Size = info.Size()
		payload.Complete = true
		sendSharedWSJSON(client, payload)
		return
	}

	// 目录：先把名字 / 时间推给窗口，再后台递归统计大小与条目数。
	payload.Type = "meta"
	sendSharedWSJSON(client, payload)

	// 目录链接用解析后的真实路径遍历，避免把链接自身当成一个文件。
	root := osPath
	if isLink {
		if resolved, err := filepath.EvalSymlinks(osPath); err == nil {
			root = resolved
		}
	}
	startSharedWSPropertiesScan(client, payload, root)
}

func isLinkEntry(path string, info os.FileInfo) bool {
	if lstat, err := os.Lstat(path); err == nil && lstat.Mode()&os.ModeSymlink != 0 {
		return true
	}
	if !info.IsDir() && utils.HardLinkCount(info, path) > 1 {
		return true
	}
	return false
}

// resolveWSPath 解析 WebSocket 消息里的路径，失败时回一条错误并返回 ok=false。
//
// WebSocket 没有 HTTP 状态码可用，所以「路径不合法」与「读不到」都只能靠消息文本
// 区分；这里统一用 pathErrorMessage。
func resolveWSPath(client *sharedWSClient, scope, requestID, raw string) (string, bool) {
	res, err := fileops.Resolve(raw)
	if err != nil {
		sendSharedWSError(client, scope, requestID, err.Error())
		return "", false
	}
	return res.OSPath(), true
}

// pathErrorMessage 把文件系统错误翻译成给用户看的一句话。
//
// 「路径不存在」与「读不到」必须分开：前者是用户的导航目标没了，后者可能是
// 网络位置离线（可重试）或权限不足（不可重试），混成一句会让用户做错决定。
func pathErrorMessage(err error) string {
	if isNotFound(err) {
		return "Path not found"
	}
	return "Unable to read properties"
}

// ---- 后台统计：每个连接同时只跑一个，新请求 / 取消 / 断开都会终止旧的 ----

var sharedWSPropertiesScans = struct {
	sync.Mutex
	byClient map[*sharedWSClient]propertiesScan
}{byClient: map[*sharedWSClient]propertiesScan{}}

type propertiesScan struct {
	requestID string
	cancel    context.CancelFunc
}

func startSharedWSPropertiesScan(client *sharedWSClient, payload propertiesWSPayload, path string) {
	// 同一个窗口再次请求时，旧的统计已经没有意义
	cancelSharedWSPropertiesScanForClient(client)

	ctx, cancel := context.WithCancel(context.Background())
	sharedWSPropertiesScans.Lock()
	sharedWSPropertiesScans.byClient[client] = propertiesScan{requestID: payload.RequestID, cancel: cancel}
	sharedWSPropertiesScans.Unlock()

	go func() {
		defer func() {
			sharedWSPropertiesScans.Lock()
			if current, ok := sharedWSPropertiesScans.byClient[client]; ok && current.requestID == payload.RequestID {
				delete(sharedWSPropertiesScans.byClient, client)
			}
			sharedWSPropertiesScans.Unlock()
			cancel()
		}()

		result := fileops.MeasureTree(ctx, path)
		if ctx.Err() != nil {
			return
		}

		files, folders := result.Files, result.Folders
		payload.Type = "result"
		payload.Size = result.Bytes
		payload.FileCount = &files
		payload.FolderCount = &folders
		payload.Complete = result.Complete
		sendSharedWSJSON(client, payload)
	}()
}

func cancelSharedWSPropertiesScan(client *sharedWSClient, requestID string) {
	sharedWSPropertiesScans.Lock()
	current, ok := sharedWSPropertiesScans.byClient[client]
	if ok && current.requestID == requestID {
		delete(sharedWSPropertiesScans.byClient, client)
	} else {
		ok = false
	}
	sharedWSPropertiesScans.Unlock()
	if ok {
		current.cancel()
	}
}

func cancelSharedWSPropertiesScanForClient(client *sharedWSClient) {
	sharedWSPropertiesScans.Lock()
	current, ok := sharedWSPropertiesScans.byClient[client]
	if ok {
		delete(sharedWSPropertiesScans.byClient, client)
	}
	sharedWSPropertiesScans.Unlock()
	if ok {
		current.cancel()
	}
}
