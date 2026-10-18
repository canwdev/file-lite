package utils

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A signed media URL is a credential: a verbose access log must not end up
// holding links that still work.
func TestLoggedRequestURIRedactsSignedMediaLinks(t *testing.T) {
	media := httptest.NewRequest(http.MethodGet, "/api/media/x.mkv?exp=1&sig=secret", nil)
	if got := loggedRequestURI(media); got != "/api/media/x.mkv" {
		t.Fatalf("media request logged as %q，期望只留路径", got)
	}

	other := httptest.NewRequest(http.MethodGet, "/api/fs/downloads?paths=/a", nil)
	if got := loggedRequestURI(other); got != "/api/fs/downloads?paths=/a" {
		t.Fatalf("普通请求应当保留 query，得到 %q", got)
	}
}
