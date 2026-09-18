//go:build windows

package utils

import (
	"os"
	"path/filepath"
	"testing"

	"file-lite-go/types"
)

// GetWindowsDrives 必须给出 canonical 形态的 Path（"C:"，无尾斜杠），
// 并且每一项都有 kind——侧边栏的图标与并发档位都依赖它。
func TestGetWindowsDrivesShape(t *testing.T) {
	drives := GetWindowsDrives()
	if len(drives) == 0 {
		t.Skip("没有枚举到任何盘符")
	}
	for _, d := range drives {
		if d.Kind == "" {
			t.Errorf("盘符 %q 缺少 kind", d.Path)
		}
		if d.Path == "" {
			t.Errorf("盘符 %q 的 path 为空", d.Label)
		}
		if filepath.VolumeName(d.Path) == "" {
			t.Errorf("盘符路径 %q 不是 canonical 形态（应当是盘符本身）", d.Path)
		}
		if len(d.Path) != 2 || d.Path[0] < 'A' || d.Path[0] > 'Z' || d.Path[1] != ':' {
			t.Errorf("盘符路径 %q 不是 \"C:\" 形态", d.Path)
		}
	}
}

// 本机固定盘不能被标成网络：那会让它的列表并发档位退化成 6，
// 大目录在本地也会慢得莫名其妙。
func TestGetWindowsDrivesLocalIsVolume(t *testing.T) {
	systemDrive := os.Getenv("SystemDrive") // 例如 "C:"
	if systemDrive == "" {
		t.Skip("SystemDrive 未设置")
	}
	for _, d := range GetWindowsDrives() {
		if d.Path == systemDrive {
			if d.Kind != types.DriveKindVolume {
				t.Fatalf("系统盘 %s 应当是 volume，得到 %q", systemDrive, d.Kind)
			}
			return
		}
	}
	t.Skipf("枚举结果里没有系统盘 %s", systemDrive)
}

// isUNCVolumeLink 对真实盘符不应误报：固定盘不是链接。
func TestIsUNCVolumeLinkOnFixedDrive(t *testing.T) {
	systemDrive := os.Getenv("SystemDrive")
	if len(systemDrive) < 1 {
		t.Skip("SystemDrive 未设置")
	}
	if isUNCVolumeLink(systemDrive[:1]) {
		t.Fatalf("固定盘 %s 被误判成了指向 UNC 的链接", systemDrive)
	}
}
