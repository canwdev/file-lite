//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"

	"github.com/mattn/go-isatty"
	"golang.org/x/sys/windows"

	"file-lite-go/utils"
)

const (
	// DETACHED_PROCESS: the new process inherits no console.
	detachedProcess = 0x00000008
	// CREATE_NEW_CONSOLE: the new process gets a console window of its own.
	createNewConsole = 0x00000010
	// CREATE_NEW_PROCESS_GROUP: the parent exiting or receiving Ctrl+C does not
	// reach the new process. Only used on the detached path: the flag also
	// disables Ctrl+C for the new process group, and an interactive terminal
	// must keep it.
	createNewProcessGroup = 0x00000200
)

// startedInTerminal reports whether this process was launched from a terminal
// window, so the restart should hand a window to its successor. A process
// started by double-clicking the exe, or from cmd / Windows Terminal, has a
// console on stdin; a service, or a process started by an earlier detached
// restart, reads the null device.
//
// Only stdin is checked, matching the TUI decision in main: the window that a
// restart must preserve is the one the interactive menu is drawn in. The
// console window itself is not inspected — under ConPTY (Windows Terminal) it
// belongs to the terminal, not to this process.
func startedInTerminal() bool {
	fd := os.Stdin.Fd()
	return isatty.IsTerminal(fd) || isatty.IsCygwinTerminal(fd)
}

// restartProcess starts the new binary and lets the caller exit: Windows has no
// exec, so the process image cannot be replaced in place.
//
// A process that was started from a terminal gets a fresh console window, so
// the user keeps a terminal (and the TUI) after the restart. A process that was
// already running without a console stays detached and invisible.
func restartProcess() error {
	args := exeArgs
	if len(args) > 0 {
		args = args[1:]
	}
	if startedInTerminal() {
		err := startInConsole(args)
		if err == nil {
			return nil
		}
		// The service must come up even when a window cannot be created (no
		// interactive desktop, a locked-down session): fall back to the
		// background handoff instead of leaving the port closed.
		utils.LogWarnf("restart: cannot open a console window: %v", err)
	}
	return startDetached(args)
}

// startDetached is the background handoff: no console, no visible window.
func startDetached(args []string) error {
	cmd := exec.Command(exePath, args...)
	// The data directory defaults to cwd, so another working directory would
	// mean another config.
	cmd.Dir = exeCwd
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGroup,
		HideWindow:    true,
	}
	// No standard streams: the inherited console dies with the parent, and Go
	// connects them to the null device.
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", exePath, err)
	}
	return nil
}

// startInConsole opens a console window for the new process.
//
// exec.Cmd cannot do this: it always sets STARTF_USESTDHANDLES (to the null
// device when no stream is set), which would give the fresh window no output
// and leave the new process without a terminal, so it would start without the
// TUI. CreateProcess without that flag connects the standard handles to the
// console it allocates.
func startInConsole(args []string) error {
	appName, err := windows.UTF16PtrFromString(exePath)
	if err != nil {
		return err
	}
	commandLine, err := windows.UTF16PtrFromString(quoteCommandLine(append([]string{exePath}, args...)))
	if err != nil {
		return err
	}
	var cwd *uint16
	if exeCwd != "" {
		if cwd, err = windows.UTF16PtrFromString(exeCwd); err != nil {
			return err
		}
	}

	si := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{}))}
	var pi windows.ProcessInformation
	// A nil environment block makes the child inherit this process's
	// environment, the same set exec.Cmd would pass explicitly.
	if err := windows.CreateProcess(appName, commandLine, nil, nil, false,
		createNewConsole, nil, cwd, &si, &pi); err != nil {
		return fmt.Errorf("start %s: %w", exePath, err)
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}

// quoteCommandLine joins argv the way the CRT and Go parse it back.
func quoteCommandLine(argv []string) string {
	var b strings.Builder
	for i, arg := range argv {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(syscall.EscapeArg(arg))
	}
	return b.String()
}
