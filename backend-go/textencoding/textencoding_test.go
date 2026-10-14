package textencoding

import (
	"bytes"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
)

func encode(t *testing.T, enc encoding.Encoding, text string) []byte {
	t.Helper()
	out, err := enc.NewEncoder().Bytes([]byte(text))
	if err != nil {
		t.Fatalf("encode %q: %v", text, err)
	}
	return out
}

func TestDetectUTF8(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"empty", nil},
		{"ascii", []byte("hello\n")},
		{"chinese", []byte("本字幕由人人影视翻译制作\n")},
		{"bom", append([]byte{0xEF, 0xBB, 0xBF}, []byte("hello")...)},
	}
	for _, c := range cases {
		if got := Detect(c.data); got != UTF8 {
			t.Errorf("%s: Detect = %q, want %q", c.name, got, UTF8)
		}
		// UTF-8 must come back byte for byte, including the BOM: the caller
		// streams it from disk instead of re-encoding a copy.
		if out, charset := ToUTF8(c.data); charset != UTF8 || !bytes.Equal(out, c.data) {
			t.Errorf("%s: ToUTF8 = %q/%q, want unchanged", c.name, out, charset)
		}
	}
}

func TestDetectUTF16(t *testing.T) {
	text := "hello 你好"
	bomCases := []struct {
		name string
		enc  encoding.Encoding
		want Charset
	}{
		{"le with bom", unicode.UTF16(unicode.LittleEndian, unicode.UseBOM), UTF16LE},
		{"be with bom", unicode.UTF16(unicode.BigEndian, unicode.UseBOM), UTF16BE},
	}
	for _, c := range bomCases {
		data := encode(t, c.enc, text)
		if got := Detect(data); got != c.want {
			t.Errorf("%s: Detect = %q, want %q", c.name, got, c.want)
		}
		out, charset := ToUTF8(data)
		if charset != c.want {
			t.Errorf("%s: charset = %q, want %q", c.name, charset, c.want)
		}
		if string(out) != text {
			t.Errorf("%s: ToUTF8 = %q, want %q", c.name, out, text)
		}
	}

	// No BOM: ASCII-heavy UTF-16 is recognized by which side the NUL bytes are
	// on, because the stream is otherwise perfectly valid UTF-8.
	le := encode(t, unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM), "plain ascii text")
	be := encode(t, unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM), "plain ascii text")
	if got := Detect(le); got != UTF16LE {
		t.Errorf("BOM-less LE: Detect = %q, want %q", got, UTF16LE)
	}
	if got := Detect(be); got != UTF16BE {
		t.Errorf("BOM-less BE: Detect = %q, want %q", got, UTF16BE)
	}
	if out, _ := ToUTF8(le); string(out) != "plain ascii text" {
		t.Errorf("BOM-less LE: ToUTF8 = %q", out)
	}
	if out, _ := ToUTF8(be); string(out) != "plain ascii text" {
		t.Errorf("BOM-less BE: ToUTF8 = %q", out)
	}
}

func TestDetectLegacyEastAsian(t *testing.T) {
	// Every sample below contains at least one byte pair that GB18030 cannot
	// map; that is exactly what lets the fallback chain past it. Chinese GBK
	// does not need the fallback: GB18030 is tried first and decodes it.
	cases := []struct {
		name string
		enc  encoding.Encoding
		want Charset
		text string
	}{
		{
			"gbk",
			simplifiedchinese.GBK,
			GB18030,
			"本字幕由人人影视翻译制作，更多美剧字幕请登陆我们的网站。",
		},
		{
			"big5",
			traditionalchinese.Big5,
			Big5,
			"本字幕由人人影視翻譯製作，更多美劇字幕請登陸我們的網站。",
		},
		{
			"shift_jis",
			japanese.ShiftJIS,
			ShiftJIS,
			"ｷﾞｬｰ ﾋﾄﾞｲ ﾔﾒﾃ ｸﾚｰ",
		},
	}
	for _, c := range cases {
		data := encode(t, c.enc, c.text)
		if got := Detect(data); got != c.want {
			t.Errorf("%s: Detect = %q, want %q", c.name, got, c.want)
		}
		out, charset := ToUTF8(data)
		if charset != c.want {
			t.Errorf("%s: charset = %q, want %q", c.name, charset, c.want)
		}
		if string(out) != c.text {
			t.Errorf("%s: ToUTF8 = %q, want %q", c.name, out, c.text)
		}
	}
}

