package routes

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/fileops"
)

// mediaTestFile 建一个真实文件并返回它的 canonical 路径（链接签名用的是这个形态）。
func mediaTestFile(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	res, err := fileops.Resolve(filepath.ToSlash(p))
	if err != nil {
		t.Fatalf("resolve %s: %v", p, err)
	}
	return res.Path
}

func signedMediaLink(path string, expiresAt int64) string {
	return "/api/media/" + url.PathEscape(path) +
		"?exp=" + strconv.FormatInt(expiresAt, 10) +
		"&sig=" + url.QueryEscape(mediaLinkSignature(path, expiresAt))
}

func TestMediaLinkServesOneFileWithoutASession(t *testing.T) {
	path := mediaTestFile(t, "clip 名称.mkv", "abcdefghij")
	e := newRESTTestServer()

	rec := requestREST(t, e, http.MethodGet, signedMediaLink(path, time.Now().Add(time.Hour).Unix()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，期望 200：%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "abcdefghij" {
		t.Fatalf("body = %q，期望文件字节", rec.Body.String())
	}
	if got := rec.Header().Get(echo.HeaderContentDisposition); !strings.HasPrefix(got, "inline") {
		t.Errorf("Content-Disposition = %q，期望 inline（播放器按 URL 播放）", got)
	}
	if got := rec.Header().Get(echo.HeaderCacheControl); got != "private, max-age=0, must-revalidate" {
		t.Errorf("Cache-Control = %q，带凭据的 URL 不该进共享缓存", got)
	}
	if rec.Header().Get("ETag") == "" {
		t.Error("缺少 ETag：条件请求与 304 依赖它")
	}
}

func TestMediaLinkSupportsRangeAndHead(t *testing.T) {
	path := mediaTestFile(t, "movie.mp4", "0123456789")
	e := newRESTTestServer()
	target := signedMediaLink(path, time.Now().Add(time.Hour).Unix())

	rec := restRequest(t, e, http.MethodGet, target, "", map[string]string{"Range": "bytes=2-5"})
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("Range status = %d，期望 206：%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "2345" {
		t.Fatalf("Range body = %q，期望 2345", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Errorf("Content-Range = %q", got)
	}

	head := requestREST(t, e, http.MethodHead, target)
	if head.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d，期望 200", head.Code)
	}
	if head.Body.Len() != 0 {
		t.Errorf("HEAD 不应返回 body，得到 %q", head.Body.String())
	}
	if got := head.Header().Get(echo.HeaderContentLength); got != "10" {
		t.Errorf("HEAD Content-Length = %q，期望 10", got)
	}
}

func TestMediaLinkRejectsEditedCredentials(t *testing.T) {
	path := mediaTestFile(t, "secret.mkv", "x")
	other := mediaTestFile(t, "other.mkv", "y")
	validUntil := time.Now().Add(time.Hour).Unix()

	cases := []struct {
		name   string
		target string
	}{
		{"expired", signedMediaLink(path, time.Now().Add(-time.Minute).Unix())},
		{"missing exp", "/api/media/" + url.PathEscape(path) + "?sig=" + url.QueryEscape(mediaLinkSignature(path, validUntil))},
		{"tampered signature", signedMediaLink(path, validUntil) + "x"},
		{"exp swapped after signing", "/api/media/" + url.PathEscape(path) +
			"?exp=" + strconv.FormatInt(validUntil+3600, 10) +
			"&sig=" + url.QueryEscape(mediaLinkSignature(path, validUntil))},
		// A signature minted for another file must not authorize this one.
		{"signature for another path", "/api/media/" + url.PathEscape(path) +
			"?exp=" + strconv.FormatInt(validUntil, 10) +
			"&sig=" + url.QueryEscape(mediaLinkSignature(other, validUntil))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := requestREST(t, newRESTTestServer(), http.MethodGet, tc.target)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d，期望 401：%s", rec.Code, rec.Body.String())
			}
			payload := decodeError(t, rec)
			if payload.Code != apierr.CodeUnauthorized {
				t.Errorf("code = %q，期望 %q", payload.Code, apierr.CodeUnauthorized)
			}
		})
	}
}

