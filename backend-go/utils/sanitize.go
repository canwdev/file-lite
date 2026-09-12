package utils

import (
	"net/url"
	"regexp"
	"strings"
)

var illegalRe = regexp.MustCompile(`[/?<>\\:*|"]`)
var controlRe = regexp.MustCompile(`[\x00-\x1F\x80-\x9F]`)
var reservedRe = regexp.MustCompile(`^\.+$`)
var windowsReservedRe = regexp.MustCompile(`^(?i:con|prn|aux|nul|com\d|lpt\d)(\..*)?$`)
var windowsTrailingRe = regexp.MustCompile(`[. ]+$`)

func Sanitize(input string, replacement string) string {
	if replacement == "" {
		replacement = "_"
	}
	s := illegalRe.ReplaceAllString(input, replacement)
	s = controlRe.ReplaceAllString(s, replacement)
	s = reservedRe.ReplaceAllString(s, replacement)
	s = windowsTrailingRe.ReplaceAllString(s, replacement)
	if windowsReservedRe.MatchString(s) {
		s = replacement + s
	}
	if len(s) > 255 {
		s = s[:255]
	}
	return s
}

func SanitizeAttachmentFilename(s string) string {
	r := regexp.MustCompile(`[^\w.\-]`)
	return r.ReplaceAllString(s, "_")
}

// contentDisposition 拼出 Content-Disposition。
//
// filename 是不认 filename* 的老客户端的 ASCII 回退，filename*=UTF-8”… 是 RFC 5987 形式。
// ext-value 只允许 attr-char，所以必须是百分号编码：url.QueryEscape 会把空格编成 "+"，
// 而 ext-value 里的 "+" 是字面加号——带空格的文件名下载下来会变成加号，故再换回 %20。
func contentDisposition(disposition string, name string) string {
	fallback := SanitizeAttachmentFilename(name)
	// 先按文件名规则清洗，再对清洗结果做 RFC 5987 百分号编码
	encoded := strings.ReplaceAll(url.QueryEscape(Sanitize(name, "_")), "+", "%20")
	return disposition + `; filename="` + fallback + `"; filename*=UTF-8''` + encoded
}

func InlineDisposition(name string) string {
	return contentDisposition("inline", name)
}

func AttachmentDisposition(name string) string {
	return contentDisposition("attachment", name)
}
