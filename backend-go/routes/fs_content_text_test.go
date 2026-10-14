package routes

import (
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

// Subtitle files are CRLF on disk; an LF-only fixture would hide a line-ending
// bug in the decode/encode round trip.
const gbkSubtitle = "1\r\n00:00:10,000 --> 00:00:15,000\r\n本字幕由人人影视翻译制作\r\n"

func writeBytes(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeGBK(t *testing.T, dir, name, text string) string {
	t.Helper()
	data, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(text))
	if err != nil {
		t.Fatalf("encode gbk: %v", err)
	}
	return writeBytes(t, dir, name, data)
}

func TestIsTextPath(t *testing.T) {
	cases := map[string]bool{
		"/videos/sub.srt":   true,
		"/videos/SUB.SRT":   true,
		"/notes/readme.md":  true,
		"/data/doc.jsonc":   true,
		"/notes/.gitignore": true,
		"/clips/movie.mp4":  false,
		"/pics/photo.png":   false,
		"/docs/README":      false,
		"/back/a.tar.gz":    false,
	}
	for path, want := range cases {
		if got := isTextPath(path); got != want {
			t.Errorf("isTextPath(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestUTF8ContentType(t *testing.T) {
	for _, path := range []string{"/a/sub.srt", "/a/notes.txt", "/a/page.html"} {
		got := utf8ContentType(path)
		base, params, err := mime.ParseMediaType(got)
		if err != nil {
			t.Fatalf("utf8ContentType(%q) = %q, not a media type: %v", path, got, err)
		}
		if params["charset"] != "utf-8" || !strings.Contains(base, "/") {
			t.Errorf("utf8ContentType(%q) = %q, want a real type with charset=utf-8", path, got)
		}
	}
}

// The editor and the subtitle loader both assume UTF-8, so a GBK file has to
// arrive decoded and labelled as UTF-8.
func TestContentDecodesGBKTextInline(t *testing.T) {
	dir := t.TempDir()
	file := writeGBK(t, dir, "sub.srt", gbkSubtitle)

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != gbkSubtitle {
		t.Fatalf("body = %q, want %q", body, gbkSubtitle)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "charset=utf-8") {
		t.Errorf("Content-Type = %q, want a utf-8 charset", ct)
	}
	if got, want := rec.Header().Get("Content-Length"), strconv.Itoa(len(gbkSubtitle)); got != want {
		t.Errorf("Content-Length = %q, want %s (the decoded length, not the file size)", got, want)
	}

	// The validator still works on the representation that was sent.
	req := httptest.NewRequest(http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)), nil)
	req.Header.Set("If-None-Match", rec.Header().Get("ETag"))
	again := httptest.NewRecorder()
	e.ServeHTTP(again, req)
	if again.Code != http.StatusNotModified {
		t.Fatalf("conditional GET = %d, want 304", again.Code)
	}
}

// Range is served over the decoded representation: three UTF-8 bytes are one
// Chinese character, where the GBK pair on disk is two bytes in a different
// position. Slicing the raw file would hand the client a broken character.
func TestContentRangeOnDecodedText(t *testing.T) {
	dir := t.TempDir()
	file := writeGBK(t, dir, "sub.srt", "本字幕由\n")

	e := newRESTTestServer()
	req := httptest.NewRequest(http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)), nil)
	req.Header.Set("Range", "bytes=0-2")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", rec.Code)
	}
	if got, want := rec.Body.String(), "本"; got != want {
		t.Fatalf("range body = %q, want %q", got, want)
	}
}

// A download has to be byte-exact: the attachment form never decodes.
func TestContentAttachmentKeepsOriginalBytes(t *testing.T) {
	dir := t.TempDir()
	text := "本字幕由人人影视翻译制作\n"
	raw, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	file := writeBytes(t, dir, "sub.srt", raw)

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet,
		encodedEntryURL("/api/fs/content", filepath.ToSlash(file))+"?disposition=attachment")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.Bytes(); string(body) != string(raw) {
		t.Fatalf("attachment body = %x, want the original bytes %x", body, raw)
	}
	if ct := rec.Header().Get("Content-Type"); strings.Contains(ct, "charset=utf-8") {
		t.Errorf("attachment Content-Type = %q, must not claim the decoded charset", ct)
	}
}

// Already-UTF-8 text is streamed from disk, byte for byte.
func TestContentLeavesUTF8TextAlone(t *testing.T) {
	dir := t.TempDir()
	text := "本字幕由人人影视翻译制作\n"
	file := writeBytes(t, dir, "sub.srt", []byte(text))

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != text {
		t.Fatalf("body = %q, want %q", body, text)
	}
}

