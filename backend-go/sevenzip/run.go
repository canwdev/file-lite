package sevenzip

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// ErrWrongPassword is returned when 7-Zip reports a bad password.
// Exit code 2 alone is not enough: it is the generic fatal error.
var ErrWrongPassword = errors.New("Wrong password")

// ErrPasswordRequired is returned when 7-Zip stops to ask for a password.
// That happens for an encrypted archive when the task was started without one.
var ErrPasswordRequired = errors.New("Password required")

// ErrUnavailable is returned when the 7-Zip binary cannot be found.
var ErrUnavailable = errors.New("7-Zip is not available")

// WarningError is a non-fatal 7-Zip exit (code 1). The archive operation
// still produced its output.
type WarningError struct {
	Message string
}

func (e *WarningError) Error() string {
	if e.Message == "" {
		return "7-Zip finished with a warning"
	}
	return e.Message
}

// RunFunc executes 7-Zip. dir is the process working directory; empty keeps the
// server's current directory. Tests replace the function.
type RunFunc func(ctx context.Context, bin, dir string, args []string, onPercent func(int)) (exitCode int, stderr string, err error)

var runFn RunFunc = realRun

// SetRunnerForTest replaces process execution. Pass nil to restore the real runner.
func SetRunnerForTest(fn RunFunc) {
	if fn == nil {
		runFn = realRun
		return
	}
	runFn = fn
}

func realRun(ctx context.Context, bin, dir string, args []string, onPercent func(int)) (int, string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	hideConsole(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return 0, "", err
	}
	if err := cmd.Start(); err != nil {
		return 0, "", err
	}

	// Stdout must be drained or 7-Zip blocks once the pipe fills.
	outDone := make(chan struct{})
	var stdoutBuf bytes.Buffer
	go func() {
		_, _ = io.Copy(&stdoutBuf, stdout)
		close(outDone)
	}()

	writer := &progressWriter{onChange: onPercent}
	errDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(writer, stderr)
		close(errDone)
	}()

	waitErr := cmd.Wait()
	<-outDone
	<-errDone

	text := writer.Text()
	if stdoutBuf.Len() > 0 {
		// Fatal messages sometimes land on stdout. Keep them for classification.
		text = stdoutBuf.String() + "\n" + text
	}
	code := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			code = exitErr.ExitCode()
		} else if ctx.Err() == nil {
			return code, text, waitErr
		}
	}
	if ctx.Err() != nil {
		return code, text, ctx.Err()
	}
	return code, text, nil
}

func classifyRun(ctx context.Context, code int, stderr string, runErr error, password string) error {
	stderr = redact(stderr, password)
	if ctx.Err() != nil || errors.Is(runErr, context.Canceled) {
		return context.Canceled
	}
	if runErr != nil && code == 0 {
		return runErr
	}
	if wrongPassword(stderr) {
		return ErrWrongPassword
	}
	if passwordPrompt(stderr) {
		return ErrPasswordRequired
	}
	switch code {
	case 0:
		return nil
	case 1:
		msg := errorLine(stderr)
		if msg == "" {
			msg = "7-Zip finished with a warning"
		}
		return &WarningError{Message: msg}
	case 7:
		msg := errorLine(stderr)
		if msg == "" {
			msg = "7-Zip rejected the command"
		}
		return fmt.Errorf("%s", msg)
	case 8:
		return errors.New("7-Zip ran out of memory")
	default:
		msg := errorLine(stderr)
		if msg == "" {
			msg = fmt.Sprintf("7-Zip failed (%d)", code)
		}
		return fmt.Errorf("%s", msg)
	}
}

func wrongPassword(stderr string) bool {
	return strings.Contains(strings.ToLower(stderr), "wrong password")
}

func passwordPrompt(stderr string) bool {
	return strings.Contains(strings.ToLower(stderr), "enter password")
}

func redact(s, password string) string {
	if password == "" || s == "" {
		return s
	}
	return strings.ReplaceAll(s, password, "****")
}
