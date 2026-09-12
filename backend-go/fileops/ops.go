package fileops

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"file-lite-go/utils"
)

// ItemStatus 是单个条目的处理结果。
type ItemStatus string

const (
	StatusCopied   ItemStatus = "copied"
	StatusMoved    ItemStatus = "moved"
	StatusDeleted  ItemStatus = "deleted"
	StatusReplaced ItemStatus = "replaced"
	StatusSkipped  ItemStatus = "skipped"
	StatusRenamed  ItemStatus = "renamed"
	StatusFailed   ItemStatus = "failed"
	// StatusConflict 表示执行期间才发现的冲突（预扫描之后目标被别处创建）。
	// 出于安全不会覆盖，直接跳过并如实上报。
	StatusConflict ItemStatus = "conflict"
)

// ItemResult 是单个条目的结果。
type ItemResult struct {
	FromPath string     `json:"fromPath"`
	ToPath   string     `json:"toPath,omitempty"`
	Status   ItemStatus `json:"status"`
	Message  string     `json:"message,omitempty"`
}

// Options 描述一次复制 / 移动 / 删除。
type Options struct {
	FromPaths []string
	ToPath    string
	IsMove    bool
	// Duplicate 为 true 时按「name - Copy」命名，不询问、不覆盖。
	Duplicate bool
	// Policy 是默认冲突策略。
	Policy Policy
	// Decisions 是按相对路径覆盖的逐项决策（来自弹窗里的单条选择）。
	Decisions       map[string]Policy
	FileConcurrency int
}

// Callbacks 是执行期回调。OnProgress 会被调用得很频繁（大文件每个读块一次），
// 实现必须足够轻量；节流由 tasks 层负责。
type Callbacks struct {
	OnProgress func(itemsDone int, bytesDone int64, currentPath string)
	OnResult   func(ItemResult)
}

// 内存里保留的结果条数上限。失败 / 冲突与成功项分开计数，
// 这样大量成功项不会把失败项挤掉——失败清单与「Try Again」只依赖失败项。
// 一次百万文件的复制不应该把百万条结果一直留在内存里。
const (
	maxStoredFailures  = 500
	maxStoredSuccesses = 500
)

// Engine 执行文件操作。
type Engine struct {
	// fsync 决定原子改名之前是否 fsync 临时文件。
	fsync bool
}

// NewEngine 创建执行器。
func NewEngine(fsync bool) *Engine {
	return &Engine{fsync: fsync}
}

// Run 执行一次复制 / 移动 / 删除，返回逐条结果。
// 只有「整体性失败」（取消、参数问题）才返回 error；单项失败记录在结果里。
func (e *Engine) Run(ctx context.Context, opts Options, cb Callbacks) ([]ItemResult, error) {
	if opts.FileConcurrency <= 0 {
		opts.FileConcurrency = 4
	}
	if len(opts.FromPaths) == 0 {
		return nil, errors.New("No source path")
	}

	rs := &runState{
		ctx:    ctx,
		opts:   opts,
		cb:     cb,
		engine: e,
		sem:    make(chan struct{}, opts.FileConcurrency),
	}

	if opts.Policy == "" {
		opts.Policy = PolicyAsk
	}

	if opts.ToPath == "" {
		// 删除
		for _, p := range opts.FromPaths {
			if err := ctx.Err(); err != nil {
				break
			}
			if !IsPathSafe(p) {
				rs.record(ItemResult{FromPath: p, Status: StatusFailed, Message: "Path is not safe"})
				continue
			}
			if err := removeAllCtx(ctx, p, func() { rs.addItem(1, p) }); err != nil {
				rs.record(ItemResult{FromPath: p, Status: StatusFailed, Message: err.Error()})
			} else {
				rs.record(ItemResult{FromPath: p, Status: StatusDeleted})
			}
		}
		rs.wg.Wait()
		return rs.resultsSnapshot(), nil
	}

	for _, src := range opts.FromPaths {
		if err := ctx.Err(); err != nil {
			break
		}
		if !IsPathSafe(src) || !IsPathSafe(opts.ToPath) {
			rs.record(ItemResult{FromPath: src, Status: StatusFailed, Message: "Path is not safe"})
			continue
		}
		if !ExistsAt(src) {
			rs.record(ItemResult{FromPath: src, Status: StatusFailed, Message: "Source path does not exist"})
			continue
		}
		dst := filepath.Join(opts.ToPath, BaseName(src))
		if opts.Duplicate {
			// 复制副本落在源旁边、用新名字，因此整棵树都不会有冲突
			dst = DuplicatePath(src)
		}
		if err := rs.processEntry(src, dst, BaseName(src)); err != nil {
			rs.record(ItemResult{FromPath: src, Status: StatusFailed, Message: err.Error()})
		}
	}
	rs.wg.Wait()
	return rs.resultsSnapshot(), nil
}

