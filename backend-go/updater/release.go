package updater

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"file-lite-go/config"
)

// GitHub release updates. The backend resolves the release, selects the asset
// for its own platform, verifies the asset digest, and hands the binary to
// Install. The browser only sees the result and progress events.

const (
	releaseRepo       = "canwdev/file-lite"
	releaseAPIBase    = "https://api.github.com/repos/" + releaseRepo
	maxAssetSize      = 128 << 20
	checkCacheTTL     = time.Minute
	releaseAPITimeout = 20 * time.Second
	downloadTimeout   = 10 * time.Minute
)

// Channel selects which releases the updater looks at.
type Channel string

const (
	ChannelStable  Channel = "stable"
	ChannelPreview Channel = "preview"
)

func ParseChannel(raw string) (Channel, error) {
	switch Channel(raw) {
	case ChannelStable:
		return ChannelStable, nil
	case ChannelPreview:
		return ChannelPreview, nil
	default:
		return "", fmt.Errorf("unknown update channel %q", raw)
	}
}

// ReleaseAsset is the selected release asset.
type ReleaseAsset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Digest string `json:"digest,omitempty"`
	URL    string `json:"-"`
}

// UpdateInfo is the update-check response.
type UpdateInfo struct {
	Current     string       `json:"current"`
	Latest      string       `json:"latest"`
	Available   bool         `json:"available"`
	Tag         string       `json:"tag"`
	NotesURL    string       `json:"notesUrl"`
	PublishedAt string       `json:"publishedAt,omitempty"`
	Prerelease  bool         `json:"prerelease"`
	Asset       ReleaseAsset `json:"asset"`
}

// Progress is one update progress event.
type Progress struct {
	Phase    string `json:"phase"`
	Received int64  `json:"received,omitempty"`
	Total    int64  `json:"total,omitempty"`
	Percent  int    `json:"percent,omitempty"`
}

type ProgressFunc func(Progress)

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	HTMLURL     string        `json:"html_url"`
	Prerelease  bool          `json:"prerelease"`
	PublishedAt time.Time     `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	Digest             string `json:"digest"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

