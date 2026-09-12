// Package tasks 管理异步文件操作任务：状态机、并发闸门、进度节流上报、取消。
package tasks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"file-lite-go/fileops"
)

// Kind 是任务类型。
type Kind string

const (
	KindCopy      Kind = "copy"
	KindMove      Kind = "move"
	KindDelete    Kind = "delete"
	KindDuplicate Kind = "duplicate"
)

// IsValidKind 判断类型是否受支持。
func IsValidKind(k Kind) bool {
	switch k {
	case KindCopy, KindMove, KindDelete, KindDuplicate:
		return true
	default:
		return false
	}
}

// State 是任务状态。
type State string

const (
	StateQueued           State = "queued"
	StateScanning         State = "scanning"
	StateAwaitingConflict State = "awaiting-conflict"
	StateRunning          State = "running"
	StateSucceeded        State = "succeeded"
	StatePartial          State = "partial"
	StateFailed           State = "failed"
	StateCancelled        State = "cancelled"
)

// IsTerminal 判断是否为终态。
func (s State) IsTerminal() bool {
	switch s {
	case StateSucceeded, StatePartial, StateFailed, StateCancelled:
		return true
	default:
		return false
	}
}

// Progress 是任务进度。字节数只在有明确总量时有意义。
type Progress struct {
	ItemsTotal  int    `json:"itemsTotal"`
	ItemsDone   int    `json:"itemsDone"`
	BytesTotal  int64  `json:"bytesTotal"`
	BytesDone   int64  `json:"bytesDone"`
	CurrentPath string `json:"currentPath,omitempty"`
}

// Stats 是逐条结果的汇总。
type Stats struct {
	Succeeded int `json:"succeeded"`
	Skipped   int `json:"skipped"`
	Renamed   int `json:"renamed"`
	Failed    int `json:"failed"`
	Conflict  int `json:"conflict"`
}

// Snapshot 是任务的对外快照。
type Snapshot struct {
	ID         string   `json:"id"`
	Kind       Kind     `json:"kind"`
	State      State    `json:"state"`
	FromPaths  []string `json:"fromPaths"`
	ToPath     string   `json:"toPath,omitempty"`
	IsMove     bool     `json:"isMove"`
	Progress   Progress `json:"progress"`
	Stats      Stats    `json:"stats"`
	Error      string   `json:"error,omitempty"`
	CanCancel  bool     `json:"canCancel"`
	CreatedAt  int64    `json:"createdAt"`
	StartedAt  int64    `json:"startedAt,omitempty"`
	FinishedAt int64    `json:"finishedAt,omitempty"`
}

// ConflictPayload 是冲突事件的载荷。
type ConflictPayload struct {
	DestPath   string             `json:"destPath"`
	IsMove     bool               `json:"isMove"`
	TotalCount int                `json:"totalCount"`
	Truncated  bool               `json:"truncated"`
	Conflicts  []fileops.Conflict `json:"conflicts"`
}

// EventType 是管理器向外发出的事件类型。
type EventType string

const (
	// EventCreated 在任务登记后立刻发一次完整快照。
	// 客户端只会通过 snapshot / created 认识一个任务，缺了它新任务就不会出现在界面里。
	EventCreated  EventType = "created"
	EventUpdate   EventType = "update"
	EventConflict EventType = "conflict"
	EventDone     EventType = "done"
)

// Event 是管理器向传输层发出的结构化事件。
type Event struct {
	Type     EventType
	Task     Snapshot
	Conflict *ConflictPayload
	Results  []fileops.ItemResult
	// ResultsTruncated 为 true 时 Results 只是前若干条，需要看 Stats 拿总数。
	ResultsTruncated bool
}

// ResolveRequest 是用户对冲突的决策。
type ResolveRequest struct {
	Policy     fileops.Policy
	ApplyToAll bool
	Items      map[string]fileops.Policy
}

type task struct {
	id        string
	kind      Kind
	fromPaths []string
	toPath    string
	isMove    bool
	duplicate bool

	onConflict fileops.Policy

	ctx    context.Context
	cancel context.CancelFunc

	mu       sync.Mutex
	state    State
	progress Progress
	stats    Stats
	errMsg   string
	// storedResults 是引擎返回的（有上限的）逐条结果，供失败清单与 Retry 使用。
	storedResults []fileops.ItemResult
	decisions     map[string]fileops.Policy
	createdAt     int64
	startedAt     int64
	finishedAt    int64
	// pendingConflict 保存最后一次冲突载荷，供新连接 / 重连的客户端补齐弹窗。
	pendingConflict *ConflictPayload

	resolved chan ResolveRequest
}

func newID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "t_" + hex.EncodeToString([]byte(time.Now().Format("150405.000")))
	}
	return "t_" + hex.EncodeToString(buf)
}

func (t *task) snapshot() Snapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.snapshotLocked()
}

func (t *task) snapshotLocked() Snapshot {
	from := make([]string, len(t.fromPaths))
	copy(from, t.fromPaths)
	return Snapshot{
		ID:         t.id,
		Kind:       t.kind,
		State:      t.state,
		FromPaths:  from,
		ToPath:     t.toPath,
		IsMove:     t.isMove,
		Progress:   t.progress,
		Stats:      t.stats,
		Error:      t.errMsg,
		CanCancel:  !t.state.IsTerminal(),
		CreatedAt:  t.createdAt,
		StartedAt:  t.startedAt,
		FinishedAt: t.finishedAt,
	}
}

func (t *task) setState(s State) {
	t.mu.Lock()
	if t.state == s {
		t.mu.Unlock()
		return
	}
	t.state = s
	if s == StateRunning && t.startedAt == 0 {
		t.startedAt = time.Now().UnixMilli()
	}
	if s.IsTerminal() && t.finishedAt == 0 {
		t.finishedAt = time.Now().UnixMilli()
	}
	t.mu.Unlock()
}

func (t *task) setTotals(items int, bytes int64) {
	t.mu.Lock()
	t.progress.ItemsTotal = items
	t.progress.BytesTotal = bytes
	t.mu.Unlock()
}

func (t *task) onProgress(itemsDone int, bytesDone int64, current string) {
	t.mu.Lock()
	t.progress.ItemsDone = itemsDone
	t.progress.BytesDone = bytesDone
	if current != "" {
		t.progress.CurrentPath = current
	}
	t.mu.Unlock()
}

// addResult 只做计数。逐条结果由引擎侧有上限地保存，避免同一批结果在内存里存两份。
func (t *task) addResult(r fileops.ItemResult) {
	t.mu.Lock()
	switch r.Status {
	case fileops.StatusFailed:
		t.stats.Failed++
	case fileops.StatusSkipped:
		t.stats.Skipped++
	case fileops.StatusRenamed:
		t.stats.Renamed++
	case fileops.StatusConflict:
		t.stats.Conflict++
	default:
		t.stats.Succeeded++
	}
	t.mu.Unlock()
}

// resultTotals 返回引擎实际产生的逐条结果总数（用于判断结果是否被截断）。
func (t *task) resultTotals() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stats.Failed + t.stats.Skipped + t.stats.Renamed + t.stats.Succeeded + t.stats.Conflict
}

func (t *task) fail(msg string) {
	t.mu.Lock()
	t.errMsg = msg
	t.mu.Unlock()
}

func (t *task) decisionsSnapshot() map[string]fileops.Policy {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.decisions) == 0 {
		return nil
	}
	out := make(map[string]fileops.Policy, len(t.decisions))
	for k, v := range t.decisions {
		out[k] = v
	}
	return out
}
