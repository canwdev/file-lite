package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/labstack/echo/v4"

	"file-lite-go/types"
)

// 边界归一化：`\`、重复斜杠、"." 与 ".." 都应当落到同一个目录上。
//
// 归一化由 fileops.CanonicalizePath 完成，这里验证它确实接在了 HTTP 边界上——
// 纯函数测试测不到「有没有接上」。
func TestListAcceptsNonCanonicalPathSpellings(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	e := echo.New()
	e.GET("/api/files/list", getFiles)

	// 每一种写法都应当列到同一个目录。
	spellings := []string{
		sub,
		sub + string(os.PathSeparator), // 尾分隔符
		filepath.ToSlash(sub) + "//",   // 重复斜杠
		filepath.ToSlash(sub) + "/./",  // 当前目录段
		filepath.ToSlash(sub) + "/../" + filepath.Base(sub), // 父目录段再回来
	}

	for _, spelling := range spellings {
		t.Run(spelling, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/files/list?path="+url.QueryEscape(spelling), nil)
			e.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("path=%q 返回 %d：%s", spelling, rec.Code, rec.Body.String())
			}
			var entries []types.Entry
			if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
				t.Fatalf("响应不是条目数组: %v", err)
			}
			names := make([]string, 0, len(entries))
			for _, en := range entries {
				names = append(names, en.Name)
			}
			sort.Strings(names)
			if len(names) != 1 || names[0] != "a.txt" {
				t.Fatalf("path=%q 列出的条目 = %v，期望 [a.txt]", spelling, names)
			}
		})
	}
}

// 归一化不能把错误路径变成成功：越根、相对路径、空路径仍要走各自的错误分支。
//
// 相对路径与越根现在是 **400**，因为路径统一走 fileops.Resolve。旧行为是把这类路径
// 原样丢给 os.Stat，于是报的是 404「文件不存在」——把「你的路径写法不合法」说成了
// 「这个文件没了」，用户会去找一个根本不该存在的文件。
func TestListRejectsBadPaths(t *testing.T) {
	e := echo.New()
	e.GET("/api/files/list", getFiles)

	cases := []struct {
		name string
		path string
		want int
	}{
		{"空路径", "", http.StatusBadRequest},
		{"相对路径", "relative/dir", http.StatusBadRequest},
		{"越根", "/a/../../b", http.StatusBadRequest},
		{"不存在的绝对路径", "/definitely/not/here", http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/files/list?path="+url.QueryEscape(c.path), nil)
			e.ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Fatalf("path=%q 返回 %d，期望 %d：%s", c.path, rec.Code, c.want, rec.Body.String())
			}
		})
	}
}
