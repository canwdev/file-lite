package utils

import (
	"net/url"
	"regexp"
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

func InlineDisposition(name string) string {
	t := Sanitize(name, "_")
	enc := url.QueryEscape(t)
	fb := SanitizeAttachmentFilename(name)
	return `inline; filename="` + fb + `"; filename*=UTF-8''` + enc
}

func AttachmentDisposition(name string) string {
	t := Sanitize(name, "_")
	enc := url.QueryEscape(t)
	fb := SanitizeAttachmentFilename(name)
	return `attachment; filename="` + fb + `"; filename*=UTF-8''` + enc
}
