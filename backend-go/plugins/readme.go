package plugins

import _ "embed"

// readme 是插件须知的唯一来源。数据目录生成时拷到 plugins/README.md。
//
//go:embed readme.md
var readme []byte
