// Package textencoding detects the character encoding of plain text and turns it
// into UTF-8.
//
// It exists because the browser assumes UTF-8 for a text response: XHR decodes it
// that way, and Artplayer decodes a subtitle with a hard-coded
// TextDecoder("utf-8"). A GBK subtitle therefore renders as mojibake unless the
// server normalizes it before the bytes leave.
package textencoding

import (
	"bytes"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
)

// Charset names a detected encoding the way the WHATWG Encoding Standard spells
// it, so the value is also usable as a Content-Type charset parameter.
type Charset string

const (
	UTF8     Charset = "utf-8"
	UTF16LE  Charset = "utf-16le"
	UTF16BE  Charset = "utf-16be"
	GB18030  Charset = "gb18030"
	Big5     Charset = "big5"
	ShiftJIS Charset = "shift_jis"
)

var (
	bomUTF8    = []byte{0xEF, 0xBB, 0xBF}
	bomUTF16LE = []byte{0xFF, 0xFE}
	bomUTF16BE = []byte{0xFE, 0xFF}
)

// fallbacks are the legacy encodings, in the order they are tried.
//
// The order is the policy, not a ranking by quality. GB18030 comes first because
// the non-UTF-8 files this app sees in Chinese Windows are GBK/GB2312, and
// because a GBK byte stream is also valid Big5 and Shift-JIS — those decoders
// happily turn Chinese into Japanese-looking text — so anything else would need
// a statistical model to break the tie. A candidate only wins when the whole
// input decodes without a replacement character, and only when no earlier
// candidate managed the same.
//
// There is no EUC-KR entry on purpose: common Korean syllables are valid
// GB18030 and Big5, so the entry would be unreachable for real text and would
// only invite the idea that Korean is detected. Japanese is here because
// half-width katakana is one of the few scripts those two cannot map.
var fallbacks = []struct {
	charset Charset
	enc     encoding.Encoding
}{
	{GB18030, simplifiedchinese.GB18030},
	{Big5, traditionalchinese.Big5},
	{ShiftJIS, japanese.ShiftJIS},
}

// utf16GuessSize bounds how much of a BOM-less stream the UTF-16 heuristic looks
// at. The NUL pattern it keys on shows up within a few bytes.
const utf16GuessSize = 4 << 10

// charsets lists every name this package can detect and encode.
var charsets = []Charset{UTF8, UTF16LE, UTF16BE, GB18030, Big5, ShiftJIS}

// encoders maps a charset back to the encoder that writes it, so an edited file
// can go back to disk the way it came. UTF-8 and UTF-16 are handled in Encode.
var encoders = map[Charset]encoding.Encoding{
	GB18030:  simplifiedchinese.GB18030,
	Big5:     traditionalchinese.Big5,
	ShiftJIS: japanese.ShiftJIS,
}

// ParseCharset resolves a charset name, such as one a client echoed back after
// reading it from a response. Names are matched case-insensitively.
func ParseCharset(name string) (Charset, bool) {
	normalized := Charset(strings.ToLower(strings.TrimSpace(name)))
	for _, known := range charsets {
		if normalized == known {
			return known, true
		}
	}
	return "", false
}

// Encode converts UTF-8 text into charset, which is how an edited file is
// written back in the encoding it was read as.
//
// It fails when the text holds a character the target cannot represent — an
// emoji in a Big5 file, say. That is deliberate: the caller has to tell the
// user rather than silently change what the file is.
func Encode(text []byte, charset Charset) ([]byte, error) {
	switch charset {
	case UTF8:
		return text, nil
	case UTF16LE:
		return encodeUTF16(text, unicode.LittleEndian)
	case UTF16BE:
		return encodeUTF16(text, unicode.BigEndian)
	}
	enc, ok := encoders[charset]
	if !ok {
		return nil, fmt.Errorf("unsupported charset %q", charset)
	}
	return enc.NewEncoder().Bytes(text)
}

// encodeUTF16 writes UTF-16 with the byte order mark the decoder strips.
func encodeUTF16(text []byte, order unicode.Endianness) ([]byte, error) {
	return unicode.UTF16(order, unicode.UseBOM).NewEncoder().Bytes(text)
}

