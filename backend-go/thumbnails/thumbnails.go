// Package thumbnails 生成图片缩略图：解码 → 等比缩放 → 编码。
//
// 设计前提是「后端不持久化缩略图」：
//   - 唯一的服务端缓存是进程内、按字节上限的 LRU，重启即空，不写任何文件；
//   - 每个 key 的并发生成用 singleflight 合并，避免首屏重复解码同一张图；
//   - 解码/缩放是 CPU 与内存大头，因此有全局并发闸门 + 源像素上限（防解压炸弹）。
//
// 前端会把结果存进 IndexedDB，并把 (path, size, mtime) 作为指纹做失效判断。
package thumbnails

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"io"
	"os"
	"time"

	"github.com/disintegration/imaging"
	// x/image/webp 只提供解码器；注册进 image.Decode / image.DecodeConfig。
	// jpeg/png/gif 由 image 包自带，bmp/tiff 由 imaging 内部引入。
	_ "golang.org/x/image/webp"

	"file-lite-go/config"
)

const (
	// MaxEdge 是允许请求的最大边长（缩略图的目标方框）。
	MaxEdge = 512

	// maxDecodedBytes 限制单次解码的**估算**内存占用。
	//
	// 只卡像素数是不够的：16 位格式(PNG/TIFF)解出来是 *image.NRGBA64，
	// 每像素 8 字节而不是 4，同样的像素数要占两倍内存。
	// 320MB ≈ 8 位 80MP 或 16 位 40MP；配合 decodeConcurrency=2，
	// 解码器本身的内存峰值约 640MB。目标是 NAS / 树莓派时把这里减半。
	maxDecodedBytes = 320 << 20

	defaultCacheBytes  = 128 << 20
	maxCacheEntryBytes = 4 << 20
	decodeConcurrency  = 2

	// maxSourceBytes 是「保险丝」：像素上限管解码内存，这一条管磁盘 I/O 与解码时间。
	//
	// 像素上限挡不住读取量：TIFF 的 reader 按偏移惰性增长缓冲区且从不收缩，
	// 若首页数据位于文件末尾，一个 1GB 的 TIFF 会被整体读入内存 —— 而它的
	// 像素数完全可能在上限之内。256MB 足够覆盖正常的大尺寸扫描图，
	// 同时挡住这类病态文件。只按 stat 判断，不读任何内容。
	maxSourceBytes = 256 << 20

	// acquireTimeout 是等待解码槽位的上限，超过则返回 ErrBusy 而不是无限排队。
	acquireTimeout = 30 * time.Second

	// genVersion 参与缓存键与 ETag。改动生成参数（滤镜/质量/输出格式）时递增，
	// 新旧结果就不会混用。
	genVersion = 1
)

// allowedEdges 是允许的边长档位。请求值向上取到最近的档位，
// 避免调用方随意取值把前端 IndexedDB 的 key 空间打散。
var allowedEdges = [...]int{64, 128, 256, 512}

var (
	// ErrNotFound 表示路径不存在或不是文件。
	ErrNotFound = errors.New("thumbnail: file not found")
	// ErrUnsupported 表示不是可解码的图片/视频（含格式不支持、文件损坏、动画 WebP 等）。
	ErrUnsupported = errors.New("thumbnail: unsupported image format")
	// ErrTooLarge 表示源文件体积或解码后占用超过上限。
	ErrTooLarge = errors.New("thumbnail: source image too large")
	// ErrBusy 表示等待解码槽位超时。
	ErrBusy = errors.New("thumbnail: too many pending jobs")
	// ErrUnavailable 表示该能力在这台机器上不可用（典型是没有 ffmpeg）。
	// 路由层映射成 HTTP 501：前端把它当作「能力关闭」，而不是这个文件出了问题。
	ErrUnavailable = errors.New("thumbnail: feature unavailable")
)

// Kind 区分缩略图的来源类型。它参与缓存键与 ETag，所以同一个路径的
// 图片缩略图和视频封面不会互相覆盖。
type Kind string

const (
	KindImage Kind = "image"
	KindVideo Kind = "video"
)

// ParseKind 解析 kind 查询参数；未知/缺省一律按图片处理。
func ParseKind(s string) Kind {
	if s == string(KindVideo) {
		return KindVideo
	}
	return KindImage
}

