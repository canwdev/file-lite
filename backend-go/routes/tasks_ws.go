package routes

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/fileops"
	"file-lite-go/tasks"
)

// taskManager 是全局唯一（单用户自托管）的任务管理器：
// 所有客户端都收到所有任务的事件，也都可以取消任意任务。
var (
	taskManagerMu sync.Mutex
	taskManager   *tasks.Manager
)

func startTaskManager() {
	taskManagerMu.Lock()
	defer taskManagerMu.Unlock()
	if taskManager != nil {
		return
	}
	engine := fileops.NewEngine(config.CopyFsyncEnabled())
	m := tasks.NewManager(engine, tasks.Options{
		Concurrency:     config.TaskConcurrency(),
		FileConcurrency: config.CopyFileConcurrency(),
	})
	m.SetEmitter(broadcastTaskEvent)
	m.Start()
	taskManager = m
}

func stopTaskManager() {
	taskManagerMu.Lock()
	m := taskManager
	taskManager = nil
	taskManagerMu.Unlock()
	if m != nil {
		m.Stop()
	}
}

func currentTaskManager() *tasks.Manager {
	taskManagerMu.Lock()
	defer taskManagerMu.Unlock()
	return taskManager
}

type sharedWSTaskCreatePayload struct {
	Kind       string   `json:"kind"`
	FromPaths  []string `json:"fromPaths"`
	ToPath     string   `json:"toPath,omitempty"`
	OnConflict string   `json:"onConflict,omitempty"`
}

type sharedWSTaskDecision struct {
	RelativePath string `json:"relativePath"`
	Policy       string `json:"policy"`
}

type sharedWSTasksClientMessage struct {
	Scope      string                     `json:"scope"`
	Type       string                     `json:"type"`
	RequestID  string                     `json:"requestId,omitempty"`
	TaskID     string                     `json:"taskId,omitempty"`
	Task       *sharedWSTaskCreatePayload `json:"task,omitempty"`
	Policy     string                     `json:"policy,omitempty"`
	ApplyToAll bool                       `json:"applyToAll,omitempty"`
	Items      []sharedWSTaskDecision     `json:"items,omitempty"`
}

