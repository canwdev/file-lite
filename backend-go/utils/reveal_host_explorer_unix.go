//go:build !windows

package utils

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func toNativePath(p string) string {
	p = filepath.FromSlash(p)
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return filepath.Clean(p)
}

func groupByParentDir(paths []string) map[string][]string {
	groups := make(map[string][]string)
	seen := make(map[string]struct{})
	for _, p := range paths {
		resolved := toNativePath(p)
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		parent := filepath.Dir(resolved)
		groups[parent] = append(groups[parent], resolved)
	}
	return groups
}

func revealDarwin(paths []string) error {
	for _, files := range groupByParentDir(paths) {
		if len(files) == 0 {
			continue
		}
		if err := exec.Command("open", "-R", files[0]).Start(); err != nil {
			return err
		}
	}
	return nil
}

func revealLinux(paths []string) error {
	uris := make([]string, 0, len(paths))
	seen := make(map[string]struct{})
	for _, p := range paths {
		abs := toNativePath(p)
		if !strings.HasPrefix(abs, "/") {
			abs = "/" + abs
		}
		uri := "file://" + filepath.ToSlash(abs)
		if _, ok := seen[uri]; ok {
			continue
		}
		seen[uri] = struct{}{}
		uris = append(uris, uri)
	}

	err := exec.Command("dbus-send",
		"--session",
		"--print-reply",
		"--dest=org.freedesktop.FileManager1",
		"/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1.ShowItems",
		"array:string:"+strings.Join(uris, ","),
		"string:",
	).Run()
	if err == nil {
		return nil
	}

	for parentDir := range groupByParentDir(paths) {
		if openErr := exec.Command("xdg-open", parentDir).Start(); openErr != nil {
			return openErr
		}
	}
	return nil
}

// RevealInHostExplorer reveals paths in the host file manager.
func RevealInHostExplorer(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("paths parameter is required")
	}
	if runtime.GOOS == "darwin" {
		return revealDarwin(paths)
	}
	return revealLinux(paths)
}
