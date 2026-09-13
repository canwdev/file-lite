// Package updater 实现后端的自更新：校验上传的新二进制，替换当前可执行文件，
// 然后把进程交给它。
//
// 文件替换本身交给 github.com/minio/selfupdate：Windows 不允许覆盖运行中的 exe，
// 它先把旧文件改名、再换入新文件、失败时回滚。本包补上它不负责的三件事：
//   - 记住真实的 exe 路径 / argv / cwd（改名之后 os.Executable() 会漂，而重启必须原样继承它们）；
//   - 校验上传的文件能在本机跑起来（真的执行一次 --version）；
//   - 交接进程：Unix 用 syscall.Exec 原地接替，Windows 起一个分离子进程再退出。
package updater

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	miniselfupdate "github.com/minio/selfupdate"

	"file-lite-go/config"
)

// maxBinarySize 是允许上传的二进制大小上限。发布出来的二进制约 18 MB。
const maxBinarySize = 128 << 20

var (
	exePath string
	exeArgs []string
	exeCwd  string
)

// Init 必须在任何文件替换之前调用一次：exe 一旦被改名，os.Executable() 就可能返回 .old。
func Init() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	// 符号链接（如 /usr/local/bin/file-lite -> /opt/...）：替换真正的目标文件，让链接保持有效。
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	exePath = exe
	exeArgs = append([]string(nil), os.Args...)
	exeCwd, _ = os.Getwd()
	return nil
}

// Cleanup 删除上一次更新留下的临时文件：Windows 上正在运行的旧二进制当场删不掉
// （selfupdate 会隐藏它），只能等新进程起来后再清。失败不是错误，下次启动还会再试。
func Cleanup() {
	if exePath == "" {
		return
	}
	dir, base := filepath.Dir(exePath), filepath.Base(exePath)
	for _, name := range []string{"." + base + ".old", "." + base + ".new"} {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if err := os.Remove(p); err == nil {
			fmt.Printf("update: removed leftover %s\n", p)
		}
	}
}

// Install 把上传内容暂存到 exe 同目录、确认它能在本机运行，然后替换当前可执行文件。
// 返回新二进制自报的版本号。任何一步失败都不会碰正在运行的进程，调用方随后调用 Restart。
func Install(r io.Reader) (string, error) {
	if exePath == "" {
		return "", fmt.Errorf("executable path is unknown")
	}
	// 多读 1 字节用来发现「超限」，同时把内存缓冲封顶。
	if err := miniselfupdate.PrepareAndCheckBinary(io.LimitReader(r, maxBinarySize+1), options()); err != nil {
		discard()
		return "", fmt.Errorf("write binary: %w", err)
	}
	st, err := os.Stat(stagedPath())
	if err != nil {
		discard()
		return "", err
	}
	if st.Size() > maxBinarySize {
		discard()
		return "", fmt.Errorf("binary is larger than %d MB", maxBinarySize>>20)
	}

	version, err := runVersion(stagedPath())
	if err != nil {
		discard()
		return "", err
	}

	if err := miniselfupdate.CommitBinary(options()); err != nil {
		if rbErr := miniselfupdate.RollbackError(err); rbErr != nil {
			return "", fmt.Errorf("replace executable: %v (rollback failed: %v)", err, rbErr)
		}
		return "", fmt.Errorf("replace executable: %w", err)
	}
	return version, nil
}

// shutdown 由 main 注入：优雅停止 HTTP 服务，让新进程能立刻绑定同一个端口。
var shutdown = func() {}

func SetShutdown(fn func()) {
	if fn != nil {
		shutdown = fn
	}
}

// Restart 先停服，再用原来的 argv / 环境变量 / 工作目录把进程交给当前的可执行文件。
// 两个调用方：换完文件之后（Install 成功），以及只想重载配置的原地重启。
// 无论哪种，都必须在 HTTP 响应已经发出去之后调用。
func Restart() error {
	if exePath == "" {
		return fmt.Errorf("executable path is unknown")
	}
	shutdown()
	return restartProcess()
}

// Stop 只停服不交接，供「退出后端」用。调用方随后结束进程。
func Stop() { shutdown() }

func options() miniselfupdate.Options {
	return miniselfupdate.Options{TargetPath: exePath, TargetMode: 0o755}
}

// stagedPath 与 selfupdate 内部约定一致（.<name>.new），必须与 exe 同目录，rename 才是原子的。
func stagedPath() string {
	if exePath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(exePath), "."+filepath.Base(exePath)+".new")
}

func discard() {
	if p := stagedPath(); p != "" {
		_ = os.Remove(p)
	}
}

var versionPattern = regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(config.PkgName) + ` v(\d+\.\d+\.\d+)\s*$`)

// runVersion 直接执行上传的文件。--version 在 main 里先于加载配置处理，
// 所以这次执行没有副作用，同时又是「它能在这台机器上跑」的最强证据。
func runVersion(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("uploaded file cannot run on this machine: %w", err)
	}
	version, ok := parseVersion(string(out))
	if !ok {
		return "", fmt.Errorf("uploaded file is not %s (unexpected --version output)", config.PkgName)
	}
	return version, nil
}

// parseVersion 从 `file-lite-go v1.5.0` 里取出 1.5.0；不匹配返回 false。
func parseVersion(out string) (string, bool) {
	m := versionPattern.FindStringSubmatch(out)
	if m == nil {
		return "", false
	}
	return m[1], true
}
