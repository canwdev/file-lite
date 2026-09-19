//go:build linux

package utils

import (
	"bufio"
	"math"
	"os"
	"sort"
	"strings"

	"golang.org/x/sys/unix"

	"file-lite-go/types"
)

func GetWindowsDrives() []types.Drive {
	return []types.Drive{}
}

// pseudoFileSystems 是不该出现在「驱动器」列表里的伪文件系统。
//
// 判断标准：它不是一个用户可以在上面存放文件的存储。内核接口（proc / sysfs）、
// 内存文件系统（tmpfs / devtmpfs / ramfs）、容器层（overlay）、只读镜像
// （squashfs / iso9660）、以及各种内核内部挂载都属于这一类。
//
// 不列进来的坏处不只是难看：`/proc/mounts` 在这些机器上动辄几十条，
// 而其中绝大多数打开后是空的或只读的，用户点进去只会困惑。
var pseudoFileSystems = map[string]bool{
	"proc": true, "sysfs": true, "devpts": true, "devtmpfs": true,
	"tmpfs": true, "ramfs": true, "rootfs": true,
	"cgroup": true, "cgroup2": true, "pstore": true, "bpf": true,
	"debugfs": true, "tracefs": true, "securityfs": true, "configfs": true,
	"fusectl": true, "mqueue": true, "hugetlbfs": true, "binfmt_misc": true,
	"autofs": true, "rpc_pipefs": true, "nsfs": true, "overlay": true,
	"squashfs": true, "iso9660": true, "efivarfs": true,
}

// networkFileSystems 是需要走网络的文件系统，单独标成 network：
// 它们拿不到可靠的容量（有的能拿、有的拿不到），界面上不该显示成磁盘。
//
// 还得包含「以网络为后端的 FUSE」：/proc/mounts 里报的是 `fuse.<name>`，
// 形态上是一个普通挂载点、容量也可能拿得到，只有这张表知道它每次元数据操作
// 都是一次网络往返。漏掉的后果不是显示难看，而是并发档位错成 64——
// 对着 S3 同时甩出几十个对象请求，换来的是限流和请求费用（见 ReadDirConcurrency）。
//
// 只列**网络后端**。`fuse.sshfs` 这类已经在下面单列，因为缩写形式（`sshfs`）
// 与 `fuse.` 前缀两种写法都可能出现；本地后端的 FUSE（如 `fuse.mergerfs`、
// `fuse.bindfs`）不在其中——它们没有网络往返，按本机卷处理是对的。
var networkFileSystems = map[string]bool{
	"cifs": true, "smb3": true, "smbfs": true,
	"nfs": true, "nfs4": true,
	"sshfs": true, "fuse.sshfs": true,
	"9p": true, "davfs": true, "fuse.davfs2": true, "fuse.davfs": true,
	"afp": true, "fuse.afp": true,
	// 对象存储 / 云盘：rename 是服务端 copy，元数据操作是往返。
	"fuse.rclone":  true,
	"fuse.s3fs":    true,
	"fuse.gcsfuse": true,
	"fuse.juicefs": true,
	"fuse.goofys":  true,
}

// platformInternalMounts 是发行版 / 虚拟化层自己挂的内部路径，不是给用户浏览的位置。
//
// WSL 下尤其明显：它把 Windows 的 C 盘挂到 `/mnt/c`，又把驱动目录单独挂到
// `/usr/lib/wsl/drivers`。后者是另一个挂载（设备号与 `/mnt/c` 不同，所以按设备去重
// 抓不到），却由同一台 Windows 卷支撑，容量数字完全一样——在侧边栏里看起来就是
// 同一块盘出现了两次。
var platformInternalMounts = []string{
	"/usr/lib/wsl",
	"/mnt/wsl",
	"/mnt/wslg",
	"/run/WSL",
}

func isPlatformInternal(p string) bool {
	for _, prefix := range platformInternalMounts {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return true
		}
	}
	return false
}

