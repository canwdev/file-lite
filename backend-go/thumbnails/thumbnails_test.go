package thumbnails

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestNormalizeEdge(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{0, 512},
		{-1, 512},
		{1, 64},
		{64, 64},
		{65, 128},
		{100, 128},
		{128, 128},
		{200, 256},
		{256, 256},
		{300, 512},
		{512, 512},
		{4096, 512},
	}
	for _, c := range cases {
		if got := NormalizeEdge(c.in); got != c.want {
			t.Errorf("NormalizeEdge(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

// writePNGChunk 写一个带正确 CRC 的 PNG chunk。
// Go 的 png 解码器不校验 CRC，但手工构造一个合法的头部更稳妥。
func writePNGChunk(buf *bytes.Buffer, typ string, data []byte) {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(data)))
	buf.Write(length[:])

	sum := crc32.NewIEEE()
	_, _ = io.WriteString(sum, typ)
	_, _ = sum.Write(data)

	buf.WriteString(typ)
	buf.Write(data)

	var crc [4]byte
	binary.BigEndian.PutUint32(crc[:], sum.Sum32())
	buf.Write(crc[:])
}

// oversizedPNG 构造一个「头部声称 40000×40000（16 亿像素）」的 PNG：
// 不需要真的分配图像数据，就能验证解压炸弹是否被 DecodeConfig 挡下。
func oversizedPNG() []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})

	data := make([]byte, 13)
	binary.BigEndian.PutUint32(data[0:4], 40000)
	binary.BigEndian.PutUint32(data[4:8], 40000)
	data[8] = 8 // bit depth
	data[9] = 6 // color type: RGBA
	writePNGChunk(&buf, "IHDR", data)

	return buf.Bytes()
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return buf.Bytes()
}

func TestEncodePicksFormatByAlpha(t *testing.T) {
	opaque := image.NewNRGBA(image.Rect(0, 0, 40, 20))
	for i := range opaque.Pix {
		opaque.Pix[i] = 0xff
	}

	withAlpha := image.NewNRGBA(image.Rect(0, 0, 40, 20))
	for i := range withAlpha.Pix {
		withAlpha.Pix[i] = 0xff
	}
	withAlpha.SetNRGBA(0, 0, color.NRGBA{R: 0xff, A: 0})

	cases := []struct {
		name     string
		raw      []byte
		wantType string
	}{
		{"opaque -> jpeg", encodePNG(t, opaque), "image/jpeg"},
		{"alpha -> png", encodePNG(t, withAlpha), "image/png"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data, ct, err := encode(bytes.NewReader(c.raw), MaxEdge)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if ct != c.wantType {
				t.Fatalf("content type = %q, want %q", ct, c.wantType)
			}
			if len(data) == 0 {
				t.Fatal("empty output")
			}
			// 输出必须真的能被解回图片
			if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
				t.Fatalf("output is not a decodable image: %v", err)
			}
		})
	}
}

func TestEncodeDownscalesToEdge(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 2000, 1000))
	for i := range src.Pix {
		src.Pix[i] = 0xff
	}

	data, _, err := encode(bytes.NewReader(encodePNG(t, src)), 256)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if cfg.Width != 256 || cfg.Height != 128 {
		t.Fatalf("output size = %dx%d, want 256x128", cfg.Width, cfg.Height)
	}
}

func TestEncodeRejectsNonImageAndBomb(t *testing.T) {
	if _, _, err := encode(bytes.NewReader([]byte("definitely not an image")), MaxEdge); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("garbage: got %v, want ErrUnsupported", err)
	}
	if _, _, err := encode(bytes.NewReader(oversizedPNG()), MaxEdge); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("bomb: got %v, want ErrTooLarge", err)
	}
}

