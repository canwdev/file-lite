package routes

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/thumbnails"
)

func newThumbnailServer() *echo.Echo {
	e := echo.New()
	e.GET("/api/files/thumbnail", getThumbnail)
	return e
}

func requestThumbnail(t *testing.T, e *echo.Echo, q url.Values, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/files/thumbnail?"+q.Encode(), nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func writeJPEG(t *testing.T, dir, name string, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 0xff
	}
	p := filepath.Join(dir, name)
	f, err := os.Create(p)
	if err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return p
}

// oversizedPNG 构造一个头部声明超大尺寸的 PNG，用来触发 422。
func oversizedPNG() []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})

	data := make([]byte, 13)
	binary.BigEndian.PutUint32(data[0:4], 40000)
	binary.BigEndian.PutUint32(data[4:8], 40000)
	data[8] = 8
	data[9] = 6

	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(data)))
	buf.Write(length[:])

	sum := crc32.NewIEEE()
	_, _ = io.WriteString(sum, "IHDR")
	_, _ = sum.Write(data)

	buf.WriteString("IHDR")
	buf.Write(data)

	var crc [4]byte
	binary.BigEndian.PutUint32(crc[:], sum.Sum32())
	buf.Write(crc[:])
	return buf.Bytes()
}

func TestGetThumbnailServesAndRevalidates(t *testing.T) {
	e := newThumbnailServer()
	p := writeJPEG(t, t.TempDir(), "photo.jpg", 1024, 512)

	rec := requestThumbnail(t, e, url.Values{"path": {p}, "size": {"512"}}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content type = %q, want image/jpeg", ct)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag should be set")
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("response is not a decodable image: %v", err)
	}
	if cfg.Width != 512 || cfg.Height != 256 {
		t.Fatalf("thumbnail = %dx%d, want 512x256", cfg.Width, cfg.Height)
	}

	// 同一个 ETag 重放必须走 304 且不带 body
	again := requestThumbnail(t, e, url.Values{"path": {p}, "size": {"512"}}, etag)
	if again.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", again.Code)
	}
	if again.Body.Len() != 0 {
		t.Fatalf("304 should have an empty body, got %d bytes", again.Body.Len())
	}
}

func TestGetThumbnailNormalizesEdge(t *testing.T) {
	e := newThumbnailServer()
	p := writeJPEG(t, t.TempDir(), "photo.jpg", 1024, 512)

	// 100 会被向上取到允许的档位 128
	rec := requestThumbnail(t, e, url.Values{"path": {p}, "size": {"100"}}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if cfg.Width != 128 || cfg.Height != 64 {
		t.Fatalf("thumbnail = %dx%d, want 128x64", cfg.Width, cfg.Height)
	}
}

func TestAuthReportsCapabilities(t *testing.T) {
	e := echo.New()
	e.GET("/api/files/auth", getAuthInfo)

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/files/auth", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	// 只断言形状可解析：具体取值取决于这台机器是否装了 ffmpeg
	var body struct {
		Capabilities struct {
			VideoThumbnail bool `json:"videoThumbnail"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("capabilities payload is not the expected shape: %v (%s)", err, rec.Body.String())
	}
}

func TestGetThumbnailVideoUnavailableIs501(t *testing.T) {
	if thumbnails.Default.VideoAvailable() {
		t.Skip("这台机器装了 ffmpeg，走不到 501 分支")
	}
	e := newThumbnailServer()
	// 能力检查发生在读文件内容之前，所以内容是什么无所谓
	clip := writeJPEG(t, t.TempDir(), "clip.mp4", 64, 64)

	rec := requestThumbnail(t, e, url.Values{"path": {clip}, "kind": {"video"}}, "")
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501 (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestGetThumbnailErrorContract(t *testing.T) {
	e := newThumbnailServer()
	dir := t.TempDir()

	notImage := filepath.Join(dir, "notes.jpg")
	if err := os.WriteFile(notImage, []byte("this is not an image"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	bomb := filepath.Join(dir, "bomb.png")
	if err := os.WriteFile(bomb, oversizedPNG(), 0o644); err != nil {
		t.Fatalf("write bomb: %v", err)
	}

	cases := []struct {
		name string
		q    url.Values
		want int
	}{
		{"missing path param", url.Values{}, http.StatusBadRequest},
		{"missing file", url.Values{"path": {filepath.Join(dir, "nope.png")}}, http.StatusNotFound},
		{"directory", url.Values{"path": {dir}}, http.StatusNotFound},
		{"unsupported format", url.Values{"path": {notImage}}, http.StatusUnsupportedMediaType},
		{"too many pixels", url.Values{"path": {bomb}}, http.StatusUnprocessableEntity},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := requestThumbnail(t, e, c.q, "")
			if rec.Code != c.want {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, c.want, rec.Body.String())
			}
		})
	}
}
