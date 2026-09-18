package types

type Entry struct {
	Name         string  `json:"name"`
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
	Free  *int64 `json:"free,omitempty"`
	Total *int64 `json:"total,omitempty"`
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
)