// Detect reports the encoding of data. It checks a byte order mark, then a
// BOM-less UTF-16 NUL pattern, then UTF-8, and finally the legacy East Asian
// encodings in fallbacks order.
//
// When nothing decodes losslessly it answers GB18030: that is still the best
// guess for the files this app sees, and decoding it replaces the bytes it cannot
// map instead of failing the request.
func Detect(data []byte) Charset {
	switch {
	case bytes.HasPrefix(data, bomUTF8):
		return UTF8
	case bytes.HasPrefix(data, bomUTF16LE):
		return UTF16LE
	case bytes.HasPrefix(data, bomUTF16BE):
		return UTF16BE
	}
	if charset := detectBOMlessUTF16(data); charset != "" {
		return charset
	}
	if utf8.Valid(data) {
		return UTF8
	}
	for _, candidate := range fallbacks {
		if _, ok := decodeLossless(candidate.enc, data); ok {
			return candidate.charset
		}
	}
	return GB18030
}

// ToUTF8 converts data to UTF-8 and reports the encoding it was read as.
//
// UTF-8 input is returned unchanged, byte for byte — including a byte order
// mark — so a caller can tell "nothing to convert" from "converted" by the
// charset alone and stream the file as it is on disk.
func ToUTF8(data []byte) ([]byte, Charset) {
	charset := Detect(data)
	switch charset {
	case UTF8:
		return data, UTF8
	case UTF16LE:
		return utf16ToUTF8(data, unicode.LittleEndian), UTF16LE
	case UTF16BE:
		return utf16ToUTF8(data, unicode.BigEndian), UTF16BE
	}
	for _, candidate := range fallbacks {
		if candidate.charset != charset {
			continue
		}
		if out, ok := decodeLossless(candidate.enc, data); ok {
			return out, charset
		}
		break
	}
	// Nothing is lossless: hand back GB18030 with the unmappable bytes replaced
	// rather than an encoding error, so the editor still shows the file.
	out, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	if err != nil || !utf8.Valid(out) {
		return data, GB18030
	}
	return out, GB18030
}

// decodeLossless decodes with enc and reports whether every byte mapped to a
// character.
//
// x/text decoders do not report invalid input: they substitute U+FFFD and return
// no error, so the only way to know the input was not in this encoding is to look
// for that replacement character in the output. UTF-8 with a genuine U+FFFD can
// never get here — Detect answers UTF8 long before — so the scan is exact.
func decodeLossless(enc encoding.Encoding, data []byte) ([]byte, bool) {
	out, err := enc.NewDecoder().Bytes(data)
	if err != nil {
		return nil, false
	}
	return out, !bytes.ContainsRune(out, utf8.RuneError)
}

// detectBOMlessUTF16 guesses a UTF-16 stream that has no BOM: ASCII-heavy UTF-16
// puts a 0x00 byte on every second position, and which side it lands on tells the
// byte order. CJK UTF-16 has no 0x00 at all and is not recognized here — every
// editor that writes it writes a BOM too.
func detectBOMlessUTF16(data []byte) Charset {
	limit := len(data)
	if limit > utf16GuessSize {
		limit = utf16GuessSize
	}
	if limit < 8 {
		return ""
	}
	var evenNul, oddNul, pairs int
	for i := 0; i+1 < limit; i += 2 {
		pairs++
		if data[i] == 0 {
			evenNul++
		}
		if data[i+1] == 0 {
			oddNul++
		}
	}
	switch {
	case oddNul*2 > pairs && evenNul == 0:
		return UTF16LE
	case evenNul*2 > pairs && oddNul == 0:
		return UTF16BE
	}
	return ""
}

// utf16ToUTF8 decodes a UTF-16 stream, dropping the byte order mark it carries.
func utf16ToUTF8(data []byte, order unicode.Endianness) []byte {
	body := data
	if order == unicode.LittleEndian && bytes.HasPrefix(body, bomUTF16LE) {
		body = body[len(bomUTF16LE):]
	}
	if order == unicode.BigEndian && bytes.HasPrefix(body, bomUTF16BE) {
		body = body[len(bomUTF16BE):]
	}
	out, err := unicode.UTF16(order, unicode.IgnoreBOM).NewDecoder().Bytes(body)
	if err != nil {
		// A truncated stream. There is no good answer, so hand the bytes back
		// unchanged: that is what the endpoint served before it decoded at all.
		return data
	}
	return out
}
