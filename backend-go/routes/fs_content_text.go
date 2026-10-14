package routes

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/textencoding"
)

// textCharsetHeader carries the encoding a text representation lives in. The
// content endpoint sets it on GET — the body is always UTF-8, so this is the
// only way a client learns what the file really is — and a client that wants
// its write stored that way sends the same header back on PUT.
const textCharsetHeader = "X-Text-Charset"

// maxTextDecodeSize bounds the text the encoding probe and the encoder are
// allowed to hold in memory. The text editor opens files up to 5 MB on its own;
// a larger text file (a huge CSV, say) is streamed as it is instead.
const maxTextDecodeSize = 16 << 20

// textExtensions are the extensions whose bytes are text.
//
// The list mirrors regSupportedTextFormat in frontend/src/utils/is.ts — the
// formats the explorer opens with the text editor — plus the subtitle formats the
// video player loads. Keep the two lists in step.
const textExtensions = `
	txt csv md log lock ini conf config json jsonc json5 har
	js mjs cjs jsx ts tsx py java c cpp h hpp cs rb go php
	html htm hta xml yaml yml css scss sass styl less vue
	bat cmd ps1 sh env editorconfig gitignore gitattributes dockerfile makefile
	sql graphql gql jsonl properties toml rtf tex bib tsv svg map lrc reg url
	srt vtt ass ssa sub
`

var textExtensionSet = func() map[string]struct{} {
	set := make(map[string]struct{})
	for _, ext := range strings.Fields(textExtensions) {
		set["."+ext] = struct{}{}
	}
	return set
}()

// isTextPath reports whether the content endpoint should decode this path.
func isTextPath(path string) bool {
	_, ok := textExtensionSet[strings.ToLower(filepath.Ext(path))]
	return ok
}

// utf8ContentType keeps the file's own media type but pins the charset: the body
// that goes out is UTF-8 even when the file on disk is not.
func utf8ContentType(path string) string {
	base, _, err := mime.ParseMediaType(mime.TypeByExtension(strings.ToLower(filepath.Ext(path))))
	if err != nil || base == "" {
		return "text/plain; charset=utf-8"
	}
	return base + "; charset=utf-8"
}

// inlineText is what the content endpoint knows about a text file it is about to
// serve: the encoding on disk, and its content when that encoding is not UTF-8.
type inlineText struct {
	charset textencoding.Charset
	utf8    []byte
}

// readInlineText reads a text file and decides how it should leave the server.
//
// ok=false means "stream the bytes as they are": an attachment (a download has
// to stay byte-exact), a file too large to hold in memory, or a path that is not
// text at all. f is left at the start either way, so the caller can use it for
// both outcomes.
func readInlineText(f *os.File, path string, st os.FileInfo, attachment bool) (inlineText, bool) {
	if attachment || st.Size() > maxTextDecodeSize || !isTextPath(path) {
		return inlineText{}, false
	}
	data, err := io.ReadAll(io.LimitReader(f, maxTextDecodeSize+1))
	if _, seekErr := f.Seek(0, io.SeekStart); seekErr != nil {
		return inlineText{}, false
	}
	if err != nil || int64(len(data)) > maxTextDecodeSize {
		return inlineText{}, false
	}
	decoded, charset := textencoding.ToUTF8(data)
	text := inlineText{charset: charset}
	if charset != textencoding.UTF8 {
		text.utf8 = decoded
	}
	return text, true
}

// requestedCharset reads the encoding a client wants its write stored in.
//
// An absent header, or "utf-8", means the body goes to disk as it arrives: the
// upload path must keep streaming, and UTF-8 never needs an encoder.
func requestedCharset(c echo.Context) (textencoding.Charset, *apierr.Error) {
	raw := strings.TrimSpace(c.Request().Header.Get(textCharsetHeader))
	if raw == "" {
		return "", nil
	}
	charset, ok := textencoding.ParseCharset(raw)
	if !ok {
		return "", apierr.BadRequest(apierr.CodeBadRequest, "Unsupported charset: "+raw)
	}
	if charset == textencoding.UTF8 {
		return "", nil
	}
	return charset, nil
}

// encodeUploadBody reads a UTF-8 request body and converts it for storage. It is
// only reached when the client asked for a non-UTF-8 target, so the streaming
// path for ordinary uploads is untouched.
func encodeUploadBody(c echo.Context, charset textencoding.Charset) ([]byte, *apierr.Error) {
	data, err := io.ReadAll(io.LimitReader(c.Request().Body, maxTextDecodeSize+1))
	if err != nil {
		return nil, apierr.BadRequest(apierr.CodeBadRequest, "Failed to read the request body")
	}
	if int64(len(data)) > maxTextDecodeSize {
		return nil, apierr.PayloadTooLarge("Text is too large to convert")
	}
	out, err := textencoding.Encode(data, charset)
	if err != nil {
		return nil, apierr.BadRequest(apierr.CodeBadRequest,
			fmt.Sprintf("The text contains characters that %s cannot encode", charset))
	}
	return out, nil
}
