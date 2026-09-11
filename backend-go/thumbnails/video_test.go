package thumbnails

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 让测试进程把自己伪装成 ffmpeg：这样在没有安装 ffmpeg 的机器上，
// 「探测 → 执行 → 收集输出 → 入缓存 → 命中缓存」整条链路依然是真跑的，
// 只有最末端的解码器是假的。
const fakeFFmpegEnv = "FILE_LITE_TEST_FAKE_FFMPEG"

func TestMain(m *testing.M) {
	switch os.Getenv(fakeFFmpegEnv) {
	case "jpeg":
		_, _ = os.Stdout.Write(fakeFFmpegJPEG())
		os.Exit(0)
	case "fail":
		_, _ = os.Stderr.WriteString("fake ffmpeg: unknown codec\n")
		os.Exit(1)
	case "empty":
		os.Exit(0)
	case "huge":
		chunk := make([]byte, 1<<20)
		for i := 0; i < (maxVideoThumbBytes>>20)+2; i++ {
			_, _ = os.Stdout.Write(chunk)
		}
		os.Exit(0)
	case "failOnSeek":
		// 只有「-ss 3」失败，用来验证短视频取不到帧时会退回第 0 帧
		for i, a := range os.Args {
			if a == "-ss" && i+1 < len(os.Args) && os.Args[i+1] == videoFrameOffset {
				_, _ = os.Stderr.WriteString("fake ffmpeg: seek past end of file\n")
				os.Exit(1)
			}
		}
		_, _ = os.Stdout.Write(fakeFFmpegJPEG())
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func fakeFFmpegJPEG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 64, 36))
	for i := range img.Pix {
		img.Pix[i] = 0xcc
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// fakeFFmpegService 让 Service 把「ffmpeg」解析到测试二进制自己。
func fakeFFmpegService(t *testing.T, mode string) *Service {
	t.Helper()
	t.Setenv(fakeFFmpegEnv, mode)
	return New(Options{
		CacheBytes:   1 << 20,
		Concurrency:  1,
		FFmpegPath:   func() string { return os.Args[0] },
		VideoTimeout: 20 * time.Second,
	})
}

// writeDummyVideo 只需要是一个存在的普通文件：假的 ffmpeg 不会读它。
func writeDummyVideo(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(p, []byte("not really a video"), 0o644); err != nil {
		t.Fatalf("write dummy video: %v", err)
	}
	return p
}

func TestVideoThumbnailRunsFFmpegAndCaches(t *testing.T) {
	video := writeDummyVideo(t)
	s := fakeFFmpegService(t, "jpeg")

	data, ct, err := s.Get(context.Background(), video, MaxEdge, KindVideo)
	if err != nil {
		t.Fatalf("Get(video): %v", err)
	}
	if ct != "image/jpeg" {
		t.Fatalf("content type = %q, want image/jpeg", ct)
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		t.Fatalf("ffmpeg output should be decodable: %v", err)
	}

	// 命中 LRU：把假 ffmpeg 切成必然失败，仍然应该成功返回
	t.Setenv(fakeFFmpegEnv, "fail")
	if _, _, err := s.Get(context.Background(), video, MaxEdge, KindVideo); err != nil {
		t.Fatalf("second call should be served from the cache: %v", err)
	}
}

func TestVideoThumbnailRetriesAtZeroForShortClips(t *testing.T) {
	video := writeDummyVideo(t)
	s := fakeFFmpegService(t, "failOnSeek")

	if _, _, err := s.Get(context.Background(), video, MaxEdge, KindVideo); err != nil {
		t.Fatalf("should fall back to offset 0: %v", err)
	}
}

func TestVideoUnavailableWithoutFFmpeg(t *testing.T) {
	video := writeDummyVideo(t)
	s := New(Options{
		CacheBytes:  1 << 20,
		Concurrency: 1,
		// 指向一个不存在的路径：不依赖运行环境里是否真的装了 ffmpeg
		FFmpegPath: func() string { return filepath.Join(t.TempDir(), "no-such-ffmpeg") },
	})

	if s.VideoAvailable() {
		t.Fatal("VideoAvailable should be false")
	}
	if _, _, err := s.Get(context.Background(), video, MaxEdge, KindVideo); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
}

func TestVideoFailuresMapToUnsupported(t *testing.T) {
	// 这三种都该归为 ErrUnsupported（→ 415 → 前端显示类型图标，绝不下原片）
	for _, mode := range []string{"fail", "empty", "huge"} {
		t.Run(mode, func(t *testing.T) {
			video := writeDummyVideo(t)
			s := fakeFFmpegService(t, mode)
			if _, _, err := s.Get(context.Background(), video, MaxEdge, KindVideo); !errors.Is(err, ErrUnsupported) {
				t.Fatalf("got %v, want ErrUnsupported", err)
			}
		})
	}
}

func TestVideoIsExemptFromTheImageSizeFuse(t *testing.T) {
	// 几 GB 的影片是常态，图片那条 256MB 保险丝绝不能套到视频上
	video := writeDummyVideo(t)
	s := New(Options{
		CacheBytes:     1 << 20,
		Concurrency:    1,
		MaxSourceBytes: 1, // 图片会因此被拒
		FFmpegPath:     func() string { return os.Args[0] },
		VideoTimeout:   20 * time.Second,
	})
	t.Setenv(fakeFFmpegEnv, "jpeg")

	if _, _, err := s.Get(context.Background(), video, MaxEdge, KindImage); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("image should hit the fuse: got %v", err)
	}
	if _, _, err := s.Get(context.Background(), video, MaxEdge, KindVideo); err != nil {
		t.Fatalf("video should not hit the image fuse: %v", err)
	}
}