// RemoveEntrySafely 删除路径。若路径是链接（符号链接 / Windows 目录链接 /
// 硬链接），只删除链接本身，绝不递归删除其指向的内容。
func RemoveEntrySafely(p string) error {
	li, err := os.Lstat(p)
	if err != nil {
		return err
	}
	isLink := li.Mode()&os.ModeSymlink != 0
	if !isLink && !li.IsDir() && utils.HardLinkCount(li, p) > 1 {
		isLink = true
	}
	if isLink {
		return os.Remove(p)
	}
	return os.RemoveAll(p)
}

type runState struct {
	ctx  context.Context
	opts Options
	cb   Callbacks

	engine *Engine

	mu              sync.Mutex
	results         []ItemResult
	storedFailures  int
	storedSuccesses int
	itemsDone       int
	bytesDone       int64

	sem chan struct{}
	wg  sync.WaitGroup
}

func (rs *runState) record(r ItemResult) {
	rs.mu.Lock()
	// 有上限地保留：失败 / 冲突单独限额，保证它们不会被成功项挤掉
	if r.Status == StatusFailed || r.Status == StatusConflict {
		if rs.storedFailures < maxStoredFailures {
			rs.results = append(rs.results, r)
			rs.storedFailures++
		}
	} else if rs.storedSuccesses < maxStoredSuccesses {
		rs.results = append(rs.results, r)
		rs.storedSuccesses++
	}
	rs.mu.Unlock()
	if rs.cb.OnResult != nil {
		rs.cb.OnResult(r)
	}
}

func (rs *runState) resultsSnapshot() []ItemResult {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	out := make([]ItemResult, len(rs.results))
	copy(out, rs.results)
	return out
}

func (rs *runState) addItem(n int, current string) {
	rs.mu.Lock()
	rs.itemsDone += n
	done := rs.itemsDone
	bytes := rs.bytesDone
	rs.mu.Unlock()
	if rs.cb.OnProgress != nil {
		rs.cb.OnProgress(done, bytes, current)
	}
}

func (rs *runState) addBytes(n int64, current string) {
	rs.mu.Lock()
	rs.bytesDone += n
	done := rs.itemsDone
	bytes := rs.bytesDone
	rs.mu.Unlock()
	if rs.cb.OnProgress != nil {
		rs.cb.OnProgress(done, bytes, current)
	}
}

func (rs *runState) policyFor(relPath string) Policy {
	if rs.opts.Decisions != nil {
		if p, ok := rs.opts.Decisions[relPath]; ok {
			return p
		}
	}
	return rs.opts.Policy
}

// resolvePolicy 在真的撞上冲突时决定目标路径。
// 返回 (finalDst, proceed, status)；proceed=false 时条目被跳过 / 上报冲突。
func (rs *runState) resolvePolicy(relPath, srcPath, dstPath string) (string, bool, ItemStatus) {
	if !ExistsAt(dstPath) {
		return dstPath, true, ""
	}

	srcInfo, srcErr := os.Lstat(srcPath)
	dstInfo, dstErr := os.Lstat(dstPath)
	bothKnown := srcErr == nil && dstErr == nil
	if bothKnown && srcInfo.IsDir() && dstInfo.IsDir() {
		// Windows 语义：同名目录静默合并，冲突留到内部的叶子节点再判定
		return dstPath, true, ""
	}

	switch rs.policyFor(relPath) {
	case PolicySkip:
		return dstPath, false, StatusSkipped
	case PolicyKeepBoth:
		return UniquePath(dstPath), true, StatusRenamed
	case PolicyOverwrite:
		// 文件 vs 文件不需要预先删除：临时文件 rename 会原子替换。
		// 类型不同（文件 vs 目录）时 rename 顶不掉目录，必须先移除目标。
		if bothKnown && srcInfo.IsDir() != dstInfo.IsDir() {
			if err := RemoveEntrySafely(dstPath); err != nil {
				return dstPath, false, StatusFailed
			}
		}
		return dstPath, true, StatusReplaced
	default: // PolicyAsk
		return dstPath, false, StatusConflict
	}
}

