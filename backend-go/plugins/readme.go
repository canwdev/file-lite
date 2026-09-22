package plugins

import _ "embed"

// readme 与仓库 docs/plugins.md 是同一份须知。数据目录生成时拷到 plugins/README.md。
//
//go:embed readme.md
var readme []byte