func parseSharedWSTasksMessage(raw []byte) (sharedWSTasksClientMessage, error) {
	var base sharedWSBaseMessage
	if err := json.Unmarshal(raw, &base); err != nil {
		return sharedWSTasksClientMessage{}, err
	}
	if base.Scope != "tasks" {
		return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}

	var msg sharedWSTasksClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return sharedWSTasksClientMessage{}, err
	}

	switch msg.Type {
	case "create":
		if msg.RequestID == "" || msg.Task == nil || len(msg.Task.FromPaths) == 0 || msg.Task.Kind == "" {
			return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	case "cancel", "dismiss":
		if msg.TaskID == "" {
			return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	case "retry":
		if msg.RequestID == "" || msg.TaskID == "" {
			return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	case "resolve":
		if msg.TaskID == "" {
			return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	case "list":
		if msg.RequestID == "" {
			return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
	default:
		return sharedWSTasksClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	return msg, nil
}

func handleSharedWSTasksMessage(client *sharedWSClient, msg sharedWSTasksClientMessage) {
	m := currentTaskManager()
	if m == nil {
		sendSharedWSError(client, "tasks", msg.RequestID, "Task service unavailable")
		return
	}

	switch msg.Type {
	case "create":
		snap, err := m.Create(tasks.CreateParams{
			Kind:       tasks.Kind(msg.Task.Kind),
			FromPaths:  msg.Task.FromPaths,
			ToPath:     msg.Task.ToPath,
			OnConflict: fileops.NormalizePolicy(msg.Task.OnConflict),
		})
		if err != nil {
			sendSharedWSError(client, "tasks", msg.RequestID, err.Error())
			return
		}
		sendSharedWSJSON(client, map[string]any{
			"scope":     "tasks",
			"type":      "response",
			"requestId": msg.RequestID,
			"taskId":    snap.ID,
		})
	case "retry":
		snap, err := m.Retry(msg.TaskID)
		if err != nil {
			sendSharedWSError(client, "tasks", msg.RequestID, err.Error())
			return
		}
		sendSharedWSJSON(client, map[string]any{
			"scope":     "tasks",
			"type":      "response",
			"requestId": msg.RequestID,
			"taskId":    snap.ID,
		})
	case "cancel":
		if err := m.Cancel(msg.TaskID); err != nil {
			sendSharedWSError(client, "tasks", "", err.Error())
		}
	case "resolve":
		items := make(map[string]fileops.Policy, len(msg.Items))
		for _, it := range msg.Items {
			if it.RelativePath == "" {
				continue
			}
			items[it.RelativePath] = fileops.NormalizePolicy(it.Policy)
		}
		req := tasks.ResolveRequest{
			Policy:     fileops.NormalizePolicy(msg.Policy),
			ApplyToAll: msg.ApplyToAll,
			Items:      items,
		}
		if err := m.Resolve(msg.TaskID, req); err != nil {
			sendSharedWSError(client, "tasks", "", err.Error())
		}
	case "list":
		sendSharedWSTasksSnapshotWithRequest(client, msg.RequestID)
	case "dismiss":
		if err := m.Dismiss(msg.TaskID); err != nil {
			sendSharedWSError(client, "tasks", "", err.Error())
			return
		}
		payload := map[string]any{"scope": "tasks", "type": "removed", "taskId": msg.TaskID}
		for _, c := range snapshotSharedWSClients() {
			sendSharedWSJSON(c, payload)
		}
	}
}

// sendSharedWSTasksSnapshot 在客户端连上时同步一次全量任务，用于断线重连后的对账。
func sendSharedWSTasksSnapshot(client *sharedWSClient) {
	sendSharedWSTasksSnapshotWithRequest(client, "")
}

func sendSharedWSTasksSnapshotWithRequest(client *sharedWSClient, requestID string) {
	m := currentTaskManager()
	if m == nil {
		return
	}
	payload := map[string]any{
		"scope": "tasks",
		"type":  "snapshot",
		"tasks": m.List(),
	}
	if requestID != "" {
		payload["requestId"] = requestID
	}
	sendSharedWSJSON(client, payload)

	// 快照里没有冲突清单，这里给等待决策的任务补一条 conflict 事件，
	// 否则新连接 / 重连的客户端看不到弹窗，任务只能等到 TTL 超时失败。
	for _, pending := range m.PendingConflicts() {
		sendSharedWSJSON(client, conflictPayloadMessage(pending.TaskID, pending.Payload))
	}
}

func conflictPayloadMessage(taskID string, conflict *tasks.ConflictPayload) map[string]any {
	payload := map[string]any{
		"scope":  "tasks",
		"type":   "conflict",
		"taskId": taskID,
	}
	if conflict != nil {
		payload["destPath"] = conflict.DestPath
		payload["isMove"] = conflict.IsMove
		payload["totalCount"] = conflict.TotalCount
		payload["truncated"] = conflict.Truncated
		payload["conflicts"] = conflict.Conflicts
	}
	return payload
}

// broadcastTaskEvent 把管理器事件翻译成 WS 消息发给所有客户端。
func broadcastTaskEvent(ev tasks.Event) {
	clients := snapshotSharedWSClients()
	if len(clients) == 0 {
		return
	}

	switch ev.Type {
	case tasks.EventCreated:
		// 新任务：带上完整快照，所有客户端都会立刻看到它
		payload := map[string]any{
			"scope": "tasks",
			"type":  "created",
			"task":  ev.Task,
		}
		for _, c := range clients {
			sendSharedWSJSON(c, payload)
		}
	case tasks.EventUpdate:
		// 进度类：可丢，慢客户端不阻塞广播
		payload := map[string]any{
			"scope":  "tasks",
			"type":   "update",
			"taskId": ev.Task.ID,
			"patch": map[string]any{
				"state":     ev.Task.State,
				"progress":  ev.Task.Progress,
				"stats":     ev.Task.Stats,
				"canCancel": ev.Task.CanCancel,
			},
		}
		for _, c := range clients {
			sendSharedWSJSONDroppable(c, payload)
		}
	case tasks.EventConflict:
		payload := conflictPayloadMessage(ev.Task.ID, ev.Conflict)
		for _, c := range clients {
			sendSharedWSJSON(c, payload)
		}
	case tasks.EventDone:
		payload := map[string]any{
			"scope":            "tasks",
			"type":             "done",
			"taskId":           ev.Task.ID,
			"state":            ev.Task.State,
			"stats":            ev.Task.Stats,
			"results":          ev.Results,
			"resultsTruncated": ev.ResultsTruncated,
			"error":            ev.Task.Error,
		}
		for _, c := range clients {
			sendSharedWSJSON(c, payload)
		}
		broadcastFSChanged(changedPathsForTask(ev.Task))
	}
}

// changedPathsForTask 推断这次任务影响了哪些目录，供前端刷新。
func changedPathsForTask(snap tasks.Snapshot) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(p string) {
		if p == "" {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	if snap.ToPath != "" {
		add(snap.ToPath)
	}
	for _, p := range snap.FromPaths {
		add(filepath.Dir(p))
	}
	return out
}