// The guard that matters most: a GBK stream is also valid Big5, and its Big5
// reading looks like plausible Chinese. GB18030 has to win on priority, not on
// any property of the decoded characters.
func TestDetectGBKStaysGB18030(t *testing.T) {
	text := "这是一个测试文件，用来验证编码探测是否正确。你们知道吗？我们已经完成翻译了。"
	data := encode(t, simplifiedchinese.GBK, text)
	if got := Detect(data); got != GB18030 {
		t.Fatalf("Detect = %q, want %q", got, GB18030)
	}
	out, _ := ToUTF8(data)
	if string(out) != text {
		t.Fatalf("ToUTF8 = %q, want %q", out, text)
	}
}

func TestToUTF8UndecodableBytes(t *testing.T) {
	// Not valid UTF-8 and not a complete legacy sequence either: the answer has
	// to stay valid UTF-8 with the surrounding ASCII intact, instead of failing
	// the whole request.
	data := []byte{0x41, 0xFF, 0xFE, 0x42}
	out, charset := ToUTF8(data)
	if charset != GB18030 {
		t.Errorf("charset = %q, want %q", charset, GB18030)
	}
	if !utf8.Valid(out) {
		t.Errorf("ToUTF8 result is not valid UTF-8: %q", out)
	}
	if !bytes.HasPrefix(out, []byte("A")) {
		t.Errorf("ASCII around the bad bytes was lost: %q", out)
	}
}

func TestParseCharset(t *testing.T) {
	for _, name := range []string{"utf-8", "UTF-8", " gb18030 ", "Shift_JIS", "utf-16le"} {
		if _, ok := ParseCharset(name); !ok {
			t.Errorf("ParseCharset(%q) rejected a known charset", name)
		}
	}
	for _, name := range []string{"", "  ", "latin-1", "utf-32", "gbk"} {
		if got, ok := ParseCharset(name); ok {
			t.Errorf("ParseCharset(%q) = %q, want a rejection", name, got)
		}
	}
}

// A file has to come back byte for byte after a round trip through the editor:
// detect it, decode it, encode it again. GBK is the case that matters (it is
// served as GB18030, which shares its byte layout).
func TestEncodeRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		enc  encoding.Encoding
		want Charset
		text string
	}{
		{"gbk", simplifiedchinese.GBK, GB18030, "1\r\n00:00:10,000 --> 00:00:15,000\r\n本字幕由人人影视翻译制作\r\n"},
		{"big5", traditionalchinese.Big5, Big5, "本字幕由人人影視翻譯製作，更多美劇字幕請登陸我們的網站。"},
		{"shift_jis", japanese.ShiftJIS, ShiftJIS, "ｷﾞｬｰ ﾋﾄﾞｲ ﾔﾒﾃ ｸﾚｰ"},
	}
	for _, c := range cases {
		original := encode(t, c.enc, c.text)
		decoded, charset := ToUTF8(original)
		if charset != c.want {
			t.Errorf("%s: charset = %q, want %q", c.name, charset, c.want)
			continue
		}
		back, err := Encode(decoded, charset)
		if err != nil {
			t.Errorf("%s: Encode: %v", c.name, err)
			continue
		}
		if !bytes.Equal(back, original) {
			t.Errorf("%s: re-encoded bytes differ\n got % x\nwant % x", c.name, back, original)
		}
	}
}

func TestEncodeUTF16RoundTrip(t *testing.T) {
	text := "hello 你好\r\n"
	for _, charset := range []Charset{UTF16LE, UTF16BE} {
		data, err := Encode([]byte(text), charset)
		if err != nil {
			t.Fatalf("%s: Encode: %v", charset, err)
		}
		if got := Detect(data); got != charset {
			t.Errorf("%s: Detect = %q, want the same charset", charset, got)
		}
		back, _ := ToUTF8(data)
		if string(back) != text {
			t.Errorf("%s: round trip = %q, want %q", charset, back, text)
		}
	}
}

func TestEncodeRejectsUnrepresentable(t *testing.T) {
	if _, err := Encode([]byte("中文😀"), Big5); err == nil {
		t.Error("Encode accepted an emoji for Big5")
	}
	// UTF-8 and GB18030 both cover it, so the failure is about the target, not
	// about the text being unusual.
	if _, err := Encode([]byte("中文😀"), GB18030); err != nil {
		t.Errorf("GB18030 should represent the emoji: %v", err)
	}
	if _, err := Encode([]byte("中文"), "latin-1"); err == nil {
		t.Error("Encode accepted an unknown charset")
	}
}