// GetUnixMounts 返回可浏览的挂载点及其容量。
//
// 数据来自 /proc/mounts（Linux），过滤规则见 pseudoFileSystems 与
// platformInternalMounts；容量由 statfs 得到。
//
// 同一设备只保留一个挂载点：同一个卷常常在多个路径上出现——`/` 与
// `/mnt/wslg/distro` 是同一个设备，bind mount 更是同一份数据换个路径。
// 全部列出来只会让侧边栏变长而没有新信息。保留哪一个见 keepOnePerDevice。
func GetUnixMounts() []types.Drive {
	entries, err := parseMounts("/proc/mounts")
	if err != nil {
		return []types.Drive{{Label: "/", Path: "/", Kind: types.DriveKindVolume}}
	}

	var out []types.Drive
	for _, e := range entries {
		if pseudoFileSystems[e.fsType] || isPlatformInternal(e.mountPoint) {
			continue
		}
		kind := types.DriveKindVolume
		if networkFileSystems[e.fsType] {
			kind = types.DriveKindNetwork
		}

		d := types.Drive{Label: e.mountPoint, Path: e.mountPoint, Kind: kind}
		if free, total, ok := statfsCapacity(e.mountPoint); ok && total > 0 {
			d.Free, d.Total = &free, &total
		}
		out = append(out, d)
	}

	out = keepOnePerDevice(out, entries)
	if len(out) == 0 {
		out = append(out, types.Drive{Label: "/", Path: "/", Kind: types.DriveKindVolume})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Path == "/") != (out[j].Path == "/") {
			return out[i].Path == "/"
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// keepOnePerDevice 对同一个设备的多个挂载点只留一个。
//
// 保留的是**最短**的那个路径（同长度取字典序最小），因为最短路径最接近这个卷的根：
// `/mnt/c` 比 `/usr/lib/wsl/drivers` 更该出现。需要先排序再挑，否则保留哪个取决于
// /proc/mounts 的行序，不同内核版本会给出不同结果。
//
// 拿不到设备号的挂载点（statfs 不支持的网络文件系统）不参与去重——宁多列一个，
// 也不要把两个本来不同的位置合成一个。
func keepOnePerDevice(drives []types.Drive, entries []mountEntry) []types.Drive {
	devOf := make(map[string]uint64, len(entries))
	for _, e := range entries {
		devOf[e.mountPoint] = e.dev
	}

	sorted := make([]types.Drive, len(drives))
	copy(sorted, drives)
	sort.SliceStable(sorted, func(i, j int) bool {
		di, dj := depth(sorted[i].Path), depth(sorted[j].Path)
		if di != dj {
			return di < dj
		}
		return sorted[i].Path < sorted[j].Path
	})

	seenDev := map[uint64]bool{}
	keep := make(map[string]bool, len(drives))
	for _, d := range sorted {
		dev := devOf[d.Path]
		if dev == 0 {
			keep[d.Path] = true
			continue
		}
		if seenDev[dev] {
			continue
		}
		seenDev[dev] = true
		keep[d.Path] = true
	}

	out := drives[:0]
	for _, d := range drives {
		if keep[d.Path] {
			out = append(out, d)
		}
	}
	return out
}

func depth(p string) int {
	return strings.Count(strings.Trim(p, "/"), "/")
}

type mountEntry struct {
	source     string
	mountPoint string
	fsType     string
	dev        uint64
}

// parseMounts 读 mountTab（测试里可以换成临时文件）。
func parseMounts(mountTab string) ([]mountEntry, error) {
	f, err := os.Open(mountTab)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []mountEntry
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) < 3 || !strings.HasPrefix(parts[1], "/") {
			continue
		}
		e := mountEntry{
			// /proc/mounts 用八进制转义路径里的空格等字符（如 "C:\134"）。
			source:     unescapeMountField(parts[0]),
			mountPoint: unescapeMountField(parts[1]),
			fsType:     parts[2],
		}
		var st unix.Stat_t
		if unix.Stat(e.mountPoint, &st) == nil {
			e.dev = uint64(st.Dev)
		}
		out = append(out, e)
	}
	return out, s.Err()
}

// unescapeMountField 解开 /proc/mounts 的八进制转义（\040 空格、\011 tab、\012 换行、\134 反斜杠）。
func unescapeMountField(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			n, err := parseOctal3(s[i+1 : i+4])
			if err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func parseOctal3(s string) (int, error) {
	v := 0
	for i := 0; i < 3; i++ {
		c := s[i]
		if c < '0' || c > '7' {
			return 0, unix.EINVAL
		}
		v = v*8 + int(c-'0')
	}
	return v, nil
}

// statfsCapacity 返回挂载点的可用与总字节数。
//
// 用 Bavail 而不是 Bfree 作为可用：Bavail 才是非特权用户实际能写的量，
// 与 `df` 的输出一致。拿不到容量（权限、网络文件系统不实现 statfs）时返回 ok=false，
// 由调用方省略容量字段——界面已经能处理「没有容量」的情况。
func statfsCapacity(path string) (free, total int64, ok bool) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, 0, false
	}
	bs := int64(st.Bsize)
	if bs <= 0 {
		return 0, 0, false
	}
	avail, tot := int64(st.Bavail), int64(st.Blocks)
	// 块数乘以块大小可能溢出 int64（超大卷），溢出时视为拿不到容量。
	if avail > math.MaxInt64/bs || tot > math.MaxInt64/bs {
		return 0, 0, false
	}
	return avail * bs, tot * bs, true
}