// defaultStatus 把「没有冲突」的空状态归一化为实际动作。
func (rs *runState) defaultStatus(status ItemStatus) ItemStatus {
	if status != "" {
		return status
	}
	if rs.opts.IsMove {
		return StatusMoved
	}
	return StatusCopied
}

func (rs *runState) processEntry(srcPath, dstPath, relPath string) error {
	if err := rs.ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(srcPath)
	if err != nil {
		rs.record(ItemResult{FromPath: srcPath, Status: StatusFailed, Message: err.Error()})
		return nil
	}

	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return rs.processFile(srcPath, dstPath, relPath, info)
	}
	return rs.processDir(srcPath, dstPath, relPath)
}

func (rs *runState) processFile(srcPath, dstPath, relPath string, info os.FileInfo) error {
	finalDst, proceed, status := rs.resolvePolicy(relPath, srcPath, dstPath)
	if !proceed {
		// 被跳过 / 待决策的条目也要计入进度，否则总进度永远到不了 100%
		rs.addItem(1, srcPath)
		rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: status})
		return nil
	}
	if status == StatusFailed {
		rs.addItem(1, srcPath)
		rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusFailed, Message: "Failed to replace destination"})
		return nil
	}
	status = rs.defaultStatus(status)

	if rs.opts.IsMove && !rs.opts.Duplicate {
		// 同分区 rename 是原子且瞬时的；跨分区才回退到复制 + 删除
		if err := os.Rename(srcPath, finalDst); err == nil {
			rs.addItem(1, srcPath)
			if !info.IsDir() {
				rs.addBytes(info.Size(), srcPath)
			}
			rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: movedStatus(status)})
			return nil
		} else if !errors.Is(err, syscall.EXDEV) {
			rs.addItem(1, srcPath)
			rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: StatusFailed, Message: err.Error()})
			return nil
		}
	}

	return rs.scheduleCopy(srcPath, finalDst, status, info)
}

// scheduleCopy 在受并发闸门约束的 goroutine 里完成「复制 + （移动时）删除源」。
// 走闸门而不是无限制起 goroutine，避免十万个小文件时把内存吃满。
func (rs *runState) scheduleCopy(srcPath, dstPath string, status ItemStatus, info os.FileInfo) error {
	select {
	case rs.sem <- struct{}{}:
	case <-rs.ctx.Done():
		return rs.ctx.Err()
	}
	rs.wg.Add(1)
	go func() {
		defer rs.wg.Done()
		defer func() { <-rs.sem }()

		if err := rs.engineCopy(srcPath, dstPath); err != nil {
			rs.addItem(1, srcPath)
			rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusFailed, Message: err.Error()})
			return
		}
		if rs.opts.IsMove {
			if err := RemoveEntrySafely(srcPath); err != nil {
				rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusFailed, Message: "Copied but failed to remove source: " + err.Error()})
				return
			}
		}
		rs.addItem(1, srcPath)
		if !info.IsDir() {
			rs.addBytes(info.Size(), srcPath)
		}
		rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: status})
	}()
	return nil
}

func (rs *runState) processDir(srcPath, dstPath, relPath string) error {
	if rs.opts.IsMove && !rs.opts.Duplicate && !ExistsAt(dstPath) {
		// 整棵目录同分区改名：瞬时完成
		if err := os.Rename(srcPath, dstPath); err == nil {
			items, bytes := countFiles(rs.ctx, dstPath)
			rs.addItemsAndBytes(items, bytes, srcPath)
			rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusMoved})
			return nil
		} else if !errors.Is(err, syscall.EXDEV) {
			rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusFailed, Message: err.Error()})
			return nil
		}
	}

	finalDst, proceed, status := rs.resolvePolicy(relPath, srcPath, dstPath)
	if !proceed {
		items, bytes := countFiles(rs.ctx, srcPath)
		rs.addItemsAndBytes(items, bytes, srcPath)
		rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: status})
		return nil
	}
	if status == StatusFailed {
		items, bytes := countFiles(rs.ctx, srcPath)
		rs.addItemsAndBytes(items, bytes, srcPath)
		rs.record(ItemResult{FromPath: srcPath, ToPath: dstPath, Status: StatusFailed, Message: "Failed to replace destination"})
		return nil
	}
	status = rs.defaultStatus(status)

	if err := os.MkdirAll(finalDst, 0755); err != nil {
		rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: StatusFailed, Message: err.Error()})
		return nil
	}
	entries, err := os.ReadDir(srcPath)
	if err != nil {
		rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: StatusFailed, Message: err.Error()})
		return nil
	}
	for _, e := range entries {
		if err := rs.ctx.Err(); err != nil {
			return err
		}
		childRel := e.Name()
		if relPath != "" {
			childRel = relPath + "/" + e.Name()
		}
		if err := rs.processEntry(filepath.Join(srcPath, e.Name()), filepath.Join(finalDst, e.Name()), childRel); err != nil {
			return err
		}
	}
	if rs.opts.IsMove {
		if err := os.Remove(srcPath); err != nil {
			rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: StatusFailed, Message: "Failed to remove source directory: " + err.Error()})
			return nil
		}
		rs.record(ItemResult{FromPath: srcPath, ToPath: finalDst, Status: status})
	}
	return nil
}

