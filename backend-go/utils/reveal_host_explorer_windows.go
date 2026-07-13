//go:build windows

package utils

import (
	"fmt"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	coinitApartmentThreaded = 0x2
	sOK                     = 0
	sFalse                  = 1
	rpcEChangedMode         = 0x80010106
)

var (
	modOle32                       = syscall.NewLazyDLL("ole32.dll")
	procCoInitializeEx             = modOle32.NewProc("CoInitializeEx")
	procCoUninitialize             = modOle32.NewProc("CoUninitialize")
	modShell32                     = syscall.NewLazyDLL("shell32.dll")
	procILCreateFromPathW          = modShell32.NewProc("ILCreateFromPathW")
	procSHOpenFolderAndSelectItems = modShell32.NewProc("SHOpenFolderAndSelectItems")
	procILFree                     = modShell32.NewProc("ILFree")
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

func ilCreateFromPath(path string) (uintptr, error) {
	ptr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	pidl, _, _ := procILCreateFromPathW.Call(uintptr(unsafe.Pointer(ptr)))
	if pidl == 0 {
		return 0, fmt.Errorf("ILCreateFromPathW failed: %s", path)
	}
	return pidl, nil
}

func openAndSelect(parentDir string, files []string) error {
	if len(files) == 0 {
		return fmt.Errorf("no files to select")
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if hr != sOK && hr != sFalse && hr != rpcEChangedMode {
		return fmt.Errorf("CoInitializeEx HRESULT=0x%x", hr)
	}
	if hr == sOK || hr == sFalse {
		defer procCoUninitialize.Call()
	}

	if len(files) == 1 {
		pidl, err := ilCreateFromPath(files[0])
		if err != nil {
			return err
		}
		defer procILFree.Call(pidl)
		hr, _, _ = procSHOpenFolderAndSelectItems.Call(pidl, 0, 0, 0)
		if hr != sOK {
			return fmt.Errorf("SHOpenFolderAndSelectItems HRESULT=0x%x", hr)
		}
		return nil
	}

	dirPidl, err := ilCreateFromPath(parentDir)
	if err != nil {
		return err
	}
	defer procILFree.Call(dirPidl)

	filePidls := make([]uintptr, len(files))
	for i, f := range files {
		pidl, err := ilCreateFromPath(f)
		if err != nil {
			for j := 0; j < i; j++ {
				procILFree.Call(filePidls[j])
			}
			return err
		}
		filePidls[i] = pidl
	}
	defer func() {
		for _, pidl := range filePidls {
			procILFree.Call(pidl)
		}
	}()

	hr, _, _ = procSHOpenFolderAndSelectItems.Call(
		dirPidl,
		uintptr(len(filePidls)),
		uintptr(unsafe.Pointer(&filePidls[0])),
		0,
	)
	if hr != sOK {
		return fmt.Errorf("SHOpenFolderAndSelectItems HRESULT=0x%x", hr)
	}
	return nil
}

// RevealInHostExplorer opens Explorer and selects paths; falls back to opening parent dirs.
func RevealInHostExplorer(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("paths parameter is required")
	}
	for parentDir, files := range groupByParentDir(paths) {
		if err := openAndSelect(parentDir, files); err != nil {
			if fallbackErr := Opener(parentDir); fallbackErr != nil {
				return fallbackErr
			}
		}
	}
	return nil
}
