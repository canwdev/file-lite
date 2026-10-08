package types

type Entry struct {
	Name string `json:"name"`
	// Path 是 canonical 形态的完整路径（正斜杠）。前端直接把它当资源标识回传，
	// 不再自己把目录和名字拼起来——拼接会在盘符、UNC 与转义上出错。
	Path string `json:"path"`
	// RelativePath 只在递归平铺列表里有值：相对被列出目录的路径。
	RelativePath string  `json:"relativePath,omitempty"`
	Ext          string  `json:"ext"`
	IsDirectory  bool    `json:"isDirectory"`
	IsLink       bool    `json:"isLink"`
	Hidden       bool    `json:"hidden"`
	LastModified int64   `json:"lastModified"`
	Birthtime    int64   `json:"birthtime"`
	Size         *int64  `json:"size"`
	Error        *string `json:"error"`
}

// Drive 是侧边栏里的一个可导航位置（盘符 / 网络位置 / Home）。
type Drive struct {
	Label string `json:"label"`
	Path  string `json:"path"`
	Kind  string `json:"kind,omitempty"`
	// FileSystem is the OS name (ext4, NTFS, 9p, iso9660). Empty for Home and
	// when the OS does not report one, such as a locked volume.
	FileSystem string `json:"fileSystem,omitempty"`
	Free       *int64 `json:"free,omitempty"`
	Total      *int64 `json:"total,omitempty"`
}

// Drive 的 Kind 取值。前端据此选图标、以及决定是否显示容量。
const (
	// DriveKindVolume 是本机卷（含 Windows 的映射盘符）。
	DriveKindVolume = "volume"
	// DriveKindNetwork 是需要走网络且容量不可靠的位置（UNC、NFS、9p…）。
	DriveKindNetwork = "network"
	// DriveKindHome 是用户主目录这个虚拟位置。
	DriveKindHome = "home"
	// DriveKindLocked 是存在但当前读不了的加密卷（Windows 上 BitLocker 未解锁）。
	// 它仍是一个可导航位置——点进去会拿到解锁提示，而不是 404。
	DriveKindLocked = "locked"
	// DriveKindOptical is a CD-ROM filesystem (ISO 9660 or UDF) or a Windows
	// CD-ROM drive. Content previews stay off: random reads thrash the disc.
	DriveKindOptical = "optical"
)
