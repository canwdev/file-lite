package tasks

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"file-lite-go/fileops"
	"file-lite-go/sevenzip"
	"file-lite-go/utils"
)

func validateCompress(params *CreateParams) error {
	if params.Format == "" {
		params.Format = sevenzip.FormatZip
	}
	format, ok := sevenzip.LookupCompress(params.Format, sevenzip.CompressFormats())
	if !ok {
		return errors.New("Unsupported archive format")
	}
	params.Format = format.ID
	base := fileops.BaseName(params.ToPath)
	if base == "." || base == ".." || base == "" || utils.IsReservedTempName(base) || strings.ContainsAny(base, `/\`) {
		return errors.New("Invalid archive name")
	}
	if !strings.EqualFold(filepath.Ext(base), format.Ext) {
		return errors.New("Archive name must end with " + format.Ext)
	}
	if params.Password != "" && !format.Password {
		return errors.New("This format does not support a password")
	}
	parent := filepath.FromSlash(fileops.DirName(params.ToPath))
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return errors.New("Destination folder does not exist")
	}
	return nil
}

func validateExtract(params CreateParams) error {
	dest := filepath.FromSlash(params.ToPath)
	info, err := os.Stat(dest)
	if err != nil || !info.IsDir() {
		return errors.New("Destination is not a folder")
	}
	exts := sevenzip.ExtractExtensions()
	for _, p := range params.FromPaths {
		osPath := filepath.FromSlash(p)
		st, err := os.Lstat(osPath)
		if err != nil {
			return errors.New("Source path does not exist: " + p)
		}
		if st.IsDir() {
			return errors.New("Cannot extract a folder")
		}
		if len(exts) > 0 && !sevenzip.SupportedExtractExt(fileops.BaseName(p), exts) {
			return errors.New("Unsupported archive: " + fileops.BaseName(p))
		}
	}
	return nil
}

type archivePlan struct {
	archive    string
	osPath     string
	destDir    string
	madeDir    bool
	names      []sevenzip.ListedEntry
	listFailed bool
}

type extractCall struct {
	ao      string
	include []string // nil extracts the whole archive
}

// runArchive compresses or extracts with 7-Zip. The caller holds the task semaphore.
func (m *Manager) runArchive(t *task) {
	bin, ok := sevenzip.Binary()
	if !ok {
		m.finish(t, StateFailed, sevenzip.ErrUnavailable.Error())
		return
	}

	t.setState(StateScanning)
	t.setIndeterminate()
	m.emit(Event{Type: EventUpdate, Task: t.snapshot()})

	if t.kind == KindCompress {
		m.runCompress(t, bin)
		return
	}
	m.runExtract(t, bin)
}

func (m *Manager) runCompress(t *task, bin string) {
	dest := t.toPath
	osDest := filepath.FromSlash(dest)
	replaced := false
	if fileops.ExistsAt(osDest) {
		replaced = true
		name := fileops.BaseName(dest)
		if t.onConflict == fileops.PolicyAsk {
			scan := fileops.ScanResult{
				ConflictTotal: 1,
				Conflicts:     []fileops.Conflict{fileConflict(name, osDest)},
			}
			if terminal, msg := m.awaitConflict(t, scan); terminal != "" {
				m.finish(t, terminal, msg)
				return
			}
		}
		switch m.policyFor(t, name) {
		case fileops.PolicySkip:
			m.finishArchive(t, []fileops.ItemResult{{
				FromPath: t.fromPaths[0],
				ToPath:   dest,
				Status:   fileops.StatusSkipped,
			}}, nil, false)
			return
		case fileops.PolicyKeepBoth:
			dest = fileops.UniquePath(dest)
			t.mu.Lock()
			t.toPath = dest
			t.mu.Unlock()
			replaced = false
			osDest = filepath.FromSlash(dest)
		case fileops.PolicyOverwrite:
		default:
			m.finish(t, StateFailed, "Conflict was not resolved")
			return
		}
	}

	if err := t.ctx.Err(); err != nil {
		m.finish(t, StateCancelled, "")
		return
	}

	t.setState(StateRunning)
	t.setTotals(len(t.fromPaths), 0)
	t.setIndeterminate()
	m.emit(Event{Type: EventUpdate, Task: t.snapshot()})

	sources := make([]string, len(t.fromPaths))
	for i, p := range t.fromPaths {
		sources[i] = filepath.FromSlash(p)
	}
	err := sevenzip.Compress(t.ctx, bin, sources, osDest, t.format, t.password, t.setPercent)
	if errors.Is(err, context.Canceled) {
		m.finish(t, StateCancelled, "")
		return
	}
	var warn *sevenzip.WarningError
	if err != nil && !errors.As(err, &warn) {
		m.finish(t, StateFailed, archiveErrText(err))
		return
	}

	status := fileops.StatusCopied
	if replaced {
		status = fileops.StatusReplaced
	}
	result := fileops.ItemResult{FromPath: t.fromPaths[0], ToPath: dest, Status: status}
	partial := false
	if warn != nil {
		t.mu.Lock()
		t.errMsg = warn.Error()
		t.mu.Unlock()
		partial = true
	}
	m.finishArchive(t, []fileops.ItemResult{result}, []fileops.ItemResult{result}, partial)
}

func (m *Manager) runExtract(t *task, bin string) {
	parent := filepath.FromSlash(t.toPath)
	var plans []archivePlan
	var early []fileops.ItemResult
	var conflicts []fileops.Conflict

	for _, archive := range t.fromPaths {
		if err := t.ctx.Err(); err != nil {
			m.finish(t, StateCancelled, "")
			return
		}
		destDir, madeDir, err := extractDest(parent, archive, t.intoFolder)
		if err != nil {
			early = append(early, fileops.ItemResult{
				FromPath: archive,
				Status:   fileops.StatusFailed,
				Message:  err.Error(),
			})
			continue
		}
		osPath := filepath.FromSlash(archive)
		entries, err := sevenzip.List(t.ctx, bin, osPath, t.password)
		if errors.Is(err, context.Canceled) {
			m.finish(t, StateCancelled, "")
			return
		}
		if errors.Is(err, sevenzip.ErrWrongPassword) || errors.Is(err, sevenzip.ErrPasswordRequired) {
			removeExtractDir(destDir, madeDir)
			early = append(early, fileops.ItemResult{
				FromPath: archive,
				Status:   fileops.StatusFailed,
				Message:  archiveErrText(err),
			})
			continue
		}
		item := archivePlan{archive: archive, osPath: osPath, destDir: destDir, madeDir: madeDir}
		if err != nil {
			item.listFailed = true
			plans = append(plans, item)
			continue
		}
		item.names = sevenzip.TopLevelNames(entries)
		for _, name := range item.names {
			target := filepath.Join(destDir, name.Path)
			if c, ok := destConflict(name.Path, target, name.IsDir); ok {
				conflicts = append(conflicts, c)
			}
		}
		plans = append(plans, item)
	}

	if len(conflicts) > 0 && t.onConflict == fileops.PolicyAsk {
		scan := fileops.ScanResult{ConflictTotal: len(conflicts), Conflicts: conflicts}
		if terminal, msg := m.awaitConflict(t, scan); terminal != "" {
			m.finish(t, terminal, msg)
			return
		}
	}

	if len(plans) == 0 {
		m.finishArchive(t, early, nil, false)
		return
	}

	t.setState(StateRunning)
	t.setTotals(len(t.fromPaths), 0)
	t.setIndeterminate()
	m.emit(Event{Type: EventUpdate, Task: t.snapshot()})

	results := append([]fileops.ItemResult(nil), early...)
	refreshDir := false
	for i, item := range plans {
		if err := t.ctx.Err(); err != nil {
			m.finish(t, StateCancelled, "")
			return
		}
		destDir := item.destDir
		calls := m.extractCalls(t, destDir, item)
		if len(calls) == 0 {
			for _, name := range item.names {
				results = append(results, fileops.ItemResult{
					FromPath: item.archive,
					ToPath:   filepath.ToSlash(filepath.Join(destDir, name.Path)),
					Status:   fileops.StatusSkipped,
				})
			}
			continue
		}
		var callErr error
		for _, call := range calls {
			if call.ao == sevenzip.OverwriteRename {
				refreshDir = true
			}
			// 7-Zip creates a 0-byte file before it reports a bad password, and
			// -aoa truncates a file that is already there. Park those targets
			// so a failed extract does not leave them behind.
			undo := prepareExtract(destDir, call.ao, item.names, call.include)
			base := i * 100
			err := sevenzip.Extract(t.ctx, bin, item.osPath, destDir, t.password, call.ao, call.include, func(percent int) {
				overall := base + percent
				if n := len(plans); n > 1 {
					overall = (base + percent) / n
				}
				t.setPercent(overall)
			})
			if err != nil {
				var warn *sevenzip.WarningError
				if errors.As(err, &warn) {
					undo.commit()
				} else {
					undo.rollback()
				}
				callErr = err
				break
			}
			undo.commit()
		}
		if errors.Is(callErr, context.Canceled) {
			m.finish(t, StateCancelled, "")
			return
		}
		var warn *sevenzip.WarningError
		if callErr != nil && !errors.As(callErr, &warn) {
			removeExtractDir(item.destDir, item.madeDir)
			results = append(results, fileops.ItemResult{
				FromPath: item.archive,
				Status:   fileops.StatusFailed,
				Message:  archiveErrText(callErr),
			})
			continue
		}
		if warn != nil {
			t.mu.Lock()
			if t.errMsg == "" {
				t.errMsg = warn.Error()
			}
			t.mu.Unlock()
		}
		results = append(results, landedResults(item, destDir, calls)...)
		t.onProgress(i+1, 0, item.archive)
	}

	var top []fileops.ItemResult
	if !refreshDir {
		if t.intoFolder {
			top = folderTops(plans, results)
		} else {
			top = landedTop(results)
		}
	}
	m.finishArchive(t, results, top, t.hasErrMsg())
}

func extractDest(parent, archive string, intoFolder bool) (string, bool, error) {
	if !intoFolder {
		return parent, false, nil
	}
	name := sevenzip.StripExtractExt(fileops.BaseName(archive), sevenzip.ExtractExtensions())
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		name = "archive"
	}
	dir := filepath.Join(parent, name)
	if _, err := os.Lstat(dir); err == nil {
		return dir, false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", false, err
	}
	return dir, true, nil
}

func removeExtractDir(dir string, made bool) {
	if !made || dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) > 0 {
		return
	}
	_ = os.Remove(dir)
}

func folderTops(plans []archivePlan, results []fileops.ItemResult) []fileops.ItemResult {
	failed := map[string]struct{}{}
	for _, r := range results {
		if r.Status == fileops.StatusFailed {
			failed[r.FromPath] = struct{}{}
		}
	}
	var top []fileops.ItemResult
	seen := map[string]struct{}{}
	for _, item := range plans {
		if _, bad := failed[item.archive]; bad || item.destDir == "" {
			continue
		}
		slash := filepath.ToSlash(item.destDir)
		if _, ok := seen[slash]; ok {
			continue
		}
		seen[slash] = struct{}{}
		top = append(top, fileops.ItemResult{
			FromPath: item.archive,
			ToPath:   slash,
			Status:   fileops.StatusCopied,
		})
	}
	return top
}

// extractCalls picks 7-Zip overwrite flags for one archive.
// A uniform policy is one whole-archive invocation. Mixed policies become
// one invocation per flag, limited to the names that use it.
func (m *Manager) extractCalls(t *task, destDir string, item archivePlan) []extractCall {
	if item.listFailed || len(item.names) == 0 {
		return []extractCall{{ao: sevenzip.OverwriteAll}}
	}
	var skipN, overwriteN, renameN, fresh int
	var overwriteNames, renameNames, freshNames []string
	for _, name := range item.names {
		target := filepath.Join(destDir, name.Path)
		if _, exists := destConflict(name.Path, target, name.IsDir); !exists {
			fresh++
			freshNames = append(freshNames, name.Path)
			continue
		}
		switch m.policyFor(t, name.Path) {
		case fileops.PolicySkip:
			skipN++
		case fileops.PolicyKeepBoth:
			renameN++
			renameNames = append(renameNames, name.Path)
		default:
			overwriteN++
			overwriteNames = append(overwriteNames, name.Path)
		}
	}
	switch {
	case skipN == 0 && renameN == 0:
		return []extractCall{{ao: sevenzip.OverwriteAll}}
	case overwriteN == 0 && renameN == 0:
		if fresh == 0 {
			return nil
		}
		return []extractCall{{ao: sevenzip.OverwriteSkip}}
	case overwriteN == 0 && skipN == 0:
		return []extractCall{{ao: sevenzip.OverwriteRename}}
	default:
		var calls []extractCall
		keep := append(append([]string{}, freshNames...), overwriteNames...)
		if len(keep) > 0 {
			calls = append(calls, extractCall{ao: sevenzip.OverwriteAll, include: keep})
		}
		if len(renameNames) > 0 {
			calls = append(calls, extractCall{ao: sevenzip.OverwriteRename, include: renameNames})
		}
		return calls
	}
}

func landedResults(item archivePlan, destDir string, calls []extractCall) []fileops.ItemResult {
	if item.listFailed || len(item.names) == 0 {
		return []fileops.ItemResult{{
			FromPath: item.archive,
			ToPath:   filepath.ToSlash(destDir),
			Status:   fileops.StatusCopied,
		}}
	}
	var out []fileops.ItemResult
	for _, name := range item.names {
		osPath := filepath.Join(destDir, name.Path)
		rel := filepath.ToSlash(osPath)
		if !fileops.ExistsAt(osPath) {
			out = append(out, fileops.ItemResult{
				FromPath: item.archive,
				ToPath:   rel,
				Status:   fileops.StatusSkipped,
			})
			continue
		}
		status := fileops.StatusCopied
		for _, call := range calls {
			if call.include != nil && !containsName(call.include, name.Path) {
				continue
			}
			if call.ao == sevenzip.OverwriteRename {
				status = fileops.StatusRenamed
			}
		}
		out = append(out, fileops.ItemResult{FromPath: item.archive, ToPath: rel, Status: status})
	}
	return out
}

func landedTop(results []fileops.ItemResult) []fileops.ItemResult {
	var top []fileops.ItemResult
	for _, r := range results {
		switch r.Status {
		case fileops.StatusCopied, fileops.StatusReplaced, fileops.StatusRenamed:
			top = append(top, r)
		}
	}
	return top
}

func containsName(list []string, name string) bool {
	for _, item := range list {
		if item == name {
			return true
		}
	}
	return false
}

// extractUndo puts aside files a failed 7-Zip extract must not leave behind.
// remove lists paths that did not exist before the call. restore lists
// existing files renamed out of the way so -aoa cannot truncate them.
type extractUndo struct {
	remove  []string
	restore [][2]string
}

func prepareExtract(destDir, ao string, names []sevenzip.ListedEntry, include []string) extractUndo {
	var undo extractUndo
	for _, name := range names {
		if name.Path == "" || name.Path == "." || name.Path == ".." {
			continue
		}
		if include != nil && !containsName(include, name.Path) {
			continue
		}
		path := filepath.Join(destDir, name.Path)
		info, err := os.Lstat(path)
		if err != nil {
			undo.remove = append(undo.remove, path)
			continue
		}
		if ao != sevenzip.OverwriteAll || (name.IsDir && info.IsDir()) {
			continue
		}
		bak := filepath.Join(destDir, utils.TempFilePrefix+"undo-"+strconv.Itoa(len(undo.restore))+"-"+strconv.FormatInt(time.Now().UnixNano(), 36))
		if err := os.Rename(path, bak); err != nil {
			continue
		}
		undo.remove = append(undo.remove, path)
		undo.restore = append(undo.restore, [2]string{bak, path})
	}
	return undo
}

func (u extractUndo) rollback() {
	for _, path := range u.remove {
		_ = os.RemoveAll(path)
	}
	for _, pair := range u.restore {
		_ = os.RemoveAll(pair[1])
		_ = os.Rename(pair[0], pair[1])
	}
}

func (u extractUndo) commit() {
	for _, pair := range u.restore {
		_ = os.RemoveAll(pair[0])
	}
}

func (m *Manager) policyFor(t *task, rel string) fileops.Policy {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.decisions != nil {
		if p, ok := t.decisions[rel]; ok {
			return fileops.NormalizePolicy(string(p))
		}
	}
	if t.onConflict == fileops.PolicyAsk {
		return fileops.PolicySkip
	}
	return t.onConflict
}

func (t *task) hasErrMsg() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.errMsg != ""
}

func (m *Manager) finishArchive(t *task, results []fileops.ItemResult, top []fileops.ItemResult, partial bool) {
	if t.ctx.Err() != nil {
		m.emitDone(t, StateCancelled, nil, false, nil)
		return
	}
	for _, r := range results {
		t.addResult(r)
	}
	t.mu.Lock()
	t.storedResults = append([]fileops.ItemResult(nil), results...)
	stats := t.stats
	t.mu.Unlock()

	state := StateSucceeded
	switch {
	case stats.Failed > 0 && stats.Succeeded == 0 && stats.Skipped == 0 && stats.Renamed == 0:
		state = StateFailed
	case partial || stats.Failed > 0 || stats.Conflict > 0:
		state = StatePartial
	}
	m.emitDone(t, state, results, false, top)
}

func archiveErrText(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, sevenzip.ErrWrongPassword) {
		return "Wrong password"
	}
	if errors.Is(err, sevenzip.ErrPasswordRequired) {
		return "Password required"
	}
	msg := err.Error()
	if len(msg) > 300 {
		return msg[:300]
	}
	return msg
}

func fileConflict(rel, osDest string) fileops.Conflict {
	c := fileops.Conflict{
		RelativePath: rel,
		Kind:         fileops.ConflictFileVsFile,
	}
	info, err := os.Lstat(osDest)
	if err != nil {
		return c
	}
	size := info.Size()
	c.DestSize = &size
	c.DestIsDirectory = info.IsDir()
	c.DestMtime = info.ModTime().UnixMilli()
	if info.IsDir() {
		c.Kind = fileops.ConflictFileVsDir
	}
	return c
}

func destConflict(rel, osDest string, sourceIsDir bool) (fileops.Conflict, bool) {
	info, err := os.Lstat(osDest)
	if err != nil {
		return fileops.Conflict{}, false
	}
	destIsDir := info.IsDir()
	if sourceIsDir && destIsDir {
		return fileops.Conflict{}, false
	}
	c := fileops.Conflict{
		RelativePath:      rel,
		SourceIsDirectory: sourceIsDir,
		DestIsDirectory:   destIsDir,
	}
	switch {
	case !sourceIsDir && !destIsDir:
		c.Kind = fileops.ConflictFileVsFile
	case !sourceIsDir && destIsDir:
		c.Kind = fileops.ConflictFileVsDir
	default:
		c.Kind = fileops.ConflictDirVsFile
	}
	size := info.Size()
	c.DestSize = &size
	c.DestMtime = info.ModTime().UnixMilli()
	return c, true
}
