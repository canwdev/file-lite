package tasks

import (
	"context"
	"errors"
	"os"
	"sort"
	"sync"
	"time"

	"file-lite-go/fileops"
	"file-lite-go/utils"
)

// Options 是管理器的可调参数。
type Options struct {
	// Concurrency 是同时执行的任务数上限。
	Concurrency int
	// FileConcurrency 是单个任务内并行复制的文件数。
	FileConcurrency int
	// MaxCompleted 是保留的已完成任务条数。
	MaxCompleted int
	// ConflictTTL 是等待冲突决策的超时时间；超时后任务失败，绝不猜测策略。
	ConflictTTL time.Duration
}

// DefaultOptions 返回保守的默认值。
func DefaultOptions() Options {
	return Options{
		Concurrency:     2,
		FileConcurrency: 4,
		MaxCompleted:    100,
		ConflictTTL:     10 * time.Minute,
	}
}

// CreateParams 是创建任务的参数。
type CreateParams struct {
	Kind       Kind
	FromPaths  []string
	ToPath     string
	OnConflict fileops.Policy
}

// Manager 是所有任务的所有者。任务对所有已连接客户端可见、可取消。
type Manager struct {
	mu    sync.Mutex
	tasks map[string]*task
	order []string

	sem    chan struct{}
	engine *fileops.Engine
	opts   Options

	emitFn   func(Event)
	emitMu   sync.RWMutex
	stopCh   chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
}

// NewManager 创建管理器。engine 负责实际的文件操作。
func NewManager(engine *fileops.Engine, opts Options) *Manager {
	if opts.Concurrency <= 0 {
		opts.Concurrency = 2
	}
	if opts.FileConcurrency <= 0 {
		opts.FileConcurrency = 4
	}
	if opts.MaxCompleted <= 0 {
		opts.MaxCompleted = 100
	}
	if opts.ConflictTTL <= 0 {
		opts.ConflictTTL = 10 * time.Minute
	}
	return &Manager{
		tasks:  map[string]*task{},
		sem:    make(chan struct{}, opts.Concurrency),
		engine: engine,
		opts:   opts,
		stopCh: make(chan struct{}),
	}
}

// SetEmitter 注入事件出口（由传输层提供）。
func (m *Manager) SetEmitter(fn func(Event)) {
	m.emitMu.Lock()
	m.emitFn = fn
	m.emitMu.Unlock()
}

func (m *Manager) emit(ev Event) {
	m.emitMu.RLock()
	fn := m.emitFn
	m.emitMu.RUnlock()
	if fn != nil {
		fn(ev)
	}
}

// Start 启动进度节流循环。
func (m *Manager) Start() {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-m.stopCh:
				return
			case <-ticker.C:
				for _, t := range m.activeTasks() {
					m.emit(Event{Type: EventUpdate, Task: t.snapshot()})
				}
			}
		}
	}()
}

// Stop 取消所有任务并停止循环。
func (m *Manager) Stop() {
	m.stopOnce.Do(func() {
		close(m.stopCh)
		for _, t := range m.allTasks() {
			t.cancel()
		}
	})
	m.wg.Wait()
}

func (m *Manager) activeTasks() []*task {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*task, 0, len(m.order))
	for _, id := range m.order {
		t := m.tasks[id]
		if t == nil {
			continue
		}
		t.mu.Lock()
		state := t.state
		t.mu.Unlock()
		if !state.IsTerminal() {
			out = append(out, t)
		}
	}
	return out
}

func (m *Manager) allTasks() []*task {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*task, 0, len(m.order))
	for _, id := range m.order {
		if t := m.tasks[id]; t != nil {
			out = append(out, t)
		}
	}
	return out
}

