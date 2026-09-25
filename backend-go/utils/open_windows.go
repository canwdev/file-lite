//go:build windows

package utils

import "golang.org/x/sys/windows"

// Opener opens a URL or path with the system default handler.
//
// ShellExecuteW hands the target straight to the shell and never builds a
// cmd.exe command line, so a path containing cmd metacharacters (& | ^ < > …)
// cannot inject a command. `cmd /c start <path>` could: Go's argument escaping
// targets CommandLineToArgvW, while cmd.exe parses the line itself, and paths
// reach here from user-supplied file and folder names.
func Opener(target string) error {
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, nil, file, nil, nil, windows.SW_SHOWNORMAL)
}