func (rs *runState) addItemsAndBytes(items int, bytes int64, current string) {
	if items == 0 {
		return
	}
	rs.mu.Lock()
	rs.itemsDone += items
	rs.bytesDone += bytes
	done := rs.itemsDone
	total := rs.bytesDone
	rs.mu.Unlock()
	if rs.cb.OnProgress != nil {
		rs.cb.OnProgress(done, total, current)
	}
}

func (rs *runState) engineCopy(srcPath, dstPath string) error {
	return copyFileAtomic(rs.ctx, srcPath, dstPath, rs)
}

func movedStatus(status ItemStatus) ItemStatus {
	if status == StatusReplaced || status == StatusRenamed {
		return status
	}
	return StatusMoved
}

// countFiles 统计子树里的文件数与字节数（目录不计入）。
func countFiles(ctx context.Context, p string) (int, int64) {
	info, err := os.Lstat(p)
	if err != nil {
		return 0, 0
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return 1, info.Size()
	}
	total := 0
	var bytes int64
	entries, err := os.ReadDir(p)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if ctx.Err() != nil {
			break
		}
		n, b := countFiles(ctx, filepath.Join(p, e.Name()))
		total += n
		bytes += b
	}
	return total, bytes
}

// copyFileAtomic 通过 PublishFile 发布目标文件，保证磁盘上永远不存在半个文件。
func copyFileAtomic(ctx context.Context, srcPath, dstPath string, rs *runState) error {
	info, err := os.Lstat(srcPath)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return copyLinkSafely(srcPath, dstPath)
	}

	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()

	fsync := false
	if rs != nil && rs.engine != nil {
		fsync = rs.engine.fsync
	}

	return PublishFile(dstPath, PublishOptions{
		Mode:  info.Mode(),
		Mtime: info.ModTime(),
		Fsync: fsync,
	}, func(w io.Writer) error {
		var dst io.Writer = w
		if rs != nil {
			dst = &progressWriter{dst: w, rs: rs, current: srcPath}
		}
		_, err := io.Copy(dst, ctxReader{ctx: ctx, r: in})
		return err
	})
}

func copyLinkSafely(srcPath, dstPath string) error {
	target, err := os.Readlink(srcPath)
	if err != nil {
		return err
	}
	if ExistsAt(dstPath) {
		if err := RemoveEntrySafely(dstPath); err != nil {
			return err
		}
	}
	return os.Symlink(target, dstPath)
}

type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c ctxReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}

type progressWriter struct {
	dst     io.Writer
	rs      *runState
	current string
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.dst.Write(p)
	if n > 0 {
		w.rs.addBytes(int64(n), w.current)
	}
	return n, err
}

// removeAllCtx 是可取消的递归删除，沿用「链接只删链接本身」的语义。
func removeAllCtx(ctx context.Context, p string, count func()) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	isLink := info.Mode()&os.ModeSymlink != 0
	if !isLink && !info.IsDir() && utils.HardLinkCount(info, p) > 1 {
		isLink = true
	}
	if isLink || !info.IsDir() {
		if err := os.Remove(p); err != nil {
			return err
		}
		count()
		return nil
	}

	entries, err := os.ReadDir(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := removeAllCtx(ctx, filepath.Join(p, e.Name()), count); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Remove(p); err != nil {
		return err
	}
	count()
	return nil
}
