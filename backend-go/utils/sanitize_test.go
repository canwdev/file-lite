package utils

import (
	"mime"
	"strings"
	"testing"
)

// TestContentDispositionRoundTrip 锁住两个曾经让下载出问题的点：
//   - filename* 是 RFC 5987 的百分号编码，空格必须是 %20；
//     url.QueryEscape 会把空格编成 "+"，而 ext-value 里的 "+" 是字面加号，
//     结果带空格的文件名下载下来变成加号。
//   - 加了 "+"/"%" 等字符的名字必须能被客户端解回原名。
func TestContentDispositionRoundTrip(t *testing.T) {
	names := []string{
		"a b.txt",
		"039.+Vexento+-+Borealis.mp3",
		"100%.txt",
		"中文 文件.txt",
		"quote\"and\\slash.txt",
	}

	for _, name := range names {
		// Sanitize 会换掉引号、反斜杠这类会破坏头部的字符，所以比较的是清洗后的名字；
		// 前四个用例的名字不含这些字符，等价于「原样往返」。
		want := Sanitize(name, "_")
		for _, header := range []string{AttachmentDisposition(name), InlineDisposition(name)} {
			_, params, err := mime.ParseMediaType(header)
			if err != nil {
				t.Fatalf("header for %q is not parseable: %v (%s)", name, err, header)
			}
			if got := params["filename"]; got != want {
				t.Fatalf("filename* round-trip failed: %q decoded back as %q, want %q (%s)", name, got, want, header)
			}
			// 头部里不能出现裸换行（响应头注入）
			if strings.ContainsAny(header, "\r\n") {
				t.Fatalf("header contains a raw newline: %q", header)
			}
		}
	}
}

func TestContentDispositionEncodesSpaceAsPercent20(t *testing.T) {
	header := AttachmentDisposition("a b.txt")
	if !strings.Contains(header, "filename*=UTF-8''a%20b.txt") {
		t.Fatalf("space must be %%20 in the RFC 5987 value, got %q", header)
	}
	if strings.Contains(header, "''a+b.txt") {
		t.Fatalf("space must not be encoded as \"+\", got %q", header)
	}
}

func TestContentDispositionKeepsLiteralPlus(t *testing.T) {
	header := AttachmentDisposition("a+b.txt")
	if !strings.Contains(header, "filename*=UTF-8''a%2Bb.txt") {
		t.Fatalf("a literal plus must be %%2B, got %q", header)
	}
}

func TestContentDispositionSanitizesTheHeaderValue(t *testing.T) {
	// 文件名里的引号与反斜杠不能破坏头部的引号包裹
	_, params, err := mime.ParseMediaType(AttachmentDisposition(`we"ird\name.txt`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(params["filename"], `"`) || strings.Contains(params["filename"], `\`) {
		t.Fatalf("fallback filename must be sanitized, got %q", params["filename"])
	}
}