func TestBytesPerPixel(t *testing.T) {
	cases := []struct {
		name  string
		model color.Model
		want  int64
	}{
		{"gray", color.GrayModel, 1},
		{"gray16", color.Gray16Model, 2},
		{"nrgba", color.NRGBAModel, 4},
		{"rgba", color.RGBAModel, 4},
		{"nrgba64", color.NRGBA64Model, 8},
		{"rgba64", color.RGBA64Model, 8},
		{"ycbcr", color.YCbCrModel, 3},
		{"palette (保守取 4)", color.Palette{color.Black, color.White}, 4},
	}
	for _, c := range cases {
		if got := bytesPerPixel(c.model); got != c.want {
			t.Errorf("%s: bytesPerPixel = %d, want %d", c.name, got, c.want)
		}
	}
}

// 同样 42MP，8 位放行、16 位拒绝 —— 这正是「只卡像素数」会漏掉的情况。
func TestCheckSizeAccountsForBitDepth(t *testing.T) {
	samePixels := func(m color.Model) image.Config {
		return image.Config{Width: 7000, Height: 6000, ColorModel: m}
	}

	if err := checkSize(samePixels(color.NRGBAModel)); err != nil {
		t.Fatalf("42MP 8-bit (168MB) should pass: %v", err)
	}
	if err := checkSize(samePixels(color.NRGBA64Model)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("42MP 16-bit (336MB) should be rejected: got %v", err)
	}

	// 8 位的上限仍是 80MP
	if err := checkSize(image.Config{Width: 8000, Height: 10000, ColorModel: color.NRGBAModel}); err != nil {
		t.Fatalf("80MP 8-bit should pass: %v", err)
	}
	if err := checkSize(image.Config{Width: 9500, Height: 9500, ColorModel: color.NRGBAModel}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("90MP 8-bit should be rejected: got %v", err)
	}

	if err := checkSize(image.Config{Width: 0, Height: 100, ColorModel: color.NRGBAModel}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("empty dimensions should be ErrUnsupported: got %v", err)
	}
}

// 端到端确认：16 位 PNG 的 DecodeConfig 确实报告 8 字节/像素的模型。
// 若这里退化成 4，说明上游改了行为，checkSize 的估算需要跟着改。
func TestDecodeConfigReports16BitModel(t *testing.T) {
	img := image.NewNRGBA64(image.Rect(0, 0, 32, 32))
	raw := func() []byte {
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatalf("encode 16-bit png: %v", err)
		}
		return buf.Bytes()
	}()

	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if got := bytesPerPixel(cfg.ColorModel); got != 8 {
		t.Fatalf("16-bit PNG reported %d bytes/pixel (model %T), want 8", got, cfg.ColorModel)
	}
	if cfg.Width != 32 || cfg.Height != 32 {
		t.Fatalf("size = %dx%d, want 32x32", cfg.Width, cfg.Height)
	}
}

// 真实 WebP fixture（由纯 Go 的 nativewebp 编码器生成），用来验证：
// 静态 WebP 能解码（blank import 生效），而动画 WebP 必然失败 ——
// 这正是前端需要「415 → 回退原图直连」而不是「一律显示图标」的原因。
const (
	staticWebPBase64   = "UklGRkIBAABXRUJQVlA4TDYBAAAvB0ABAE1kRP/DJYBIAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAEAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUM0SRbYG"
	animatedWebPBase64 = "UklGRtACAABXRUJQVlA4WAoAAAACAAAABwAABQAAQU5JTQYAAAD/////AABBTk1GTgEAAAAAAAAAAAcAAAUAAGQAAABWUDhMNgEAAC8HQAEATWRE/8MlgEgGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQ/4hsDQBBTk1GTgEAAAAAAAAAAAcAAAUAAGQAAABWUDhMNgEAAC8HQAEATWRE/8MlgEgGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ/Y9sDQA="
)

func decodeFixture(t *testing.T, b64 string) []byte {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return raw
}

func TestEncodeWebPSupport(t *testing.T) {
	t.Run("static webp decodes", func(t *testing.T) {
		data, _, err := encode(bytes.NewReader(decodeFixture(t, staticWebPBase64)), MaxEdge)
		if err != nil {
			t.Fatalf("static webp should decode: %v", err)
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			t.Fatalf("output is not a decodable image: %v", err)
		}
	})

	t.Run("animated webp is reported as unsupported", func(t *testing.T) {
		// x/image/webp 只处理静态图：VP8X 头之后遇到 ANIM/ANMF 会走到 EOF 报格式错误。
		// 前端必须据此回退原图直连，否则动画 WebP 会退化成类型图标。
		if _, _, err := encode(bytes.NewReader(decodeFixture(t, animatedWebPBase64)), MaxEdge); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("animated webp: got %v, want ErrUnsupported", err)
		}
	})
}

