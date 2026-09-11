package thumbnails

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	// videoFrameOffset 是取帧时间点。不用 0：很多视频首帧是纯黑场。
	// 用固定偏移而不引 ffprobe，避免多一个需要探测的二进制；
	// 短视频取不到帧时会自动退回 0 再试一次。
	videoFrameOffset = "3"

	// maxVideoThumbBytes 是单帧输出的上限，防畸形容器产出巨图。
	maxVideoThumbBytes = 4 << 20

	// defaultVideoConcurrency 是同时运行的 ffmpeg 进程数上限。
	// ffmpeg 比图片解码重一个数量级，所以单独开一道**更窄**的闸：
	// 否则几个视频封面就能占满图片解码头，把整屏图片缩略图拖到 503。
	defaultVideoConcurrency = 1

	// defaultVideoTimeout 是单个 ffmpeg 进程的运行上限。
	defaultVideoTimeout = 20 * time.Second

	// videoAcquireTimeout 是等待 ffmpeg 槽位的上限，比图片那条（30s）短得多。
	// 这个槽位只有 1 个：等太久会让前端的预览并发槽位（总共才 5 个）被白白占住，
	// 而超时的代价只是退化成类型图标，不值得等。
	videoAcquireTimeout = 5 * time.Second

	// ffmpegProbeTTL 是「没找到 ffmpeg」这个结论的缓存时长。
	// 到点会重试，这样用户装完 ffmpeg 不必重启进程。
	ffmpegProbeTTL = 60 * time.Second
)

// ffmpegState 缓存 ffmpeg 的探测结果。
type ffmpegState struct {
	mu         sync.Mutex
	pathFn     func() string
	resolved   string
	ok         bool
	checkedAt  time.Time
	lastLookup string
}

// ffmpegBinary 解析可用的 ffmpeg 路径。
// 成功结论在进程生命周期内永久缓存；失败结论只缓存 ffmpegProbeTTL。
func (s *Service) ffmpegBinary() (string, bool) {
	f := &s.ffmpeg

	f.mu.Lock()
	defer f.mu.Unlock()

	now := time.Now()
	if f.ok {
		return f.resolved, true
	}
	if !f.checkedAt.IsZero() && now.Sub(f.checkedAt) < ffmpegProbeTTL {
		return "", false
	}
	f.checkedAt = now

	configured := ""
	if f.pathFn != nil {
		configured = strings.TrimSpace(f.pathFn())
	}
	if configured != "" {
		if _, err := os.Stat(configured); err != nil {
			f.lastLookup = configured
			return "", false
		}
		f.resolved = configured
		f.ok = true
		return f.resolved, true
	}

	found, err := exec.LookPath("ffmpeg")
	if err != nil {
		f.lastLookup = "ffmpeg (PATH)"
		return "", false
	}
	f.resolved = found
	f.ok = true
	return f.resolved, true
}

// VideoAvailable 报告视频封面能力是否可用（供 /api/files/auth 上报）。
func (s *Service) VideoAvailable() bool {
	_, ok := s.ffmpegBinary()
	return ok
}

func (s *Service) generateVideo(ctx context.Context, path string, edge int, key string) flightResult {
	bin, ok := s.ffmpegBinary()
	if !ok {
		return flightResult{err: ErrUnavailable}
	}

	select {
	case s.videoSem <- struct{}{}:
	case <-time.After(s.videoAcquireTimeout):
		return flightResult{err: ErrBusy}
	}
	defer func() { <-s.videoSem }()

	data, err := extractVideoFrame(ctx, bin, path, edge, s.videoTimeout)
	if err != nil {
		return flightResult{err: err}
	}

	// ffmpeg 直接输出已缩放好的 JPEG，不需要再过一遍 imaging。
	s.cache.Add(key, data, "image/jpeg")
	return flightResult{data: data, ct: "image/jpeg"}
}

// extractVideoFrame 先按固定偏移取帧，失败再退回第 0 帧重试一次
// （短视频在 -ss 3 处可能已经越过结尾）。
func extractVideoFrame(ctx context.Context, bin, src string, edge int, timeout time.Duration) ([]byte, error) {
	data, err := runFFmpeg(ctx, bin, src, edge, timeout, videoFrameOffset)
	if err == nil {
		return data, nil
	}
	if ctx.Err() != nil {
		return nil, err
	}
	return runFFmpeg(ctx, bin, src, edge, timeout, "0")
}

// ffmpegArgs 单独抽出来便于断言。
func ffmpegArgs(src string, edge int, offset string) []string {
	return []string{
		"-nostdin", // 不加会抢父进程的 stdin
		"-hide_banner", "-loglevel", "error",
		// -ss 放在 -i **之前**：跳到关键帧即可，不必从头解码。
		// 放到 -i 之后是精确定位，但两小时的片子会直接超时。
		"-ss", offset,
		"-i", src,
		"-frames:v", "1",
		// min(edge,iw) 保证不放大；逗号在滤镜参数里要转义。
		"-vf", fmt.Sprintf(`scale=min(%d\,iw):-2`, edge),
		"-threads", "1", // 单次 ffmpeg 别吃满所有核，因为会并发跑多个
		"-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5",
		"pipe:1",
	}
}

func runFFmpeg(ctx context.Context, bin, src string, edge int, timeout time.Duration, offset string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin, ffmpegArgs(src, edge, offset)...)
	var out cappedBuffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%w: ffmpeg timed out after %s", ErrUnsupported, timeout)
		}
		return nil, fmt.Errorf("%w: ffmpeg failed: %v: %s", ErrUnsupported, err, firstLine(stderr.String()))
	}
	if out.truncated {
		return nil, fmt.Errorf("%w: ffmpeg frame exceeded %d bytes", ErrUnsupported, maxVideoThumbBytes)
	}
	if out.buf.Len() == 0 {
		return nil, fmt.Errorf("%w: ffmpeg produced no frame", ErrUnsupported)
	}
	return out.buf.Bytes(), nil
}

// cappedBuffer 收集 stdout，超过上限就丢弃后续内容并记录下来。
// 必须始终返回 len(p)：如果返回实际写入的字节数，exec 会因为
// 「short write」把它当成写失败而中断进程。
type cappedBuffer struct {
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	room := maxVideoThumbBytes - b.buf.Len()
	if room <= 0 {
		b.truncated = true
		return n, nil
	}
	if n > room {
		p = p[:room]
		b.truncated = true
	}
	_, _ = b.buf.Write(p)
	return n, nil
}

// firstLine 把 ffmpeg 的 stderr 压成一行短消息，避免把多行日志塞进错误里。
func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "(no output)"
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	const max = 200
	if len(s) > max {
		s = s[:max] + "…"
	}
	return s
}
