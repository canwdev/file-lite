package sevenzip

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"file-lite-go/utils"
)

// FormatZip is the default compress type. Other ids are the `-t` values 7-Zip
// reports as creatable.
const FormatZip = "zip"

// Overwrite mode flags passed to 7-Zip as -ao{mode}.
const (
	OverwriteAll    = "a"
	OverwriteSkip   = "s"
	OverwriteRename = "u"
)

// ListedEntry is one item inside an archive, as reported by `7z l -slt`.
type ListedEntry struct {
	Path  string
	IsDir bool
}

// Compress packs sources into a zip at dest. The bytes are written to a
// sibling temporary file and renamed into place only after 7-Zip exits
// successfully. Cancel deletes that temporary file.
func Compress(ctx context.Context, bin string, sources []string, dest, format, password string, onPercent func(int)) error {
	if bin == "" {
		return ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	listDir, rels, err := collectInputs(sources)
	if err != nil {
		return err
	}
	list, err := writeListFile(rels)
	if err != nil {
		return err
	}
	defer os.Remove(list)

	tmp, err := tempZipPath(dest)
	if err != nil {
		return err
	}
	defer func() {
		if tmp != "" {
			_ = os.Remove(tmp)
		}
	}()

	if format == "" {
		format = FormatZip
	}
	args := compressArgs(tmp, list, format, password)
	code, stderr, runErr := runFn(ctx, bin, listDir, args, onPercent)
	if err := classifyRun(ctx, code, stderr, runErr, password); err != nil {
		var warn *WarningError
		if !errors.As(err, &warn) {
			return err
		}
		// A warning still leaves a usable archive when 7-Zip created one.
		if _, statErr := os.Stat(tmp); statErr != nil {
			return err
		}
		if renErr := publishTemp(tmp, dest); renErr != nil {
			return renErr
		}
		tmp = ""
		return err
	}
	if err := publishTemp(tmp, dest); err != nil {
		return err
	}
	tmp = ""
	return nil
}

// Extract unpacks archive into destDir. ao is OverwriteAll, OverwriteSkip, or
// OverwriteRename. include limits extraction to those archive paths; empty
// means the whole archive.
func Extract(ctx context.Context, bin, archive, destDir, password, ao string, include []string, onPercent func(int)) error {
	if bin == "" {
		return ErrUnavailable
	}
	if ao == "" {
		ao = OverwriteAll
	}
	args := extractArgs(archive, destDir, password, ao, include)
	code, stderr, runErr := runFn(ctx, bin, "", args, onPercent)
	return classifyRun(ctx, code, stderr, runErr, password)
}

// List reads archive entries. A wrong password is ErrWrongPassword. Other
// list failures are returned as-is so the caller can still try extracting
// (header-encrypted archives often cannot be listed).
func List(ctx context.Context, bin, archive, password string) ([]ListedEntry, error) {
	if bin == "" {
		return nil, ErrUnavailable
	}
	args := listArgs(archive, password)
	code, stderr, runErr := runFn(ctx, bin, "", args, nil)
	if err := classifyRun(ctx, code, stderr, runErr, password); err != nil {
		var warn *WarningError
		if errors.As(err, &warn) {
			return parseListSLT(stderr), nil
		}
		return nil, err
	}
	return parseListSLT(stderr), nil
}

func compressArgs(dest, listfile, format, password string) []string {
	if format == "" {
		format = FormatZip
	}
	args := []string{
		"a",
		"-t" + format,
		"-bsp2",
		"-bb3",
		"-y",
		"-sccUTF-8",
		"-scsUTF-8",
		"-spd",
	}
	if password != "" {
		switch format {
		case FormatZip:
			args = append(args, "-mem=AES256")
		case "7z":
			args = append(args, "-mhe=on")
		}
		args = append(args, "-p"+password)
	}
	// `@listfile` must stay before `--`: `--` also stops listfile parsing.
	args = append(args, dest, "@"+listfile)
	return args
}

func extractArgs(archive, destDir, password, ao string, include []string) []string {
	args := []string{
		"x",
		"-bsp2",
		"-bb3",
		"-y",
		"-sccUTF-8",
		"-spd",
		"-ao" + ao,
		"-o" + destDir,
	}
	if password != "" {
		args = append(args, "-p"+password)
	}
	args = append(args, "--", archive)
	args = append(args, include...)
	return args
}

func listArgs(archive, password string) []string {
	args := []string{"l", "-slt", "-sccUTF-8", "-y"}
	if password != "" {
		args = append(args, "-p"+password)
	}
	args = append(args, "--", archive)
	return args
}

func writeListFile(lines []string) (string, error) {
	f, err := os.CreateTemp("", "file-lite-7z-*.txt")
	if err != nil {
		return "", err
	}
	name := f.Name()
	var b strings.Builder
	for _, line := range lines {
		if line == "" {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	if b.Len() == 0 {
		f.Close()
		os.Remove(name)
		return "", errors.New("No files to compress")
	}
	if _, err := f.WriteString(b.String()); err != nil {
		f.Close()
		os.Remove(name)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

// collectInputs walks sources, drops reserved temporary names, and returns a
// working directory plus paths relative to it. Relative paths keep the
// selected file or folder name inside the archive, and -spd can stay on so
// names that contain wildcard characters are not expanded.
func collectInputs(sources []string) (string, []string, error) {
	if len(sources) == 0 {
		return "", nil, errors.New("No files to compress")
	}
	root := commonParent(sources)
	var rels []string
	for _, src := range sources {
		if utils.IsReservedTempName(filepath.Base(src)) {
			continue
		}
		err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if utils.IsReservedTempName(d.Name()) {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if rel == "." {
				return nil
			}
			if d.IsDir() {
				has, err := dirHasListedContent(path)
				if err != nil {
					return err
				}
				if has {
					return nil
				}
			}
			rels = append(rels, rel)
			return nil
		})
		if err != nil {
			return "", nil, err
		}
	}
	if len(rels) == 0 {
		return "", nil, errors.New("No files to compress")
	}
	return root, rels, nil
}

func dirHasListedContent(path string) (bool, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if utils.IsReservedTempName(entry.Name()) {
			continue
		}
		return true, nil
	}
	return false, nil
}

func commonParent(paths []string) string {
	base := filepath.Dir(filepath.Clean(paths[0]))
	for _, p := range paths[1:] {
		base = commonAncestor(base, filepath.Dir(filepath.Clean(p)))
	}
	return base
}

func commonAncestor(a, b string) string {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	for {
		if a == b || pathInside(a, b) {
			return a
		}
		if pathInside(b, a) {
			return b
		}
		next := filepath.Dir(a)
		if next == a {
			return b
		}
		a = next
	}
}

func pathInside(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func tempZipPath(dest string) (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	ext := filepath.Ext(dest)
	if ext == "" {
		ext = ".zip"
	}
	return filepath.Join(filepath.Dir(dest), utils.TempFilePrefix+hex.EncodeToString(buf)+ext), nil
}

func publishTemp(tmp, dest string) error {
	if _, err := os.Stat(tmp); err != nil {
		return fmt.Errorf("7-Zip did not create the archive")
	}
	if err := os.Remove(dest); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(tmp, dest)
}

// parseListSLT reads `7z l -slt` output. The first record is the archive itself.
func parseListSLT(output string) []ListedEntry {
	var entries []ListedEntry
	var cur *ListedEntry
	flush := func() {
		if cur == nil || cur.Path == "" {
			cur = nil
			return
		}
		entries = append(entries, *cur)
		cur = nil
	}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		key, val, ok := strings.Cut(line, " = ")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch key {
		case "Path":
			flush()
			cur = &ListedEntry{Path: val}
		case "Folder":
			if cur != nil {
				cur.IsDir = val == "+"
			}
		}
	}
	flush()
	if len(entries) == 0 {
		return nil
	}
	// The first Path record is the archive. Drop it.
	return entries[1:]
}

// TopLevelNames collapses listing paths to the first segment that lands in
// the destination directory. isDir is true when that segment is itself a
// directory or contains children.
func TopLevelNames(entries []ListedEntry) []ListedEntry {
	type acc struct {
		isDir bool
		order int
	}
	seen := map[string]*acc{}
	var order []string
	for _, e := range entries {
		name := topSegment(e.Path)
		if name == "" || name == "." || name == ".." {
			continue
		}
		item, ok := seen[name]
		if !ok {
			item = &acc{order: len(order)}
			seen[name] = item
			order = append(order, name)
		}
		if e.IsDir || strings.Contains(strings.ReplaceAll(e.Path, "\\", "/"), "/") {
			item.isDir = true
		}
	}
	out := make([]ListedEntry, 0, len(order))
	for _, name := range order {
		out = append(out, ListedEntry{Path: name, IsDir: seen[name].isDir})
	}
	return out
}

func topSegment(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		return ""
	}
	if i := strings.IndexByte(p, '/'); i >= 0 {
		return p[:i]
	}
	return p
}
