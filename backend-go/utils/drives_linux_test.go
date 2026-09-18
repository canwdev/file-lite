//go:build linux

package utils

import (
	"os"
	"path/filepath"
	"testing"
)

// 用一份接近真实 /proc/mounts 的内容验证过滤与解析。
// 真实机器上的条目形态见注释：这台机器有 15 个 tmpfs、4 个 overlay 和各种内核接口。
const sampleMounts = `/dev/sdd / ext4 rw,relatime 0 0
proc /proc proc rw,nosuid 0 0
sysfs /sys sysfs rw,nosuid 0 0
tmpfs /run tmpfs rw,nosuid,size=65536k 0 0
overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0
devtmpfs /dev devtmpfs rw,nosuid 0 0
/dev/sde /mnt/dev-drive ext4 rw,relatime 0 0
C:\134 /mnt/c 9p rw,aname=drvfs 0 0
//server/share /mnt/share cifs rw,username=me 0 0
server:/export /mnt/nfs nfs4 rw 0 0
/dev/sdd /mnt/wslg/distro ext4 rw 0 0
9p /usr/lib/wsl/drivers 9p rw,aname=drivers 0 0
`

func writeTempMounts(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "mounts")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseMountsUnescapesAndSkipsNonAbsolute(t *testing.T) {
	entries, err := parseMounts(writeTempMounts(t, sampleMounts))
	if err != nil {
		t.Fatal(err)
	}

	var byPoint = map[string]mountEntry{}
	for _, e := range entries {
		byPoint[e.mountPoint] = e
	}

	// /proc/mounts 把路径里的字符写成八进制：C:\134 其实是一个反斜杠。
	if got := byPoint["/mnt/c"].source; got != `C:\` {
		t.Errorf("八进制转义未解开：source = %q，期望 %q", got, `C:\`)
	}
	if got := byPoint["/mnt/share"].fsType; got != "cifs" {
		t.Errorf("fsType = %q，期望 cifs", got)
	}
	// 非绝对路径的挂载点（如 swap、有些系统上的 tmpfs 别名）不进列表。
	for _, e := range entries {
		if e.mountPoint == "" {
			t.Error("挂载点不应为空")
		}
	}
}

func TestPseudoFileSystemsAreFiltered(t *testing.T) {
	entries, err := parseMounts(writeTempMounts(t, sampleMounts))
	if err != nil {
		t.Fatal(err)
	}

	kept := map[string]bool{}
	for _, e := range entries {
		if pseudoFileSystems[e.fsType] || isPlatformInternal(e.mountPoint) {
			continue
		}
		kept[e.mountPoint] = true
	}

	// 真实存储：保留。
	for _, want := range []string{"/", "/mnt/dev-drive", "/mnt/c", "/mnt/share", "/mnt/nfs"} {
		if !kept[want] {
			t.Errorf("%s 应当保留，却被过滤掉了", want)
		}
	}
	// 伪文件系统与容器层：过滤。
	for _, unwanted := range []string{"/proc", "/sys", "/run", "/dev", "/var/lib/docker/overlay2/x/merged"} {
		if kept[unwanted] {
			t.Errorf("%s 是伪文件系统 / 容器层，不该出现在驱动器列表里", unwanted)
		}
	}
	// 平台内部挂载：过滤（见 platformInternalMounts）。
	for _, unwanted := range []string{"/usr/lib/wsl/drivers"} {
		if kept[unwanted] {
			t.Errorf("%s 是 WSL 内部挂载，不该出现在驱动器列表里", unwanted)
		}
	}
}

func TestPlatformInternalMounts(t *testing.T) {
	internal := []string{"/usr/lib/wsl/drivers", "/usr/lib/wsl", "/mnt/wsl", "/mnt/wslg", "/run/WSL/something"}
	for _, p := range internal {
		if !isPlatformInternal(p) {
			t.Errorf("%s 应判为平台内部挂载", p)
		}
	}
	external := []string{"/", "/mnt", "/mnt/c", "/mnt/wslgx", "/usr/lib", "/home/user/wsl"}
	for _, p := range external {
		if isPlatformInternal(p) {
			t.Errorf("%s 不是平台内部挂载，却被判为内部", p)
		}
	}
}

func TestNetworkFileSystemsAreTagged(t *testing.T) {
	entries, err := parseMounts(writeTempMounts(t, sampleMounts))
	if err != nil {
		t.Fatal(err)
	}

	for _, e := range entries {
		want := false
		switch e.fsType {
		case "cifs", "nfs4", "9p":
			want = true
		}
		if got := networkFileSystems[e.fsType]; got != want {
			t.Errorf("fsType %q 的网络分类 = %v，期望 %v", e.fsType, got, want)
		}
	}
}

func TestUnescapeMountField(t *testing.T) {
	cases := map[string]string{
		`/plain/path`:          `/plain/path`,
		`/with\040space`:       `/with space`,
		`/with\011tab`:         "/with\ttab",
		`C:\134`:               `C:\`,
		`/trailing\`:           `/trailing\`,
		`/bad\09x`:             `/bad\09x`,
		`/no-escape-backslash`: `/no-escape-backslash`,
	}
	for in, want := range cases {
		if got := unescapeMountField(in); got != want {
			t.Errorf("unescapeMountField(%q) = %q，期望 %q", in, got, want)
		}
	}
}

// statfs 在所有平台都有真实实现，用当前目录即可验证它返回了合理值；
// 不存在的路径必须返回 ok=false，让调用方省略容量而不是显示 0。
func TestStatfsCapacity(t *testing.T) {
	free, total, ok := statfsCapacity(t.TempDir())
	if !ok {
		t.Fatal("临时目录应当能拿到容量")
	}
	if total <= 0 || free < 0 || free > total {
		t.Fatalf("容量不合理：free=%d total=%d", free, total)
	}

	if _, _, ok := statfsCapacity("/definitely/not/here/xyz"); ok {
		t.Fatal("不存在的路径不应返回容量")
	}
}

// GetUnixMounts 在**这台机器的真实挂载表**上跑一遍。
// 夹具覆盖不到真实环境里千奇百怪的条目，这个用例专门用来发现「过滤太松」。
func TestGetUnixMountsOnRealMachine(t *testing.T) {
	drives := GetUnixMounts()
	if len(drives) == 0 {
		t.Fatal("至少应当有根")
	}
	if drives[0].Path != "/" {
		t.Errorf("根应当排在最前，得到 %q", drives[0].Path)
	}
	seen := map[string]bool{}
	for _, d := range drives {
		if d.Path == "" || d.Path[0] != '/' {
			t.Errorf("挂载点应当是绝对路径，得到 %q", d.Path)
		}
		if seen[d.Path] {
			t.Errorf("挂载点重复：%q", d.Path)
		}
		seen[d.Path] = true
		if pseudoFileSystems[d.Label] {
			t.Errorf("伪文件系统漏进了列表：%q", d.Label)
		}
	}
	// 根必须有容量：拿不到就说明 statfs 那条链路断了。
	if drives[0].Free == nil || drives[0].Total == nil {
		t.Error("根挂载点应当带上容量")
	}
	t.Logf("真实机器上的驱动器列表（%d 项）：", len(drives))
	for _, d := range drives {
		free, total := int64(-1), int64(-1)
		if d.Free != nil {
			free = *d.Free
		}
		if d.Total != nil {
			total = *d.Total
		}
		t.Logf("  %-24s kind=%-8s free=%d total=%d", d.Path, d.Kind, free, total)
	}
}
