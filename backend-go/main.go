package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/AlecAivazis/survey/v2"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/mattn/go-isatty"

	"file-lite-go/config"
	"file-lite-go/middlewares"
	"file-lite-go/routes"
	"file-lite-go/utils"
)

//go:embed frontend
var embeddedFrontend embed.FS

var (
	server       *http.Server
	echoInstance *echo.Echo
)

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

type StartServerResult struct {
	UrlIpSelector string
	PrintUrls     func()
}

func startServer() (*StartServerResult, error) {
	if server != nil {
		return nil, fmt.Errorf("server is already running")
	}

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
		Format: `[${time_rfc3339}] ${status} ${method} ${host}${uri} ${latency_human}` + "\n",
		Skipper: func(c echo.Context) bool {
			return c.Response().Status < 400 && !config.Config().EnableLog
		},
	}))
	e.Use(middleware.Recover())

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

	printUrls := func() {
		fmt.Println("")
		protocol := "http:"
		if isHttps {
			protocol = "https:"
		}
		ips := utils.PrintUrls(protocol, host, port, config.AuthParam())
		fmt.Println("IP Selector:")

		// Construct IP selector URL
		localhostUrl := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)

		auth := ""
		if !config.Config().NoAuth {
			auth = config.AuthToken()
		}

		data := map[string]interface{}{
			"ips":      ips,
			"port":     port,
			"protocol": protocol,
			"auth":     auth,
		}
		jsonData, _ := json.Marshal(data)
		encodedData := base64.StdEncoding.EncodeToString(jsonData)
		urlIpSelector := fmt.Sprintf("%s/ip?data=%s", localhostUrl, encodedData)
		fmt.Println(urlIpSelector)
		fmt.Println("")
	}

	echoInstance = e

	go func() {
		if isHttps {
			key := filepath.Join(config.DataBaseDir(), config.Config().SSLKey)
			cert := filepath.Join(config.DataBaseDir(), config.Config().SSLCert)
			fmt.Println("HTTPS enabled")
			server = &http.Server{Addr: addr, Handler: e} // Assign server before StartTLS
			if err := e.StartTLS(addr, cert, key); err != nil && err != http.ErrServerClosed {
				e.Logger.Fatal(err)
			}
		} else {
			server = &http.Server{Addr: addr, Handler: e} // Assign server before Start
			if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
				// fmt.Fprintln(os.Stderr, err)
			}
		}
	}()

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	// Construct result
	// Note: The IP selector URL construction above in printUrls is a bit hacky because we didn't refactor PrintUrls to return IPs.
	// For now, we will re-calculate it or just use a placeholder if needed, but let's try to make it work in printUrls closure.

	protocol := "http:"
	if isHttps {
		protocol = "https:"
	}
	localhostUrl := fmt.Sprintf("%s//127.0.0.1:%d", protocol, port)
	auth := ""
	if !config.Config().NoAuth {
		auth = config.AuthToken()
	}
	data := map[string]interface{}{
		"ips":      utils.GetAvailableIPs(host),
		"port":     port,
		"protocol": protocol,
		"auth":     auth,
	}
	jsonData, _ := json.Marshal(data)
	encodedData := base64.StdEncoding.EncodeToString(jsonData)
	urlIpSelector := fmt.Sprintf("%s/ip?data=%s", localhostUrl, encodedData)

	return &StartServerResult{
		UrlIpSelector: urlIpSelector,
		PrintUrls:     printUrls,
	}, nil
}

func stopServer() {
	if echoInstance != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := echoInstance.Shutdown(ctx); err != nil {
			echoInstance.Close()
		}
		server = nil
		echoInstance = nil
		fmt.Println("server stopped")
	}
}

func main() {
	isExit := false
	isPrint := false
	isCreateConfig := false
	var serverResult *StartServerResult

	// Check if running in a terminal
	if !isatty.IsTerminal(os.Stdin.Fd()) && !isatty.IsCygwinTerminal(os.Stdin.Fd()) {
		fmt.Println("Interactive mode disabled (not a TTY)")
		config.LoadConfig(isCreateConfig)
		res, err := startServer()
		if err != nil {
			fmt.Println("Error starting server:", err)
			return
		}
		serverResult = res
		serverResult.PrintUrls()

		// Wait for interrupt signal to gracefully shutdown the server
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
		<-quit
		stopServer()
		return
	}

	for !isExit {
		if server == nil {
			config.LoadConfig(isCreateConfig)
			res, err := startServer()
			if err != nil {
				fmt.Println("Error starting server:", err)
				return
			}
			serverResult = res
			serverResult.PrintUrls()
		} else if isPrint {
			// Clear console? Go doesn't have a built-in clear, can use escape codes
			fmt.Print("\033[H\033[2J")
			serverResult.PrintUrls()
		}

		isPrint = false
		isCreateConfig = false

		var qs = []*survey.Question{
			{
				Name: "action",
				Prompt: &survey.Select{
					Message: fmt.Sprintf("%s v%s Select function", config.PkgName, config.Version),
					Options: func() []string {
						opts := []string{
							"🌐 Open IP selector",
							"🔗 Print urls",
						}
						if config.ConfigInitialized() {
							opts = append(opts, "⚙️ Open config file")
						} else {
							opts = append(opts, "✨ Create config file")
						}
						opts = append(opts, "🔄 Restart server", "🚪 Exit")
						return opts
					}(),
				},
			},
		}

		answers := struct {
			Action string
		}{}

		err := survey.Ask(qs, &answers)
		if err != nil {
			fmt.Println(err.Error())
			return
		}

		switch {
		case strings.Contains(answers.Action, "Open IP selector"):
			utils.Opener(serverResult.UrlIpSelector)
			time.Sleep(1000 * time.Millisecond)
		case strings.Contains(answers.Action, "Print urls"):
			isPrint = true
		case strings.Contains(answers.Action, "Open config file"):
			if config.ConfigInitialized() {
				utils.Opener(config.ConfigFilePath())
			}
		case strings.Contains(answers.Action, "Create config file"):
			stopServer()
			isCreateConfig = true
		case strings.Contains(answers.Action, "Restart server"):
			fmt.Print("\033[H\033[2J")
			stopServer()
		case strings.Contains(answers.Action, "Exit"):
			stopServer()
			isExit = true
		}
	}
}