// Options 用于构造 Service；零值字段取默认值。
type Options struct {
	CacheBytes  int64
	Concurrency int
	// AcquireTimeout 是等待解码槽位的上限，超时返回 ErrBusy(HTTP 503)。
	// 超过它宁可让前端显示图标，也不无限排队把请求堆在内存里。
	AcquireTimeout time.Duration
	// MaxSourceBytes 是允许参与**图片**生成的源文件体积上限，超过直接返回 ErrTooLarge。
	// 视频不适用这条：几 GB 的影片是常态，视频靠 VideoTimeout 兜底。
	MaxSourceBytes int64
	// FFmpegPath 返回 ffmpeg 可执行文件路径；返回空串表示在 PATH 中查找。
	// 做成函数是因为 Default 在 config 加载之前就构造了，路径要延迟到请求时再读。
	FFmpegPath func() string
	// VideoConcurrency 是同时运行的 ffmpeg 进程数上限。零值取默认。
	VideoConcurrency int
	// VideoTimeout 是单个 ffmpeg 进程的运行上限。零值取默认。
	VideoTimeout time.Duration
}

// Service 持有 LRU、并发闸门与 singleflight 表。
type Service struct {
	cache          *lruCache
	sem            chan struct{}
	videoSem       chan struct{}
	group          *flightGroup
	acquireTimeout time.Duration
	maxSourceBytes int64
	videoTimeout   time.Duration
	ffmpeg         ffmpegState
}

// Default 是路由使用的进程级实例。
var Default = New(Options{
	CacheBytes:  defaultCacheBytes,
	Concurrency: decodeConcurrency,
	FFmpegPath:  func() string { return config.Config().FFmpegPath },
})

func New(opts Options) *Service {
	if opts.CacheBytes <= 0 {
		opts.CacheBytes = defaultCacheBytes
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = decodeConcurrency
	}
	if opts.AcquireTimeout <= 0 {
		opts.AcquireTimeout = acquireTimeout
	}
	if opts.MaxSourceBytes <= 0 {
		opts.MaxSourceBytes = maxSourceBytes
	}
	if opts.VideoConcurrency <= 0 {
		opts.VideoConcurrency = defaultVideoConcurrency
	}
	if opts.VideoTimeout <= 0 {
		opts.VideoTimeout = defaultVideoTimeout
	}
	return &Service{
		cache:          newLRUCache(opts.CacheBytes, maxCacheEntryBytes),
		sem:            make(chan struct{}, opts.Concurrency),
		videoSem:       make(chan struct{}, opts.VideoConcurrency),
		group:          newFlightGroup(),
		acquireTimeout: opts.AcquireTimeout,
		maxSourceBytes: opts.MaxSourceBytes,
		videoTimeout:   opts.VideoTimeout,
		ffmpeg:         ffmpegState{pathFn: opts.FFmpegPath},
	}
}

// NormalizeEdge 把请求边长规整到允许的档位：向上取最近档，缺省/越界取 MaxEdge。
func NormalizeEdge(v int) int {
	if v <= 0 {
		return MaxEdge
	}
	for _, e := range allowedEdges {
		if v <= e {
			return e
		}
	}
	return MaxEdge
}

// ETag 由「类型 + 生成参数版本 + 文件大小 + 修改时间 + 边长」组成，
// 任一变化都会让客户端已缓存的缩略图失效。
func ETag(kind Kind, fi os.FileInfo, edge int) string {
	return fmt.Sprintf(`"th%s%d-%x-%x-%d"`, kind, genVersion, fi.Size(), fi.ModTime().UnixMilli(), edge)
}

func cacheKey(kind Kind, path string, edge int, fi os.FileInfo) string {
	return fmt.Sprintf("%s\x00%s\x00%d\x00%d\x00%d", kind, path, edge, fi.Size(), fi.ModTime().UnixNano())
}

