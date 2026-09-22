package plugins

import (
	"bytes"
	"os"
	"path/filepath"
)

const sdkTag = `<script src="/plugin-sdk.js"></script>`

// InjectSDK inserts the plugin SDK before </head> (or </body> when there is no head).
// A page that already references plugin-sdk.js is left unchanged.
func InjectSDK(html []byte) []byte {
	if bytes.Contains(html, []byte("plugin-sdk.js")) {
		return html
	}
	lower := bytes.ToLower(html)
	if i := bytes.Index(lower, []byte("</head>")); i >= 0 {
		return insertAt(html, i, sdkTag)
	}
	if i := bytes.Index(lower, []byte("</body>")); i >= 0 {
		return insertAt(html, i, sdkTag)
	}
	return append([]byte(sdkTag), html...)
}

func insertAt(html []byte, at int, text string) []byte {
	out := make([]byte, 0, len(html)+len(text))
	out = append(out, html[:at]...)
	out = append(out, text...)
	out = append(out, html[at:]...)
	return out
}

// IsEntry reports whether abs is this plugin's entry file.
func (p Plugin) IsEntry(abs string) bool {
	entry := p.FilePath
	if !p.File {
		entry = filepath.Join(p.Root, filepath.FromSlash(p.EntryRel))
	}
	return filepath.Clean(abs) == filepath.Clean(entry)
}

// EnsureReadme creates plugins/README.md when it is missing.
func EnsureReadme(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	dest := filepath.Join(dir, "README.md")
	if _, err := os.Stat(dest); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(dest, readme, 0o644)
}
