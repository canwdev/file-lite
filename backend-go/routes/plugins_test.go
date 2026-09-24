package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func requestPluginFile(t *testing.T, abs string, inject bool, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	e.GET("/f", func(c echo.Context) error {
		return serveAbsFile(c, abs, nil, inject)
	})
	req := httptest.NewRequest(http.MethodGet, "/f", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestServeAbsFileRevalidatesHTMLAndAssets(t *testing.T) {
	dir := t.TempDir()
	htmlPath := filepath.Join(dir, "index.html")
	jsPath := filepath.Join(dir, "app.js")
	if err := os.WriteFile(htmlPath, []byte("<html><head></head><body>hi</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(jsPath, []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}

	page := requestPluginFile(t, htmlPath, true, "")
	if page.Code != http.StatusOK {
		t.Fatalf("html status = %d, body = %s", page.Code, page.Body.String())
	}
	if !strings.Contains(page.Body.String(), "plugin-sdk.js") {
		t.Fatalf("sdk was not injected: %s", page.Body.String())
	}
	if cc := page.Header().Get("Cache-Control"); cc != "private, max-age=0, must-revalidate" {
		t.Fatalf("cache-control = %q", cc)
	}
	etag := page.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag should be set")
	}

	again := requestPluginFile(t, htmlPath, true, etag)
	if again.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", again.Code)
	}
	if again.Body.Len() != 0 {
		t.Fatalf("304 should have an empty body, got %d bytes", again.Body.Len())
	}
	if again.Header().Get("ETag") != etag {
		t.Fatalf("304 etag = %q, want %q", again.Header().Get("ETag"), etag)
	}

	if err := os.WriteFile(htmlPath, []byte("<html><head></head><body>hi!</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	edited := requestPluginFile(t, htmlPath, true, etag)
	if edited.Code != http.StatusOK {
		t.Fatalf("edited status = %d, want 200", edited.Code)
	}
	if edited.Header().Get("ETag") == etag {
		t.Fatal("edited file kept the old ETag")
	}
	if !strings.Contains(edited.Body.String(), "hi!") {
		t.Fatalf("edited body = %s", edited.Body.String())
	}

	script := requestPluginFile(t, jsPath, false, "")
	if script.Code != http.StatusOK {
		t.Fatalf("js status = %d, body = %s", script.Code, script.Body.String())
	}
	if script.Header().Get("Cache-Control") != "private, max-age=0, must-revalidate" {
		t.Fatalf("js cache-control = %q", script.Header().Get("Cache-Control"))
	}
	jsETag := script.Header().Get("ETag")
	if jsETag == "" || jsETag == etag {
		t.Fatalf("js etag = %q", jsETag)
	}
	scriptAgain := requestPluginFile(t, jsPath, false, jsETag)
	if scriptAgain.Code != http.StatusNotModified {
		t.Fatalf("js status = %d, want 304", scriptAgain.Code)
	}
	if scriptAgain.Body.Len() != 0 {
		t.Fatalf("304 js body = %d bytes", scriptAgain.Body.Len())
	}
}