// Get 返回缩略图字节与 Content-Type。
// 命中 LRU 直接返回；未命中则合并同 key 的并发请求后生成。
func (s *Service) Get(ctx context.Context, path string, edge int, kind Kind) ([]byte, string, error) {
	fi, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", ErrNotFound
		}
		return nil, "", err
	}
	if fi.IsDir() {
		return nil, "", ErrNotFound
	}

	key := cacheKey(kind, path, edge, fi)
	if data, ct, ok := s.cache.Get(key); ok {
		return data, ct, nil
	}

	if kind == KindVideo {
		// 视频封面能力没开就没有「生成」这一步可言，直接如实上报。
		if _, ok := s.ffmpegBinary(); !ok {
			return nil, "", ErrUnavailable
		}
	} else if fi.Size() > s.maxSourceBytes {
		// 保险丝：超过体积上限的图片一律不生成。放在缓存查询之后，
		// 这样文件后来变大时，已缓存的缩略图仍然可用。
		// 不适用于视频：几 GB 的影片是常态。
		return nil, "", ErrTooLarge
	}

	ch := s.group.DoChan(key, func() flightResult {
		return s.generate(ctx, kind, path, edge, key)
	})

	select {
	case <-ctx.Done():
		// 客户端已取消（滚动出视野）：不再等结果，也不影响正在生成的其他请求。
		return nil, "", ctx.Err()
	case res := <-ch:
		return res.data, res.ct, res.err
	}
}

type flightResult struct {
	data []byte
	ct   string
	err  error
}

func (s *Service) generate(ctx context.Context, kind Kind, path string, edge int, key string) flightResult {
	if kind == KindVideo {
		return s.generateVideo(ctx, path, edge, key)
	}
	return s.generateImage(path, edge, key)
}

func (s *Service) generateImage(path string, edge int, key string) flightResult {
	select {
	case s.sem <- struct{}{}:
	case <-time.After(s.acquireTimeout):
		return flightResult{err: ErrBusy}
	}
	defer func() { <-s.sem }()

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return flightResult{err: ErrNotFound}
		}
		return flightResult{err: err}
	}
	defer f.Close()

	data, ct, err := encode(f, edge)
	if err != nil {
		return flightResult{err: err}
	}
	s.cache.Add(key, data, ct)
	return flightResult{data: data, ct: ct}
}

// bytesPerPixel 估算 DecodeConfig 报告的 ColorModel 解码后每像素占用的字节数。
// 未知模型一律按 4 处理（保守）。
func bytesPerPixel(m color.Model) int64 {
	switch m {
	case color.GrayModel:
		return 1
	case color.Gray16Model, color.Alpha16Model:
		return 2
	case color.RGBA64Model, color.NRGBA64Model:
		return 8
	case color.YCbCrModel, color.NYCbCrAModel:
		// 实际取决于色度子采样(1.5~3 字节/像素)，取上界
		return 3
	}
	// NRGBA / RGBA / Alpha / CMYK、调色板以及未知模型
	return 4
}

// checkSize 在真正解码之前，按「像素数 × 每像素字节数」估算内存占用并卡上限。
// 只读文件头，与文件体积无关。
func checkSize(cfg image.Config) error {
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return ErrUnsupported
	}
	estimated := int64(cfg.Width) * int64(cfg.Height) * bytesPerPixel(cfg.ColorModel)
	if estimated > maxDecodedBytes {
		return ErrTooLarge
	}
	return nil
}

// encode 是纯函数部分：只依赖一个可 Seek 的读取器，方便单测。
func encode(r io.ReadSeeker, edge int) ([]byte, string, error) {
	// 先只读头部，把「解压炸弹」挡在解码之前。
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	if err := checkSize(cfg); err != nil {
		return nil, "", err
	}

	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, "", err
	}

	// AutoOrientation 必须开：手机照片靠 EXIF 方向标记，不开的话网格里会躺倒。
	img, err := imaging.Decode(r, imaging.AutoOrientation(true))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrUnsupported, err)
	}

	// Fit = 等比放进方框且不放大（源图更小时返回原样拷贝）。
	// 注意 imaging.Thumbnail 是「居中裁剪成正方形」，不是这里要的语义。
	out := imaging.Fit(img, edge, edge, imaging.Lanczos)

	var buf bytes.Buffer
	if out.Opaque() {
		// 无透明通道走 JPEG：同样画质下比 PNG 小一个数量级。
		if err := imaging.Encode(&buf, out, imaging.JPEG, imaging.JPEGQuality(82)); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/jpeg", nil
	}
	// 有透明通道必须走 PNG：JPEG 会把 alpha 压成黑色。
	if err := imaging.Encode(&buf, out, imaging.PNG); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/png", nil
}
