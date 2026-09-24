package sevenzip

import (
	"strings"
	"unicode"
)

// CompressFormat is one archive type this 7-Zip build can create.
type CompressFormat struct {
	ID       string `json:"id"`
	Ext      string `json:"ext"`
	Label    string `json:"label"`
	Password bool   `json:"password"`
}

// kArcFlags is the flag alphabet printed by `7z i`, excluding the leading
// create mark. The create mark is a separate character in front of it.
const arcFlagCount = len("KSNFMGOPBELHXCc+a+m+r+")

// compressCatalog is the create-capable types offered in the compress dialog,
// in display order. The id is the `-t` value 7-Zip prints.
var compressCatalog = []CompressFormat{
	{ID: "zip", Ext: ".zip", Label: "ZIP", Password: true},
	{ID: "7z", Ext: ".7z", Label: "7z", Password: true},
	{ID: "tar", Ext: ".tar", Label: "TAR"},
	{ID: "gzip", Ext: ".gz", Label: "GZIP"},
	{ID: "bzip2", Ext: ".bz2", Label: "BZIP2"},
	{ID: "xz", Ext: ".xz", Label: "XZ"},
	{ID: "wim", Ext: ".wim", Label: "WIM"},
}

type formatProbe struct {
	Extract  []string
	Compress []CompressFormat
}

// parseFormatInfo reads `7z i`. Extract extensions are the ones that build
// lists (xlsx and docx included). Compress formats are the catalog entries
// whose line starts with the create mark.
func parseFormatInfo(output string) formatProbe {
	var probe formatProbe
	seenExt := map[string]struct{}{}
	creatable := map[string]struct{}{}
	inFormats := false
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimRight(line, "\r")
		trim := strings.TrimSpace(line)
		if trim == "Formats:" {
			inFormats = true
			continue
		}
		if !inFormats {
			continue
		}
		if trim == "" || strings.HasPrefix(trim, "Codecs:") || strings.HasPrefix(trim, "Hashers:") {
			if strings.HasPrefix(trim, "Codecs:") || strings.HasPrefix(trim, "Hashers:") {
				break
			}
			continue
		}
		name, exts, create, ok := parseFormatLine(line)
		if !ok || strings.EqualFold(name, "Hash") {
			continue
		}
		if create {
			creatable[strings.ToLower(name)] = struct{}{}
		}
		for _, ext := range exts {
			if _, ok := seenExt[ext]; ok {
				continue
			}
			seenExt[ext] = struct{}{}
			probe.Extract = append(probe.Extract, ext)
		}
	}
	for _, format := range compressCatalog {
		if _, ok := creatable[format.ID]; ok {
			probe.Compress = append(probe.Compress, format)
		}
	}
	return probe
}

// parseFormatLine reads one Formats row from `7z i`.
//
// The row is: lib index, create mark, 22 flag characters, optional time
// field, the format name padded to 8, then extensions until the signature.
func parseFormatLine(line string) (name string, exts []string, create bool, ok bool) {
	rest := line
	if len(rest) >= 3 && rest[2] == ' ' && isLibIndex(rest[:2]) {
		rest = rest[3:]
	}
	if len(rest) < 1+arcFlagCount+1 {
		return "", nil, false, false
	}
	create = rest[0] == 'C'
	rest = rest[1+arcFlagCount:] // create mark + flags
	if len(rest) == 0 || rest[0] != ' ' {
		return "", nil, false, false
	}
	rest = rest[1:]
	// A time field is 4 flags plus a precision digit. Its absence is a space.
	if len(rest) >= 6 && rest[0] != ' ' && rest[5] == ' ' {
		rest = rest[6:]
	}
	if len(rest) > 0 && rest[0] == ' ' {
		rest = rest[1:]
	}
	name, rest = readFormatName(rest)
	if name == "" {
		return "", nil, false, false
	}
	return name, extensionTokens(rest), create, true
}

func isLibIndex(s string) bool {
	if len(s) != 2 {
		return false
	}
	for _, r := range s {
		if r != ' ' && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

func readFormatName(rest string) (string, string) {
	if rest == "" {
		return "", ""
	}
	if len(rest) > 8 && rest[8] != ' ' {
		i := strings.IndexByte(rest, ' ')
		if i < 0 {
			return rest, ""
		}
		return rest[:i], rest[i+1:]
	}
	field := rest
	after := ""
	if len(rest) > 8 {
		field = rest[:8]
		after = rest[8:]
	}
	return strings.TrimSpace(field), strings.TrimLeft(after, " ")
}

// extensionTokens keeps lowercase extension words and stops at the signature.
func extensionTokens(rest string) []string {
	var out []string
	for _, tok := range strings.Fields(rest) {
		if tok == "||" || strings.HasPrefix(tok, "offset=") || isSignature(tok) {
			break
		}
		if strings.HasPrefix(tok, "(") {
			continue
		}
		if !isExtToken(tok) {
			break
		}
		out = append(out, "."+tok)
	}
	return out
}

func isExtToken(tok string) bool {
	if tok == "" {
		return false
	}
	for _, r := range tok {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

func isSignature(tok string) bool {
	if len(tok) == 1 {
		return true
	}
	if len(tok) != 2 {
		return false
	}
	for _, r := range tok {
		if !unicode.Is(unicode.ASCII_Hex_Digit, r) || unicode.IsLower(r) {
			return false
		}
	}
	return true
}

// SupportedExtractExt reports whether name's extension is one 7-Zip was probed
// to open. Comparison is case-insensitive and prefers the longest match.
func SupportedExtractExt(name string, exts []string) bool {
	return StripExtractExt(name, exts) != name
}

// StripExtractExt removes the longest probed extension from name.
// The original name is returned when nothing matches.
func StripExtractExt(name string, exts []string) string {
	lower := strings.ToLower(name)
	best := ""
	for _, ext := range exts {
		ext = strings.ToLower(ext)
		if ext == "" || ext == "." {
			continue
		}
		if strings.HasSuffix(lower, ext) && len(ext) > len(best) && len(ext) < len(name) {
			best = ext
		}
	}
	if best == "" {
		return name
	}
	return name[:len(name)-len(best)]
}

// LookupCompress returns a create format by id. An empty id is zip.
func LookupCompress(id string, formats []CompressFormat) (CompressFormat, bool) {
	if id == "" {
		id = "zip"
	}
	id = strings.ToLower(id)
	for _, format := range formats {
		if format.ID == id {
			return format, true
		}
	}
	return CompressFormat{}, false
}
