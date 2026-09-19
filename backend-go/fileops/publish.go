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
	// NetworkTarget 表示目标在网络位置上（SMB / NFS / 对象存储挂载…）。
	//
	// 网络位置上「原子发布」这一层我们照旧做——目标路径不出现半个文件，
	// 与本地卷是同一个保证，rename 本身在 SMB / NFS 上也几乎免费。让路的只是两处
	// **每次都是一轮网络往返、换来的却很少**的收尾：
	//
	//   - fsync：它保的是「断电后已改名的文件内容也在盘上」。走网络协议写出去的数据，
	//     对端收到即安全（SMB/NFS 关闭即提交，rclone 的 VFS 缓存等关闭后写回），
	//     再补一次同步上传保护的是一个基本不存在的窗口，代价却是一次完整往返。
	//   - 发布前的 chmod / chtimes：对象存储根本没有权限位，这次调用纯属往返。
	//
	// **权限改成在创建临时文件时就带上**（本机卷仍是「先 0600 写、发布前再 chmod」）。
	// 这一点必须做对：临时文件默认是 0600，若只是跳过 chmod，SMB / NFS 上发布出来的
	// 文件就会变成「仅所有者可读写」——而共享环境里别人读不到恰恰是它的用途。
	//
	// 由此付出的代价很窄、也很明确：**网络位置上断电后，已改名的文件内容未必已落盘**。
	// 进程被杀不受影响（内核继续写回）；只有掉电 / 内核崩溃才会体现。
	NetworkTarget bool
}

// syncBeforePublish 是发布前那次 fsync 的唯一入口。
//
// 抽成变量是给测试用的：网络目标「跳过 fsync」这件事从文件内容上看不出来，
// 只能从这里观察。生产路径上就是 (*os.File).Sync。
var syncBeforePublish = func(f *os.File) error { return f.Sync() }

// PublishFile 是「目标同目录临时文件 + 原子改名」的唯一实现。
//
// 复制和上传都必须走这里，保证磁盘上永远不存在半个文件：写入过程中进程被杀、
// write 返回错误、或请求被中断，目标路径都不会出现半成品。
//
// 改名之前 fsync 临时文件：否则断电后可能出现「已经叫最终名字、内容却没落盘」的文件，
// 那比慢一点糟得多。这一步在本机卷上恒开（曾经是可配的 copyFsync，后来固定为开）；
// 网络位置上跳过，理由与代价见 PublishOptions.NetworkTarget。
//
// 进程被强杀时可能留下一个孤儿临时文件（前缀 .fl-part-，列表与 zip 都会过滤掉，
// 用户看不见）。不做全局账本去扫它：那需要每复制一个文件多写一次账本，
// 实测让小文件复制慢一倍，而收益只是清理一个看不见的文件。
func PublishFile(dst string, opts PublishOptions, write func(w io.Writer) error) error {
	tmp := tempPathFor(dst)
	network := opts.NetworkTarget

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

	// 本机卷先按 0600 创建、发布前再 chmod 成最终权限（避免写入期间就有宽权限）；
	// 网络位置反过来：直接用最终权限创建，省掉那次 chmod，也不会把文件发成 0600。
	createMode := os.FileMode(0600)
	if network && opts.Mode != 0 {
		createMode = opts.Mode.Perm()
	}

	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, createMode)
	if err != nil {
		return hideTemp(err)
	}

	if err := write(out); err != nil {
		_ = out.Close()
		return hideTemp(err)
	}
	if !network {
		if err := syncBeforePublish(out); err != nil {
			_ = out.Close()
			return hideTemp(err)
		}
	}
	if err := out.Close(); err != nil {
		return hideTemp(err)
	}

	// 先对齐最终形态，再发布：目标一出现就是完整的。
	// 网络位置上权限已经在创建时带上，这里只剩时间——见 PublishOptions.NetworkTarget。
	if !network {
		if opts.Mode != 0 {
			_ = os.Chmod(tmp, opts.Mode.Perm())
		}
		if !opts.Mtime.IsZero() {
			_ = os.Chtimes(tmp, opts.Mtime, opts.Mtime)
		}
	}

	if err := os.Rename(tmp, dst); err != nil {
		return hideTemp(err)
	}
	published = true
	return nil
}
