package utils

import (
	"errors"
	"syscall"
)

// BitLockerLockedErrno 是「卷被 BitLocker 锁住」时返回的 NTSTATUS
// （STATUS_FVE_LOCKED_VOLUME = 0x80310000）。
//
// 它不是一个 Win32 错误码，所以 syscall 里没有常量；Go 会把它原样放进
// `*os.PathError.Err`（实测 os.Stat、os.ReadDir 与卷枚举调用都是这个值）。
//
// 这个常量与判定放在无构建标签的文件里：工具函数本身是跨平台的（错误码比较不依赖
// 任何 Windows API），routes 里的错误映射在 Linux 上也要能编译并通过替身错误走通
// 同一条分支。
const BitLockerLockedErrno = syscall.Errno(0x80310000)

// IsBitLockerLocked 判断错误是不是「这个卷被 BitLocker 锁住了」。
func IsBitLockerLocked(err error) bool {
	return err != nil && errors.Is(err, BitLockerLockedErrno)
}