// List 返回全部任务的快照（按创建时间升序）。
func (m *Manager) List() []Snapshot {
	tasks := m.allTasks()
	out := make([]Snapshot, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.snapshot())
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// Create 校验参数、登记任务并开始执行。
func (m *Manager) Create(params CreateParams) (Snapshot, error) {
	if !IsValidKind(params.Kind) {
		return Snapshot{}, errors.New("Unsupported task kind")
	}
	if len(params.FromPaths) == 0 {
		return Snapshot{}, errors.New("No source path")
	}
	for _, p := range params.FromPaths {
		if !fileops.IsPathSafe(p) {
			return Snapshot{}, errors.New("Path is not safe: " + p)
		}
	}

	isDelete := params.Kind == KindDelete
	if isDelete {
		if params.ToPath != "" {
			return Snapshot{}, errors.New("Delete does not take a destination")
		}
	} else {
		if params.ToPath == "" {
			return Snapshot{}, errors.New("No destination path")
		}
		if !fileops.IsPathSafe(params.ToPath) {
			return Snapshot{}, errors.New("Path is not safe: " + params.ToPath)
		}
		for _, p := range params.FromPaths {
			if !fileops.ExistsAt(p) {
				return Snapshot{}, errors.New("Source path does not exist: " + p)
			}
			// 目录不能复制 / 移动到自己的子树里
			if info, err := os.Lstat(p); err == nil && info.IsDir() && utils.IsPathInsideOrEqual(params.ToPath, p) {
				return Snapshot{}, errors.New("The destination folder is a subfolder of the source folder")
			}
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	t := &task{
		id:         newID(),
		kind:       params.Kind,
		fromPaths:  params.FromPaths,
		toPath:     params.ToPath,
		isMove:     params.Kind == KindMove,
		duplicate:  params.Kind == KindDuplicate,
		onConflict: fileops.NormalizePolicy(string(params.OnConflict)),
		ctx:        ctx,
		cancel:     cancel,
		state:      StateQueued,
		createdAt:  time.Now().UnixMilli(),
		resolved:   make(chan ResolveRequest, 1),
	}
	if t.duplicate {
		// 复制副本按「name - Copy」自动命名，不需要冲突决策
		t.onConflict = fileops.PolicyKeepBoth
	}

	m.mu.Lock()
	m.tasks[t.id] = t
	m.order = append(m.order, t.id)
	m.mu.Unlock()

	// 先广播 created 再启动执行，保证客户端在收到任何进度 patch 之前
	// 就已经认识这个任务（否则 patch 会因为「查无此任务」被丢掉）。
	snap := t.snapshot()
	m.emit(Event{Type: EventCreated, Task: snap})

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		m.run(t)
	}()
	return snap, nil
}

// Cancel 请求取消任务。
func (m *Manager) Cancel(id string) error {
	t := m.get(id)
	if t == nil {
		return errors.New("Task not found")
	}
	t.mu.Lock()
	state := t.state
	t.mu.Unlock()
	if state.IsTerminal() {
		return errors.New("Task already finished")
	}
	// awaitConflict 同时在监听 ctx.Done()，因此 cancel 就足以唤醒等待中的任务
	t.cancel()
	return nil
}

// Resolve 提交冲突决策。
func (m *Manager) Resolve(id string, req ResolveRequest) error {
	t := m.get(id)
	if t == nil {
		return errors.New("Task not found")
	}
	t.mu.Lock()
	state := t.state
	t.mu.Unlock()
	if state != StateAwaitingConflict {
		return errors.New("Task is not waiting for a conflict decision")
	}
	select {
	case t.resolved <- req:
		return nil
	default:
		return errors.New("Conflict already resolved")
	}
}

// Retry 用失败 / 冲突的条目重新创建一个任务。
//
// 路径取自服务端保存的结果（失败项上限见 fileops.maxStoredFailures = 500），
// 因此比 done 事件的 200 条上限更全，但并非无限；已经不存在（或已被别处处理）
// 的条目会被跳过。冲突项用 PolicyAsk 重试，这样运行期间才冒出来的冲突这次会正常弹窗让用户决策。
func (m *Manager) Retry(id string) (Snapshot, error) {
	t := m.get(id)
	if t == nil {
		return Snapshot{}, errors.New("Task not found")
	}

	t.mu.Lock()
	state := t.state
	results := make([]fileops.ItemResult, len(t.storedResults))
	copy(results, t.storedResults)
	kind := t.kind
	toPath := t.toPath
	t.mu.Unlock()

	if !state.IsTerminal() {
		return Snapshot{}, errors.New("Task is still running")
	}

	paths := make([]string, 0, len(results))
	seen := make(map[string]struct{}, len(results))
	for _, r := range results {
		if r.Status != fileops.StatusFailed && r.Status != fileops.StatusConflict {
			continue
		}
		if r.FromPath == "" {
			continue
		}
		if _, ok := seen[r.FromPath]; ok {
			continue
		}
		// 源已经不在了就没必要重试（例如另一个窗口已经处理掉）
		if !fileops.ExistsAt(r.FromPath) {
			continue
		}
		seen[r.FromPath] = struct{}{}
		paths = append(paths, r.FromPath)
	}
	if len(paths) == 0 {
		return Snapshot{}, errors.New("Nothing to retry")
	}

	return m.Create(CreateParams{
		Kind:       kind,
		FromPaths:  paths,
		ToPath:     toPath,
		OnConflict: fileops.PolicyAsk,
	})
}

// Dismiss 移除一个已结束的任务。
func (m *Manager) Dismiss(id string) error {
	m.mu.Lock()
	t := m.tasks[id]
	if t == nil {
		m.mu.Unlock()
		return errors.New("Task not found")
	}
	t.mu.Lock()
	state := t.state
	t.mu.Unlock()
	if !state.IsTerminal() {
		m.mu.Unlock()
		return errors.New("Task is still running")
	}
	delete(m.tasks, id)
	for i, oid := range m.order {
		if oid == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) get(id string) *task {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tasks[id]
}

func (m *Manager) pruneCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()
	completed := 0
	for _, id := range m.order {
		t := m.tasks[id]
		if t == nil {
			continue
		}
		t.mu.Lock()
		terminal := t.state.IsTerminal()
		t.mu.Unlock()
		if terminal {
			completed++
		}
	}
	if completed <= m.opts.MaxCompleted {
		return
	}
	excess := completed - m.opts.MaxCompleted
	kept := m.order[:0]
	for _, id := range m.order {
		t := m.tasks[id]
		if t == nil {
			continue
		}
		t.mu.Lock()
		terminal := t.state.IsTerminal()
		t.mu.Unlock()
		if terminal && excess > 0 {
			excess--
			delete(m.tasks, id)
			continue
		}
		kept = append(kept, id)
	}
	m.order = kept
}

// run 是任务的执行主体。
func (m *Manager) run(t *task) {
	// 全局并发闸门
	select {
	case m.sem <- struct{}{}:
	case <-t.ctx.Done():
		m.finish(t, StateCancelled, "")
		return
	case <-m.stopCh:
		m.finish(t, StateCancelled, "")
		return
	}
	defer func() { <-m.sem }()

	t.setState(StateScanning)
	m.emit(Event{Type: EventUpdate, Task: t.snapshot()})

	isDelete := t.kind == KindDelete
	if isDelete {
		total, err := fileops.ScanForDelete(t.ctx, t.fromPaths)
		if err != nil {
			m.finishFromContext(t)
			return
		}
		t.setTotals(total, 0)
	} else {
		scan, err := fileops.Scan(t.ctx, t.fromPaths, t.toPath)
		if err != nil {
			m.finishFromContext(t)
			return
		}
		t.setTotals(scan.ItemsTotal, scan.BytesTotal)

		if scan.ConflictTotal > 0 && t.onConflict == fileops.PolicyAsk {
			if terminal, msg := m.awaitConflict(t, scan); terminal != "" {
				m.finish(t, terminal, msg)
				return
			}
		}
	}

	t.setState(StateRunning)
	m.emit(Event{Type: EventUpdate, Task: t.snapshot()})

	opts := fileops.Options{
		FromPaths:       t.fromPaths,
		ToPath:          t.toPath,
		IsMove:          t.isMove,
		Duplicate:       t.duplicate,
		Policy:          t.onConflict,
		Decisions:       t.decisionsSnapshot(),
		FileConcurrency: m.opts.FileConcurrency,
	}
	results, err := m.engine.Run(t.ctx, opts, fileops.Callbacks{
		OnProgress: t.onProgress,
		OnResult:   t.addResult,
	})
	if err != nil && t.ctx.Err() == nil {
		m.finish(t, StateFailed, err.Error())
		return
	}

	m.finishFromContextOrResults(t, results)
}

// awaitConflict 暂停任务并等待用户决策。
// 返回 (terminal, msg)：terminal 非空表示任务应以该状态结束。
func (m *Manager) awaitConflict(t *task, scan fileops.ScanResult) (State, string) {
	t.setState(StateAwaitingConflict)
	payload := &ConflictPayload{
		DestPath:   t.toPath,
		IsMove:     t.isMove,
		TotalCount: scan.ConflictTotal,
		Truncated:  scan.Truncated,
		Conflicts:  scan.Conflicts,
	}
	t.mu.Lock()
	t.pendingConflict = payload
	t.mu.Unlock()
	m.emit(Event{Type: EventConflict, Task: t.snapshot(), Conflict: payload})

	timer := time.NewTimer(m.opts.ConflictTTL)
	defer timer.Stop()
	select {
	case req := <-t.resolved:
		if t.ctx.Err() != nil {
			return StateCancelled, ""
		}
		// 空请求来自 Cancel 的唤醒
		if req.Policy == "" && len(req.Items) == 0 && !req.ApplyToAll {
			return StateCancelled, ""
		}
		t.mu.Lock()
		if req.ApplyToAll && req.Policy != "" {
			t.onConflict = fileops.NormalizePolicy(string(req.Policy))
		}
		if len(req.Items) > 0 {
			if t.decisions == nil {
				t.decisions = map[string]fileops.Policy{}
			}
			for k, v := range req.Items {
				t.decisions[k] = fileops.NormalizePolicy(string(v))
			}
		}
		if !req.ApplyToAll && req.Policy != "" && len(req.Items) == 0 {
			t.onConflict = fileops.NormalizePolicy(string(req.Policy))
		}
		t.pendingConflict = nil
		t.mu.Unlock()
		return "", ""
	case <-timer.C:
		return StateFailed, "Conflict was not resolved in time"
	case <-t.ctx.Done():
		return StateCancelled, ""
	case <-m.stopCh:
		return StateCancelled, ""
	}
}

// finishFromContext 根据 ctx / stopCh 判定取消还是失败。
func (m *Manager) finishFromContext(t *task) {
	if t.ctx.Err() != nil {
		m.finish(t, StateCancelled, "")
		return
	}
	m.finish(t, StateFailed, "Operation aborted")
}

func (m *Manager) finish(t *task, state State, msg string) {
	t.mu.Lock()
	if t.errMsg == "" && msg != "" {
		t.errMsg = msg
	}
	t.mu.Unlock()
	m.emitDone(t, state, nil, false)
}

func (m *Manager) finishFromContextOrResults(t *task, results []fileops.ItemResult) {
	t.mu.Lock()
	stats := t.stats
	t.storedResults = results
	cancelled := t.ctx.Err() != nil
	t.mu.Unlock()

	state := StateSucceeded
	switch {
	case cancelled:
		state = StateCancelled
	case stats.Failed > 0 || stats.Conflict > 0:
		if stats.Succeeded == 0 && stats.Skipped == 0 && stats.Renamed == 0 {
			state = StateFailed
		} else {
			state = StatePartial
		}
	}

	// 引擎按「失败优先、各自限额」保留结果，这里再压到 WS 消息上限
	payload, capped := prioritizeResults(results, maxDoneResults)
	truncated := capped || t.resultTotals() > len(results)

	m.emitDone(t, state, payload, truncated)
}

// emitDone 是所有结束路径共用的收尾：落终态、广播一次 done、按上限清理历史。
func (m *Manager) emitDone(t *task, state State, results []fileops.ItemResult, truncated bool) {
	t.setState(state)
	m.emit(Event{Type: EventDone, Task: t.snapshot(), Results: results, ResultsTruncated: truncated})
	m.pruneCompleted()
}

// PendingConflict 描述一个仍在等待用户决策的任务。
type PendingConflict struct {
	TaskID  string
	Payload *ConflictPayload
}

// PendingConflicts 返回全部停在 await-conflict 的任务，
// 用于给新连接 / 重连的客户端补齐冲突弹窗。
func (m *Manager) PendingConflicts() []PendingConflict {
	out := []PendingConflict{}
	for _, t := range m.allTasks() {
		t.mu.Lock()
		if t.state == StateAwaitingConflict && t.pendingConflict != nil {
			out = append(out, PendingConflict{TaskID: t.id, Payload: t.pendingConflict})
		}
		t.mu.Unlock()
	}
	return out
}

// maxDoneResults 是 done 事件里携带的结果条数上限，避免超大结果集撑爆 WS。
const maxDoneResults = 200

// prioritizeResults 在截断结果集时优先保留失败 / 冲突项。
// 否则一个上万文件的复制任务里，出错的几条最容易落在截断之外，
// 前端只能看到「N failed」却查不到是哪些、为什么。
func prioritizeResults(results []fileops.ItemResult, limit int) ([]fileops.ItemResult, bool) {
	if len(results) <= limit {
		return results, false
	}
	important := make([]fileops.ItemResult, 0, limit)
	rest := make([]fileops.ItemResult, 0, len(results)-limit)
	for _, r := range results {
		if r.Status == fileops.StatusFailed || r.Status == fileops.StatusConflict {
			important = append(important, r)
		} else {
			rest = append(rest, r)
		}
	}
	out := important
	if len(out) > limit {
		return out[:limit], true
	}
	remain := limit - len(out)
	if remain > len(rest) {
		remain = len(rest)
	}
	out = append(out, rest[:remain]...)
	return out, true
}