func TestEncodeGifUsesFirstFrame(t *testing.T) {
	pal := color.Palette{color.Black, color.White}
	frames := []*image.Paletted{
		image.NewPaletted(image.Rect(0, 0, 4, 4), pal),
		image.NewPaletted(image.Rect(0, 0, 4, 4), pal),
	}
	frames[1].SetColorIndex(0, 0, 1)

	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{Image: frames, Delay: []int{10, 10}}); err != nil {
		t.Fatalf("encode gif fixture: %v", err)
	}

	// 动图只取第一帧：这是网格缩略图的预期行为
	data, ct, err := encode(bytes.NewReader(buf.Bytes()), MaxEdge)
	if err != nil {
		t.Fatalf("gif should decode: %v", err)
	}
	if ct != "image/jpeg" {
		t.Fatalf("content type = %q, want image/jpeg（第一帧为不透明纯色）", ct)
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		t.Fatalf("output is not a decodable image: %v", err)
	}
}

func TestLRUEvictsByBytes(t *testing.T) {
	c := newLRUCache(10, 100)
	blob := func() []byte { return make([]byte, 4) }

	c.Add("a", blob(), "ct")
	c.Add("b", blob(), "ct")
	c.Add("c", blob(), "ct") // 12 > 10 → 淘汰最旧的 a

	if _, _, ok := c.Get("a"); ok {
		t.Fatal("a should have been evicted")
	}
	if _, _, ok := c.Get("b"); !ok {
		t.Fatal("b should still be cached")
	}

	// Get 会提升 b 的最近使用顺序，于是下一个淘汰的是 c 而不是 b
	c.Add("d", blob(), "ct")

	if _, _, ok := c.Get("c"); ok {
		t.Fatal("c should have been evicted")
	}
	if _, _, ok := c.Get("b"); !ok {
		t.Fatal("b should have survived (recently used)")
	}
	if _, _, ok := c.Get("d"); !ok {
		t.Fatal("d should be cached")
	}
	if got := c.Bytes(); got != 8 {
		t.Fatalf("bytes = %d, want 8", got)
	}
}

func TestLRUSkipsOversizedEntry(t *testing.T) {
	c := newLRUCache(1000, 5)
	c.Add("big", make([]byte, 6), "ct")
	if c.Len() != 0 {
		t.Fatalf("oversized entry should be skipped, len = %d", c.Len())
	}
	c.Add("ok", make([]byte, 5), "ct")
	if c.Len() != 1 {
		t.Fatalf("entry at the limit should be cached, len = %d", c.Len())
	}
}

func TestFlightGroupDedupes(t *testing.T) {
	g := newFlightGroup()
	var calls int32
	release := make(chan struct{})

	fn := func() flightResult {
		atomic.AddInt32(&calls, 1)
		<-release
		return flightResult{data: []byte("payload"), ct: "ct"}
	}

	const n = 8
	chans := make([]<-chan flightResult, n)
	for i := range chans {
		chans[i] = g.DoChan("same-key", fn)
	}
	close(release)

	for i, ch := range chans {
		res := <-ch
		if res.err != nil || string(res.data) != "payload" {
			t.Fatalf("waiter %d got %+v", i, res)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("generator ran %d times, want 1", got)
	}
}

func writeFixture(t *testing.T, name string, img image.Image) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	f, err := os.Create(p)
	if err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
	return p
}

func opaqueFixture(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 0xff
	}
	return img
}