// The mint response carries a path, not an origin: the frontend joins the origin
// it is currently served from, so the link points at the address the user is on.
func TestCreateMediaLinksReturnsOriginRelativeLinks(t *testing.T) {
	first := mediaTestFile(t, "ep01.mkv", "one")
	second := mediaTestFile(t, "ep02.mkv", "two")
	e := newRESTTestServer()

	body := `{"paths":[` + strconv.Quote(first) + `,` + strconv.Quote(second) + `],"ttl":"3h"}`
	rec := restRequest(t, e, http.MethodPost, "/api/fs/media-links", body, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d，期望 201：%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Links []struct {
			Path      string    `json:"path"`
			URL       string    `json:"url"`
			ExpiresAt time.Time `json:"expiresAt"`
		} `json:"links"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("响应不是 JSON：%v", err)
	}
	if len(payload.Links) != 2 {
		t.Fatalf("links = %d，期望 2", len(payload.Links))
	}

	remaining := time.Until(payload.Links[0].ExpiresAt)
	if remaining < 2*time.Hour+50*time.Minute || remaining > 3*time.Hour+time.Minute {
		t.Errorf("3h 链接的剩余有效期 = %v", remaining)
	}

	// 顺序必须与入参一致：前端按下标配对文件名生成 m3u。
	if payload.Links[0].Path != first || payload.Links[1].Path != second {
		t.Errorf("links 顺序与入参不一致：%q %q", payload.Links[0].Path, payload.Links[1].Path)
	}

	for i, link := range payload.Links {
		if !strings.HasPrefix(link.URL, "/api/media/") {
			t.Fatalf("链接应当是以 /api/media/ 开头的相对路径：%q", link.URL)
		}
		if strings.Contains(link.URL, "://") {
			t.Fatalf("链接不该带 origin（由前端拼）：%q", link.URL)
		}
		parsed, err := url.Parse(link.URL)
		if err != nil {
			t.Fatalf("链接解析失败：%v", err)
		}
		if !strings.HasPrefix(parsed.Path, "/api/media/") {
			t.Errorf("链接路径 = %q", parsed.Path)
		}
		if parsed.Query().Get("sig") == "" || parsed.Query().Get("exp") == "" {
			t.Errorf("链接缺少 exp/sig：%q", link.URL)
		}
		want := []string{"one", "two"}[i]
		got := requestREST(t, e, http.MethodGet, parsed.RequestURI())
		if got.Code != http.StatusOK || got.Body.String() != want {
			t.Fatalf("链接 %s 取回 %d %q，期望 200 %q", link.URL, got.Code, got.Body.String(), want)
		}
	}
}

func TestCreateMediaLinksRejectsBadRequests(t *testing.T) {
	dir := filepath.ToSlash(filepath.Join(t.TempDir(), "folder"))
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	e := newRESTTestServer()

	cases := []struct {
		name string
		body string
		want int
	}{
		{"directory", `{"paths":[` + strconv.Quote(dir) + `]}`, http.StatusConflict},
		{"unknown ttl", `{"paths":[` + strconv.Quote(dir) + `],"ttl":"5m"}`, http.StatusBadRequest},
		{"no paths", `{"paths":[]}`, http.StatusBadRequest},
		{"malformed json", `{`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := restRequest(t, e, http.MethodPost, "/api/fs/media-links", tc.body, nil)
			if rec.Code != tc.want {
				t.Fatalf("status = %d，期望 %d：%s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

// A signed link for a directory must not turn the media route into a listing.
func TestMediaLinkRefusesDirectories(t *testing.T) {
	dir := filepath.ToSlash(filepath.Join(t.TempDir(), "folder"))
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	res, err := fileops.Resolve(dir)
	if err != nil {
		t.Fatal(err)
	}
	rec := requestREST(t, newRESTTestServer(), http.MethodGet, signedMediaLink(res.Path, time.Now().Add(time.Hour).Unix()))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d，期望 409：%s", rec.Code, rec.Body.String())
	}
}

// The split is the whole security model: content by signed URL is public, and
// minting one is not.
func TestMediaRoutesRequireTheRightCredential(t *testing.T) {
	e := withAPIErrorHandler(echo.New())
	Register(e.Group("/api"))
	defer StopSharedWSServices()

	// Minting a link is a write: without a session the auth middleware answers
	// before the handler ever runs.
	mint := restRequest(t, e, http.MethodPost, "/api/fs/media-links", `{"paths":["/tmp/x"]}`, nil)
	if mint.Code != http.StatusUnauthorized {
		t.Fatalf("mint without a session = %d，期望 401", mint.Code)
	}
	if message := decodeError(t, mint).Message; !strings.Contains(message, "not signed in") {
		t.Fatalf("mint 被拒于 %q，期望先被会话拦下", message)
	}

	// Reading by link does not even look at the cookies: a bad link is rejected
	// by the handler, not by the session.
	read := restRequest(t, e, http.MethodGet, "/api/media/%2Ftmp%2Fx.mkv?exp=1&sig=bad", "", nil)
	if read.Code != http.StatusUnauthorized {
		t.Fatalf("read with a bad link = %d，期望 401", read.Code)
	}
	if message := decodeError(t, read).Message; !strings.Contains(message, "media link is invalid or expired") {
		t.Fatalf("read 被拒于 %q，期望是签名校验而不是会话", message)
	}
}
