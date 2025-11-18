package types

type Entry struct {
	Name         string  `json:"name"`
	Ext          string  `json:"ext"`
	IsDirectory  bool    `json:"isDirectory"`
	Hidden       bool    `json:"hidden"`
	LastModified int64   `json:"lastModified"`
	Birthtime    int64   `json:"birthtime"`
	Size         *int64  `json:"size"`
	Error        *string `json:"error"`
}

type Drive struct {
	Label string `json:"label"`
	Path  string `json:"path"`
	Free  *int64 `json:"free,omitempty"`
	Total *int64 `json:"total,omitempty"`
}
