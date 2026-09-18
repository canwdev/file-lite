package routes

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"syscall"

	"github.com/labstack/echo/v4"

	"file-lite-go/fileops"
)

// 本文件把文件系统错误翻译成 HTTP 状态码。
//
// 存在的理由只有一个，但它是硬需求：**「服务器不可达」和「文件不存在」不能报成同一个
// 状态码**。网络位置（UNC / WSL / 映射盘符）离线时，内核层面报的是 ETIMEDOUT /
// EHOSTDOWN 之类，如果按 os.IsNotExist 的落空路径统一成 404，用户会以为自己的文件
// 被删了——而实际上只要共享恢复就还能读到。所以：
//
//	404  只有内核明确说 ENOENT / ENOTDIR（路径真的不存在）
//	503  目标在网络上且这次访问失败（可重试；Retry-After 也给了）
//	500  其余（本机卷上的权限、IO 错误等，重试没有意义）
//
// 判断顺序很重要：先看错误本身，再看「路径是不是网络位置」。反过来的话，UNC 上一个
// 真的不存在的文件会被报成 503，用户永远等不到「这个文件没了」这个正确答案。

// resolvePath 是所有文件操作入口的统一解析。
//
// 取代了原来的 fileops.IsPathSafe：路径先 canonical 化（分隔符、重复斜杠、"." / ".."），
// 再匹配挂载点。**不做访问控制**——解析不到挂载点的绝对路径照样通过（见 fileops.Resolve）。
//
// 非法路径（相对路径、越根）返回 400。这是相对旧行为的一处变化：以前这类路径会被原样
// 交给 os.Stat，于是报的是 404/500，用户看到的是「文件不存在」而不是「路径不合法」。
func resolvePath(raw string) (fileops.Resolved, *echo.HTTPError) {
	res, err := fileops.Resolve(raw)
	if err != nil {
		// 不回显整条路径：错误信息里只有规则，没有用户输入。
		return fileops.Resolved{}, echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return res, nil
}

// isNotFound 判断内核是否明确说「路径不存在」。
//
// 只认 ENOENT / ENOTDIR：os.IsNotExist 会顺带把「父目录不可达」也算进去，而在网络
// 位置上那正是需要与「不存在」区分开的情况。
func isNotFound(err error) bool {
	return errors.Is(err, fs.ErrNotExist) ||
		errors.Is(err, syscall.ENOENT) ||
		errors.Is(err, syscall.ENOTDIR)
}

// isTransientIOError 判断错误是否属于「过一会儿再来」的类型。
//
// 连接被拒 / 主机不可达 / 超时 / 重传超时——在 NFS、SMB、9p 上这些是共享离线或卡住的
// 典型表现，也是用户重试一次就可能成功的唯一一类。权限（EACCES）不在其中：那不是暂时的。
func isTransientIOError(err error) bool {
	for _, target := range []error{
		syscall.ETIMEDOUT,
		syscall.ECONNREFUSED,
		syscall.ECONNRESET,
		syscall.EHOSTDOWN,
		syscall.EHOSTUNREACH,
		syscall.ENETUNREACH,
		syscall.ENETDOWN,
		syscall.ENETRESET,
		syscall.EPIPE,
		os.ErrDeadlineExceeded,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

// fsErrorStatus 把一次文件系统访问失败映射成状态码与给用户看的话。
//
// network 由调用方从 fileops.Resolved.Network() 取：只有解析过的路径才知道自己是不是
// 落在网络位置上（Z: 和 /mnt/c 在形态上看都是本机路径）。
func fsErrorStatus(err error, network bool) (int, string) {
	switch {
	case isNotFound(err):
		return http.StatusNotFound, "Path not found"
	case network && isTransientIOError(err):
		return http.StatusServiceUnavailable, "Network location is unreachable"
	case network:
		// 网络位置上的其余错误（共享被卸载、认证失败…）同样属于「可能是暂时的」，
		// 但对本机卷来说 500 才是诚实的答案。
		return http.StatusServiceUnavailable, "Failed to access the network location"
	default:
		return http.StatusInternalServerError, "Failed to read the path"
	}
}

// jsonFSError 写出一个已经定好状态码的错误响应，并带上 Retry-After 供客户端退避。
func jsonFSError(c echo.Context, status int, message string) error {
	if status == http.StatusServiceUnavailable {
		// 给前端一个明确的「可以重试」信号，而不是让它自己猜。
		c.Response().Header().Set("Retry-After", "3")
	}
	return c.JSON(status, map[string]string{"message": message})
}