func TestServiceCachesAndServes(t *testing.T) {
	p := writeFixture(t, "a.png", opaqueFixture(64, 32))
	s := New(Options{CacheBytes: 1 << 20, Concurrency: 2})

	data, ct, err := s.Get(context.Background(), p, MaxEdge)
	if err != nil {
		t.Fatalf("first Get: %v", err)
	}
	if ct != "image/jpeg" || len(data) == 0 {
		t.Fatalf("unexpected result: ct=%q len=%d", ct, len(data))
	}
	if s.cache.Len() != 1 {
		t.Fatalf("result should be cached, len = %d", s.cache.Len())
	}

	second, _, err := s.Get(context.Background(), p, MaxEdge)
	if err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if !bytes.Equal(data, second) {
		t.Fatal("cached result differs from the generated one")
	}

	// 不同边长必须是不同的缓存条目
	if _, _, err := s.Get(context.Background(), p, 128); err != nil {
		t.Fatalf("Get with another edge: %v", err)
	}
	if s.cache.Len() != 2 {
		t.Fatalf("edge should be part of the cache key, len = %d", s.cache.Len())
	}
}

func TestServiceErrors(t *testing.T) {
	dir := t.TempDir()
	s := New(Options{CacheBytes: 1 << 20, Concurrency: 1})

	if _, _, err := s.Get(context.Background(), filepath.Join(dir, "missing.png"), MaxEdge); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing file: got %v, want ErrNotFound", err)
	}
	if _, _, err := s.Get(context.Background(), dir, MaxEdge); !errors.Is(err, ErrNotFound) {
		t.Fatalf("directory: got %v, want ErrNotFound", err)
	}

	bomb := filepath.Join(dir, "bomb.png")
	if err := os.WriteFile(bomb, oversizedPNG(), 0o644); err != nil {
		t.Fatalf("write bomb: %v", err)
	}
	if _, _, err := s.Get(context.Background(), bomb, MaxEdge); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("bomb: got %v, want ErrTooLarge", err)
	}
}

func TestServiceRejectsOversizedSourceFile(t *testing.T) {
	p := writeFixture(t, "a.png", opaqueFixture(64, 32))

	// 上限压到 1 字节：保险丝必须在解码之前生效
	s := New(Options{CacheBytes: 1 << 20, Concurrency: 1, MaxSourceBytes: 1})
	if _, _, err := s.Get(context.Background(), p, MaxEdge); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized source: got %v, want ErrTooLarge", err)
	}

	// 保险丝放在缓存查询之后：文件后来变大时，已缓存的缩略图仍然可用
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatalf("stat fixture: %v", err)
	}
	s.cache.Add(cacheKey(p, MaxEdge, fi), []byte("cached-thumb"), "image/jpeg")

	data, ct, err := s.Get(context.Background(), p, MaxEdge)
	if err != nil {
		t.Fatalf("cached entry should still be served: %v", err)
	}
	if string(data) != "cached-thumb" || ct != "image/jpeg" {
		t.Fatalf("got %q / %q, want the cached entry", data, ct)
	}
}

func TestServiceReturnsBusyWhenSaturated(t *testing.T) {
	p := writeFixture(t, "a.png", opaqueFixture(64, 32))
	// 占住唯一的解码槽位，并把排队上限压到 1ms：
	// 请求不该无限排队，而应尽快返回 ErrBusy（路由层映射成 HTTP 503）。
	s := New(Options{CacheBytes: 1 << 20, Concurrency: 1, AcquireTimeout: time.Millisecond})
	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	if _, _, err := s.Get(context.Background(), p, MaxEdge); !errors.Is(err, ErrBusy) {
		t.Fatalf("got %v, want ErrBusy", err)
	}
}

func TestServiceReturnsOnCanceledContext(t *testing.T) {
	p := writeFixture(t, "a.png", opaqueFixture(64, 32))
	// 并发度 1 + 一个占住槽位的任务，让第二个请求排队；
	// ctx 取消后应立即返回，而不是等生成完成。
	s := New(Options{CacheBytes: 1 << 20, Concurrency: 1})
	s.sem <- struct{}{} // 占住唯一的解码槽位，让生成逻辑必然阻塞
	defer func() { <-s.sem }()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, _, err := s.Get(ctx, p, MaxEdge); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}
