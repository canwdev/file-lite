//go:build windows

package utils

import (
	"os"
	"strings"
	"testing"

	"file-lite-go/types"
)

// GetWindowsDrives 的每一项都必须有 path 与 kind，且 path 是 canonical 形态：
// 盘符是 "C:"（无尾斜杠），WSL 位置是 "//wsl.localhost/<发行版>"。
// 侧边栏的图标、并发档位、挂载点匹配全都依赖这个形态。
func TestGetWindowsDrivesShape(t *testing.T) {
	drives := GetWindowsDrives()
	if len(drives) == 0 {
		t.Skip("没有枚举到任何位置")
	}
	for _, d := range drives {
		if d.Kind == "" {
			t.Errorf("位置 %q 缺少 kind", d.Path)
		}
		if d.Path == "" {
			t.Errorf("位置 %q 的 path 为空", d.Label)
		}
		switch {
		case isDriveLetter(d.Path):
			// 盘符：kind 由 driveKind 判定，这里只钉形态
		case strings.HasPrefix(d.Path, "//wsl.localhost/"):
			if d.Kind != types.DriveKindNetwork {
				t.Errorf("WSL 位置 %q 应当是 network，得到 %q", d.Path, d.Kind)
			}
		default:
			t.Errorf("位置 %q 既不是盘符也不是已知的 UNC 形态", d.Path)
		}
		// canonical 形态不允许尾斜杠（根除外）
		if strings.HasSuffix(d.Path, "/") {
			t.Errorf("位置路径 %q 不该有尾斜杠", d.Path)
		}
	}
}

// isDriveLetter 判断 "C:" 形态。
func isDriveLetter(p string) bool {
	return len(p) == 2 && p[1] == ':' && p[0] >= 'A' && p[0] <= 'Z'
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

// WSL 发行版要能只靠注册表列出来：这是「用户不知道 \\wsl.localhost 存在」的解法。
// 没有发行版（没装 WSL / 读不到 HKCU）时返回空，不能报错。
func TestWSLDistroDrives(t *testing.T) {
	drives := wslDistroDrives()
	for _, d := range drives {
		if !strings.HasPrefix(d.Path, "//wsl.localhost/") {
			t.Errorf("WSL 路径 %q 形态不对", d.Path)
		}
		if d.Kind != types.DriveKindNetwork {
			t.Errorf("WSL 位置 %q 应当是 network（9p 走网络栈），得到 %q", d.Path, d.Kind)
		}
		if !strings.HasSuffix(d.Label, "(WSL)") {
			t.Errorf("WSL 标签 %q 应当以 (WSL) 结尾，用户要能一眼看出它是什么", d.Label)
		}
		// 发行版名不能带出额外的路径段
		rest := strings.TrimPrefix(d.Path, "//wsl.localhost/")
		if rest == "" || strings.ContainsAny(rest, `/\`) {
			t.Errorf("发行版名 %q 不该为空或含分隔符", rest)
		}
	}
	// 重复项检查：同名发行版出现两次会让侧边栏出现两行一样的入口
	seen := map[string]bool{}
	for _, d := range drives {
		if seen[d.Path] {
			t.Errorf("WSL 位置 %q 重复", d.Path)
		}
		seen[d.Path] = true
	}
	t.Logf("枚举到 %d 个 WSL 发行版", len(drives))
}

// 列表里顺序稳定：盘符在前、WSL 在后，且两次调用结果一致。
func TestGetWindowsDrivesOrderIsStable(t *testing.T) {
	first := GetWindowsDrives()
	second := GetWindowsDrives()
	if len(first) != len(second) {
		t.Fatalf("两次枚举数量不一致：%d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].Path != second[i].Path {
			t.Fatalf("第 %d 项不一致：%q vs %q", i, first[i].Path, second[i].Path)
		}
	}
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
