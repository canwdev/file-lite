//go:build windows

package utils

import (
	"os"
	"syscall"
	"testing"

	"file-lite-go/types"
)

// isBitLockerLocked 必须只认 STATUS_FVE_LOCKED_VOLUME，别的错误不能误判。
//
// 误判的代价是双向的：漏判会让锁定的盘退回「一块点不开的本地盘」，
// 误判会把权限错误说成「请去解锁 BitLocker」。
func TestIsBitLockerLocked(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"BitLocker 锁定", bitLockerLockedErrno, true},
		{"包装过的 BitLocker", &os.PathError{Op: "open", Path: `H:\`, Err: bitLockerLockedErrno}, true},
		{"nil", nil, false},
		{"文件不存在", os.ErrNotExist, false},
		{"权限不足", os.ErrPermission, false},
		{"拒绝访问", syscall.ERROR_ACCESS_DENIED, false},
		{"设备未就绪", syscall.Errno(21), false},
		{"超时", syscall.Errno(1460), false},
		// 相邻的 FVE 错误码不是「锁定」，不该混进来
		{"FVE 其他错误", syscall.Errno(0x80310001), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isBitLockerLocked(c.err); got != c.want {
				t.Fatalf("isBitLockerLocked(%v) = %v，期望 %v", c.err, got, c.want)
			}
		})
	}
}

// 枚举结果里的每一个盘符都要有 kind；锁定的卷必须被标成 locked 而不是 volume。
//
// 没有 BitLocker 锁定卷的机器上只验证前一半——那条断言不需要特权，
// 而且能在任何 Windows 上跑。
func TestWindowsDrivesKindIncludesLocked(t *testing.T) {
	drives := GetWindowsDrives()
	lockedSeen := 0
	for _, d := range drives {
		if d.Kind == "" {
			t.Errorf("位置 %q 缺少 kind", d.Path)
		}
		if d.Kind == types.DriveKindLocked {
			lockedSeen++
			if d.Free != nil || d.Total != nil {
				t.Errorf("锁定的卷 %q 不该报容量（读不到）", d.Path)
			}
			if d.Label == "" {
				t.Errorf("锁定的卷 %q 缺少标签", d.Path)
			}
		}
	}
	t.Logf("枚举 %d 个位置，其中 locked %d 个", len(drives), lockedSeen)
}