var (
	releaseCheckCache = struct {
		sync.Mutex
		entries map[Channel]cachedReleaseCheck
	}{entries: map[Channel]cachedReleaseCheck{}}

	releaseTagPattern = regexp.MustCompile(`^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)
)

type cachedReleaseCheck struct {
	at   time.Time
	info UpdateInfo
}

// Check resolves the newest release for the channel and compares it with the
// running build. Successful checks are cached briefly so repeated clicks do not
// burn the unauthenticated GitHub rate limit.
func Check(ctx context.Context, channel Channel) (UpdateInfo, error) {
	releaseCheckCache.Lock()
	cached, ok := releaseCheckCache.entries[channel]
	releaseCheckCache.Unlock()
	if ok && time.Since(cached.at) < checkCacheTTL {
		return cached.info, nil
	}

	release, err := fetchRelease(ctx, channel)
	if err != nil {
		return UpdateInfo{}, err
	}
	asset, err := selectReleaseAsset(release.Assets, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return UpdateInfo{}, err
	}

	current := currentBuildTag()
	comparison, err := compareSemver(release.TagName, current)
	if err != nil {
		return UpdateInfo{}, err
	}

	info := UpdateInfo{
		Current:    current,
		Latest:     release.TagName,
		Available:  comparison > 0,
		Tag:        release.TagName,
		NotesURL:   release.HTMLURL,
		Prerelease: release.Prerelease,
		Asset: ReleaseAsset{
			Name:   asset.Name,
			Size:   asset.Size,
			Digest: asset.Digest,
			URL:    asset.BrowserDownloadURL,
		},
	}
	if !release.PublishedAt.IsZero() {
		info.PublishedAt = release.PublishedAt.UTC().Format(time.RFC3339)
	}

	releaseCheckCache.Lock()
	releaseCheckCache.entries[channel] = cachedReleaseCheck{at: time.Now(), info: info}
	releaseCheckCache.Unlock()
	return info, nil
}

// DownloadAndInstall downloads the release asset for this platform, verifies
// its digest, extracts the binary and replaces the running executable. The
// caller is responsible for restarting after the response is sent.
func DownloadAndInstall(ctx context.Context, tag string, emit ProgressFunc) error {
	if !releaseTagPattern.MatchString(tag) {
		return fmt.Errorf("invalid release tag %q", tag)
	}
	release, err := fetchReleaseByTag(ctx, tag)
	if err != nil {
		return err
	}
	asset, err := selectReleaseAsset(release.Assets, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	if asset.Digest == "" {
		return errors.New("release asset has no sha256 digest")
	}

	dir, err := os.MkdirTemp("", "file-lite-update-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	archivePath := path.Join(dir, "release.zip")
	if err := downloadAsset(ctx, asset, archivePath, emit); err != nil {
		return err
	}
	if emit != nil {
		emit(Progress{Phase: "verify"})
	}
	if err := verifyAssetDigest(archivePath, asset.Digest); err != nil {
		return err
	}

	if emit != nil {
		emit(Progress{Phase: "extract"})
	}
	binaryPath := path.Join(dir, config.PkgName)
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}
	if err := extractReleaseBinary(archivePath, binaryPath); err != nil {
		return err
	}

	if emit != nil {
		emit(Progress{Phase: "install", Percent: 95})
	}
	binary, err := os.Open(binaryPath)
	if err != nil {
		return err
	}
	defer binary.Close()

	if _, err := Install(binary); err != nil {
		return err
	}
	return nil
}

func currentBuildTag() string {
	if config.BuildTag != "" {
		return config.BuildTag
	}
	return "v" + config.Version
}

func fetchRelease(ctx context.Context, channel Channel) (githubRelease, error) {
	switch channel {
	case ChannelStable:
		var release githubRelease
		if err := githubGetJSON(ctx, releaseAPIBase+"/releases/latest", &release); err != nil {
			return githubRelease{}, err
		}
		return release, nil
	case ChannelPreview:
		var releases []githubRelease
		if err := githubGetJSON(ctx, releaseAPIBase+"/releases?per_page=20", &releases); err != nil {
			return githubRelease{}, err
		}
		for _, release := range releases {
			if release.Prerelease {
				return release, nil
			}
		}
		return githubRelease{}, errors.New("no pre-release found")
	default:
		return githubRelease{}, fmt.Errorf("unknown update channel %q", channel)
	}
}

func fetchReleaseByTag(ctx context.Context, tag string) (githubRelease, error) {
	var release githubRelease
	err := githubGetJSON(ctx, releaseAPIBase+"/releases/tags/"+url.PathEscape(tag), &release)
	return release, err
}

func githubGetJSON(ctx context.Context, rawURL string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, releaseAPITimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", config.PkgName+"/"+config.Version)
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: releaseAPITimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request GitHub release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		if resp.StatusCode == http.StatusForbidden && resp.Header.Get("X-RateLimit-Remaining") == "0" {
			return errors.New("GitHub API rate limit reached, try again later")
		}
		return fmt.Errorf("GitHub release request failed: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

func platformTargetDir(goos, goarch string) (string, bool) {
	var osName string
	switch goos {
	case "windows":
		osName = "windows"
	case "linux":
		osName = "linux"
	case "darwin":
		osName = "mac"
	default:
		return "", false
	}
	switch goarch {
	case "amd64", "arm64", "386":
	default:
		return "", false
	}
	if goos == "linux" && goarch == "386" {
		return "", false
	}
	if goos == "darwin" && goarch == "386" {
		return "", false
	}
	return osName + "_" + goarch, true
}

func selectReleaseAsset(assets []githubAsset, goos, goarch string) (githubAsset, error) {
	target, ok := platformTargetDir(goos, goarch)
	if !ok {
		return githubAsset{}, fmt.Errorf("updates are not available for %s/%s", goos, goarch)
	}
	prefix := "file-lite-" + target + "-"
	var found *githubAsset
	for i := range assets {
		name := assets[i].Name
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".zip") {
			if found != nil {
				return githubAsset{}, fmt.Errorf("multiple release assets match %s", target)
			}
			found = &assets[i]
		}
	}
	if found == nil {
		return githubAsset{}, fmt.Errorf("release has no asset for %s", target)
	}
	if found.Size > maxAssetSize {
		return githubAsset{}, fmt.Errorf("release asset is larger than %d MB", maxAssetSize>>20)
	}
	return *found, nil
}

func downloadAsset(ctx context.Context, asset githubAsset, dest string, emit ProgressFunc) error {
	parsed, err := url.Parse(asset.BrowserDownloadURL)
	if err != nil {
		return err
	}
	if parsed.Scheme != "https" || !isGitHubDownloadHost(parsed.Hostname()) {
		return fmt.Errorf("unexpected release asset host %q", parsed.Host)
	}

	ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", config.PkgName+"/"+config.Version)

	resp, err := (&http.Client{Timeout: downloadTimeout}).Do(req)
	if err != nil {
		return fmt.Errorf("download release asset: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download release asset: %s", resp.Status)
	}

	total := asset.Size
	if total <= 0 {
		total = resp.ContentLength
	}
	if emit != nil {
		emit(Progress{Phase: "download", Total: total})
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	writer := &progressWriter{emit: emit, total: total}
	_, err = io.Copy(io.MultiWriter(out, writer), io.LimitReader(resp.Body, maxAssetSize+1))
	if err != nil {
		return err
	}
	if writer.received > maxAssetSize {
		return fmt.Errorf("release asset is larger than %d MB", maxAssetSize>>20)
	}
	return nil
}

func isGitHubDownloadHost(host string) bool {
	switch strings.ToLower(host) {
	case "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com":
		return true
	default:
		return false
	}
}

type progressWriter struct {
	emit     ProgressFunc
	total    int64
	received int64
	last     time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.received += int64(len(p))
	now := time.Now()
	if w.emit != nil && (now.Sub(w.last) >= 200*time.Millisecond || (w.total > 0 && w.received >= w.total)) {
		w.last = now
		w.emit(Progress{Phase: "download", Received: w.received, Total: w.total})
	}
	return len(p), nil
}

func verifyAssetDigest(filePath, digest string) error {
	const prefix = "sha256:"
	if !strings.HasPrefix(strings.ToLower(digest), prefix) {
		return errors.New("release asset has no sha256 digest")
	}
	want := strings.ToLower(strings.TrimSpace(digest[len(prefix):]))

	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return err
	}
	got := hex.EncodeToString(hash.Sum(nil))
	if got != want {
		return fmt.Errorf("release asset checksum mismatch: got %s, want %s", got, want)
	}
	return nil
}

// extractReleaseBinary accepts both the current nested layout
// (<platform>/file-lite-go) and the flat layout (file-lite-go at the root), so
// releases published before the zip layout changed remain installable.
func extractReleaseBinary(archivePath, destPath string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open release archive: %w", err)
	}
	defer reader.Close()

	var match *zip.File
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		name := strings.ReplaceAll(file.Name, "\\", "/")
		base := path.Base(name)
		if base != config.PkgName && base != config.PkgName+".exe" {
			continue
		}
		if strings.Count(strings.Trim(name, "/"), "/") > 1 {
			continue
		}
		if match != nil {
			return fmt.Errorf("release archive contains more than one %s binary", config.PkgName)
		}
		match = file
	}
	if match == nil {
		return fmt.Errorf("release archive has no %s binary", config.PkgName)
	}
	if match.UncompressedSize64 > maxBinarySize {
		return fmt.Errorf("binary is larger than %d MB", maxBinarySize>>20)
	}

	src, err := match.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer dst.Close()

	written, err := io.Copy(dst, io.LimitReader(src, maxBinarySize+1))
	if err != nil {
		return err
	}
	if written > maxBinarySize {
		return fmt.Errorf("binary is larger than %d MB", maxBinarySize>>20)
	}
	return nil
}

type semverParts struct {
	nums [3]int
	pre  []string
}

func parseSemver(raw string) (semverParts, error) {
	s := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	core := s
	var pre []string
	if i := strings.IndexByte(s, '-'); i >= 0 {
		core = s[:i]
		pre = strings.Split(s[i+1:], ".")
		for _, part := range pre {
			if part == "" {
				return semverParts{}, fmt.Errorf("invalid version %q", raw)
			}
		}
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return semverParts{}, fmt.Errorf("invalid version %q", raw)
	}
	var parsed semverParts
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return semverParts{}, fmt.Errorf("invalid version %q", raw)
		}
		parsed.nums[i] = n
	}
	parsed.pre = pre
	return parsed, nil
}

func compareSemver(a, b string) (int, error) {
	left, err := parseSemver(a)
	if err != nil {
		return 0, err
	}
	right, err := parseSemver(b)
	if err != nil {
		return 0, err
	}
	for i := 0; i < 3; i++ {
		if left.nums[i] != right.nums[i] {
			if left.nums[i] < right.nums[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	switch {
	case len(left.pre) == 0 && len(right.pre) == 0:
		return 0, nil
	case len(left.pre) == 0:
		return 1, nil
	case len(right.pre) == 0:
		return -1, nil
	}
	return comparePrerelease(left.pre, right.pre), nil
}

func comparePrerelease(left, right []string) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		leftNum, leftErr := strconv.Atoi(left[i])
		rightNum, rightErr := strconv.Atoi(right[i])
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNum != rightNum {
				if leftNum < rightNum {
					return -1
				}
				return 1
			}
		case leftErr == nil:
			return -1
		case rightErr == nil:
			return 1
		default:
			if cmp := strings.Compare(left[i], right[i]); cmp != 0 {
				return cmp
			}
		}
	}
	switch {
	case len(left) == len(right):
		return 0
	case len(left) < len(right):
		return -1
	default:
		return 1
	}
}