func TestContentDecodesUTF16Text(t *testing.T) {
	dir := t.TempDir()
	text := "note: 你好\n"
	data, err := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewEncoder().Bytes([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	file := writeBytes(t, dir, "note.txt", data)

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != text {
		t.Fatalf("body = %q, want %q", body, text)
	}
}

// Media and other binary content is never touched, whatever its bytes are.
func TestContentLeavesBinaryAlone(t *testing.T) {
	dir := t.TempDir()
	raw := []byte{0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0xB1, 0xBE, 0xFF, 0xFE}
	file := writeBytes(t, dir, "clip.mp4", raw)

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != string(raw) {
		t.Fatalf("media body = %x, want the original bytes %x", body, raw)
	}
}

// HEAD promises the same headers as GET, so the decoded length has to show up
// there too.
func TestContentHEADMatchesDecodedLength(t *testing.T) {
	dir := t.TempDir()
	file := writeGBK(t, dir, "sub.srt", gbkSubtitle)

	e := newRESTTestServer()
	rec := requestREST(t, e, http.MethodHead, encodedEntryURL("/api/fs/content", filepath.ToSlash(file)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got, want := rec.Header().Get("Content-Length"), strconv.Itoa(len(gbkSubtitle)); got != want {
		t.Errorf("Content-Length = %q, want %s", got, want)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("HEAD returned a body of %d bytes", rec.Body.Len())
	}
}

func TestContentSetsCharsetHeader(t *testing.T) {
	dir := t.TempDir()
	gbk := writeGBK(t, dir, "sub.srt", gbkSubtitle)
	// ASS is a subtitle format the video player also loads, so it has to be
	// decoded like the others.
	ass := writeGBK(t, dir, "sub.ass", "[Script Info]\nTitle: 本字幕由人人影视翻译制作\n")
	utf8 := writeBytes(t, dir, "note.txt", []byte("你好\n"))
	binary := writeBytes(t, dir, "clip.mp4", []byte{0x00, 0x01, 0xFF, 0xFE})

	e := newRESTTestServer()
	cases := []struct {
		file string
		want string
	}{
		{gbk, "gb18030"},
		{ass, "gb18030"},
		{utf8, "utf-8"},
		{binary, ""},
	}
	for _, c := range cases {
		rec := requestREST(t, e, http.MethodGet, encodedEntryURL("/api/fs/content", filepath.ToSlash(c.file)))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", c.file, rec.Code)
		}
		if got := rec.Header().Get(textCharsetHeader); got != c.want {
			t.Errorf("%s: %s = %q, want %q", filepath.Base(c.file), textCharsetHeader, got, c.want)
		}
	}
}

// The editor hands the charset back on save, so the UTF-8 text it edited lands
// on disk in the file's own encoding.
func TestPutEncodesToRequestedCharset(t *testing.T) {
	dir := t.TempDir()
	file := writeGBK(t, dir, "sub.srt", gbkSubtitle)
	target := encodedEntryURL("/api/fs/content", filepath.ToSlash(file))

	edited := gbkSubtitle + "新的一行\n"
	e := newRESTTestServer()
	rec := restRequest(t, e, http.MethodPut, target, edited, map[string]string{
		textCharsetHeader: "gb18030",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}

	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	want, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(want) {
		t.Fatalf("on-disk bytes = % x, want GBK % x", raw, want)
	}
	if utf8.Valid(raw) {
		t.Error("the file on disk is still UTF-8; the charset header was ignored")
	}

	back := requestREST(t, e, http.MethodGet, target)
	if back.Body.String() != edited {
		t.Fatalf("read back = %q, want %q", back.Body.String(), edited)
	}
}

func TestPutRejectsCharsetItCannotEncode(t *testing.T) {
	dir := t.TempDir()
	file := writeGBK(t, dir, "sub.srt", gbkSubtitle)
	target := encodedEntryURL("/api/fs/content", filepath.ToSlash(file))

	e := newRESTTestServer()
	for _, c := range []struct {
		name    string
		charset string
		body    string
	}{
		{"unknown charset", "latin-1", gbkSubtitle},
		{"unrepresentable rune", "big5", "簡體字😀"},
	} {
		rec := restRequest(t, e, http.MethodPut, target, c.body, map[string]string{
			textCharsetHeader: c.charset,
		})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", c.name, rec.Code, rec.Body.String())
		}
	}
	if raw, err := os.ReadFile(file); err != nil || string(raw) != string(mustGBK(t, gbkSubtitle)) {
		t.Errorf("a rejected write must leave the file alone: %q, %v", raw, err)
	}
}

func mustGBK(t *testing.T, text string) []byte {
	t.Helper()
	out, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return out
}