func indexOf(args []string, want string) int {
	for i, a := range args {
		if a == want {
			return i
		}
	}
	return -1
}

func TestFFmpegArgs(t *testing.T) {
	args := ffmpegArgs("/tmp/movie.mkv", 512, videoFrameOffset)

	if indexOf(args, "-nostdin") < 0 {
		t.Error("-nostdin 必须加，否则 ffmpeg 会抢父进程的 stdin")
	}
	// -ss 在 -i 之前才是快速定位；放到之后要从头解码，长片必然超时
	ss, in := indexOf(args, "-ss"), indexOf(args, "-i")
	if ss < 0 || in < 0 || ss > in {
		t.Errorf("-ss 必须在 -i 之前，实得 %v", args)
	}
	// 滤镜参数里的逗号必须转义，否则会被当成滤镜分隔符
	if !strings.Contains(strings.Join(args, " "), `scale=min(512\,iw):-2`) {
		t.Errorf("缩放表达式逗号未转义: %v", args)
	}
	if indexOf(args, "-threads") < 0 || args[indexOf(args, "-threads")+1] != "1" {
		t.Error("必须限制 -threads 1，否则单个 ffmpeg 会吃满所有核")
	}
	if args[len(args)-1] != "pipe:1" {
		t.Errorf("输出应写 stdout，实得 %q", args[len(args)-1])
	}
}

func TestCappedBufferAlwaysReportsFullLength(t *testing.T) {
	var b cappedBuffer
	// 超过上限之后仍然必须返回 len(p)，否则 exec 会把 short write 当成写失败
	n, err := b.Write(make([]byte, maxVideoThumbBytes+128))
	if err != nil || n != maxVideoThumbBytes+128 {
		t.Fatalf("Write = (%d, %v), want (%d, nil)", n, err, maxVideoThumbBytes+128)
	}
	if !b.truncated {
		t.Fatal("truncation should be recorded")
	}
	if b.buf.Len() != maxVideoThumbBytes {
		t.Fatalf("buffered = %d, want %d", b.buf.Len(), maxVideoThumbBytes)
	}
}
