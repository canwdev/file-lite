package routes

import (
	"sync"

	"file-lite-go/fileops"
	"file-lite-go/tasks"
)

// 任务管理器与它的推送出口。
//
// 命令（创建 / 取消 / 重试 / 冲突决策）走 HTTP，见 tasks.go 与 docs/design/api.md §7；
// 这里只负责把管理器的事件翻译成 WebSocket 消息，以及客户端连上时的全量对账。

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
	engine := fileops.NewEngine()
	m := tasks.NewManager(engine, tasks.DefaultOptions())
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

// sendSharedWSTasksSnapshot 在客户端连上时同步一次全量任务，用于断线重连后的对账。
func sendSharedWSTasksSnapshot(client *sharedWSClient) {
	m := currentTaskManager()
	if m == nil {
		return
	}
	sendSharedWSJSON(client, map[string]any{
		"scope": "tasks",
		"type":  "snapshot",
		"tasks": m.List(),
	})

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
		broadcastFSChanged(changedPathsForTask(ev.Task), dirChangesForTask(ev.Task, ev.TopLevel))
	}
}

// changedPathsForTask 推断这次任务影响了哪些目录，供前端刷新。
//
// copy / duplicate 不动源目录，所以不把源目录算进去——否则「从当前目录复制到
// 别处」会白白刷新一次什么都没变的当前目录。
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
	if snap.Kind == tasks.KindMove || snap.Kind == tasks.KindDelete {
		for _, p := range snap.FromPaths {
			add(fileops.DirName(p))
		}
	}
	return out
}
