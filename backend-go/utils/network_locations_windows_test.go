//go:build windows

package utils

import (
	"strings"
	"testing"
	"time"

	"file-lite-go/types"
)

// 网络位置（用户手动添加的共享，不是映射盘符）必须能被列出来，
// 且形态正确：canonical、kind=network、有可读标签。
func TestNetworkLocationDrives(t *testing.T) {
	drives := networkLocationDrives()
	for _, d := range drives {
		if !strings.HasPrefix(d.Path, "//") {
			t.Errorf("网络位置 %q 应当是 canonical UNC 形态", d.Path)
		}
		if strings.HasSuffix(d.Path, "/") {
			t.Errorf("网络位置 %q 不该有尾斜杠", d.Path)
		}
		if d.Kind != types.DriveKindNetwork {
			t.Errorf("网络位置 %q 应当是 network，得到 %q", d.Path, d.Kind)
		}
		if strings.TrimSpace(d.Label) == "" {
			t.Errorf("网络位置 %q 缺少标签", d.Path)
		}
		// 至少 \\host\share 两段
		segs := strings.Split(strings.Trim(d.Path, "/"), "/")
		if len(segs) < 2 || segs[0] == "" || segs[1] == "" {
			t.Errorf("网络位置 %q 不是 \\\\host\\share 形态", d.Path)
		}
		// 容量不可靠：不该报 free/total
		if d.Free != nil || d.Total != nil {
			t.Errorf("网络位置 %q 不该带容量", d.Path)
		}
		t.Logf("网络位置: label=%q path=%q kind=%q", d.Label, d.Path, d.Kind)
	}
	t.Logf("共 %d 个网络位置", len(drives))
}

// 枚举**不许**做可达性预检：不可达主机一次 stat 要 1.3–2.5 秒，侧边栏会被卡住。
// 这里钉住「枚举很快」这条性质，而不是钉某个具体耗时。
func TestNetworkLocationEnumerationIsFast(t *testing.T) {
	// 先热身一次，排除首次 syscall 开销
	_ = networkLocationDrives()

	done := make(chan []types.Drive, 1)
	go func() { done <- networkLocationDrives() }()
	select {
	case got := <-done:
		t.Logf("枚举 %d 个网络位置，未超时", len(got))
	case <-time.After(5 * time.Second):
		t.Fatal("枚举网络位置超过 5 秒：很可能在枚举时做了联网探测")
	}
}

// 没有 APPDATA / 目录不存在时必须安静地返回空，不能报错。
func TestNetworkLocationMissingDirIsQuiet(t *testing.T) {
	t.Setenv("APPDATA", `Z:\definitely\not\here`)
	if got := networkLocationDrives(); len(got) != 0 {
		t.Fatalf("目录不存在时应返回空，得到 %+v", got)
	}
}
