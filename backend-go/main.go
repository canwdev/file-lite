package main

import (
	"embed"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"file-lite-go/config"
	"file-lite-go/middlewares"
	"file-lite-go/routes"
	"file-lite-go/utils"
)

//go:embed frontend
var embeddedFrontend embed.FS

func frontendDirHandler(frontendRoot string) echo.HandlerFunc {
	return func(c echo.Context) error {
		p := c.Param("*")
		if p == "" || strings.HasSuffix(p, "/") {
			return c.File(filepath.Join(frontendRoot, "index.html"))
		}
		fp := filepath.Join(frontendRoot, p)
		if utils.FileExists(fp) {
			return c.File(fp)
		}
		return c.File(filepath.Join(frontendRoot, "index.html"))
	}
}

func frontendEmbeddedHandler(subFS fs.FS) echo.HandlerFunc {
	return func(c echo.Context) error {
		p := c.Param("*")
		if p == "" || strings.HasSuffix(p, "/") {
			p = "index.html"
		}
		f, err := subFS.Open(p)
		if err != nil {
			f, err = subFS.Open("index.html")
			if err != nil {
				return echo.NewHTTPError(http.StatusNotFound)
			}
		}
		defer f.Close()
		ct := mime.TypeByExtension(filepath.Ext(p))
		if ct == "" {
			ct = "text/html; charset=utf-8"
		}
		return c.Stream(http.StatusOK, ct, f)
	}
}

func main() {
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.BodyLimit("100M"))
	e.Use(middleware.Recover())
	e.Use(utils.LogErrorsOnly())

	frontendRoot := filepath.Join(utils.ExeDir(), "frontend")
	if utils.DirExists(frontendRoot) {
		e.Static("/", frontendRoot)
		e.GET("/*", frontendDirHandler(frontendRoot))
	} else {
		subFS, _ := fs.Sub(embeddedFrontend, "frontend")
		e.GET("/*", frontendEmbeddedHandler(subFS))
	}

	api := e.Group("/api")
	api.Use(middlewares.RateLimiter())
	routes.Register(api)

	port := config.Port()
	host := config.Host()
	isHttps := config.IsHTTPS()
	addr := fmt.Sprintf("%s:%d", host, port)

	if isHttps {
		srv := &http.Server{Addr: addr, Handler: e}
		utils.PrintUrls("https:", host, port, config.AuthParam())
		key := filepath.Join(config.DataBaseDir(), config.Config().SSLKey)
		cert := filepath.Join(config.DataBaseDir(), config.Config().SSLCert)
		e.Logger.Fatal(e.StartTLS(addr, cert, key))
		_ = srv
	} else {
		utils.PrintUrls("http:", host, port, config.AuthParam())
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			fmt.Fprintln(os.Stderr, err)
		}
	}
}
