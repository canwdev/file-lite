package fileops

import (
	"errors"
	"io"
	"os"
	"strings"
	"time"
)

// PublishOptions 控制原子发布的收尾处理。
type PublishOptions struct {
	// Mode 非零时在发布前对齐权限。
	Mode os.FileMode
	// Mtime 非零时在发布前对齐修改时间。
	Mtime time.Time
	// Fsync 为 true 时在改名之前 fsync 临时文件，保证断电也不会出现
	// 「已改名但内容还没落盘」的文件。
	Fsync bool
}

// PublishFile 是「目标同目录临时文件 + 原子改名」的唯一实现。
//
// 复制和上传都必须走这里，保证磁盘上永远不存在半个文件：写入过程中进程被杀、
// write 返回错误、或请求被中断，目标路径都不会出现半成品。
//
// 进程被强杀时可能留下一个孤儿临时文件（前缀 .fl-part-，列表与 zip 都会过滤掉，
// 用户看不见）。不做全局账本去扫它：那需要每复制一个文件多写一次账本，
// 实测让小文件复制慢一倍，而收益只是清理一个看不见的文件。
func PublishFile(dst string, opts PublishOptions, write func(w io.Writer) error) error {
	tmp := tempPathFor(dst)

	// 底层错误会带上临时文件名。临时文件是实现细节，不该出现在用户看到的报错里，
	// 所以统一把消息里的临时路径换回目标路径。
	hideTemp := func(err error) error {
		if err == nil {
			return nil
		}
		msg := err.Error()
		if !strings.Contains(msg, tmp) {
			return err
		}
		return errors.New(strings.ReplaceAll(msg, tmp, dst))
	}

	published := false
	defer func() {
		if !published {
			_ = os.Remove(tmp)
		}
	}()

	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return hideTemp(err)
	}

	if err := write(out); err != nil {
		_ = out.Close()
		return hideTemp(err)
	}
	if opts.Fsync {
		if err := out.Sync(); err != nil {
			_ = out.Close()
			return hideTemp(err)
		}
	}
	if err := out.Close(); err != nil {
		return hideTemp(err)
	}

	// 先对齐最终形态，再发布：目标一出现就是完整的
	if opts.Mode != 0 {
		_ = os.Chmod(tmp, opts.Mode.Perm())
	}
	if !opts.Mtime.IsZero() {
		_ = os.Chtimes(tmp, opts.Mtime, opts.Mtime)
	}

	if err := os.Rename(tmp, dst); err != nil {
		return hideTemp(err)
	}
	published = true
	return nil
}
