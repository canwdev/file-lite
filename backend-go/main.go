package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/mattn/go-isatty"

	"file-lite-go/cli"
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

// 使用 Static 中间件 + HTML5 模式：始终用 Request.URL.Path 解析多级路径（如 assets/*.js）。
// 不要再用 e.GET("/*", …)：匹配到该路由时 c.Path() 以 * 结尾，Echo 会改用 c.Param("*")，
// 多级路径会断裂，从而把静态请求误判为 SPA 并返回 index.html（浏览器报 Unexpected token '<'）。
func frontendStaticMiddleware(staticFS http.FileSystem) echo.MiddlewareFunc {
	return middleware.StaticWithConfig(middleware.StaticConfig{
		Skipper: func(c echo.Context) bool {
			return strings.HasPrefix(c.Request().URL.Path, "/api")
		},
		Root:       ".",
		Index:      "index.html",
		HTML5:      true,
		Filesystem: staticFS,
	})
}

func isServerRunning() bool {
	return echoInstance != nil
}

func startServer() (*cli.ServerResult, error) {
	if isServerRunning() {
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
	var staticFS http.FileSystem
	if utils.DirExists(frontendRoot) {
		staticFS = http.FS(os.DirFS(frontendRoot))
	} else {
		subFS, err := fs.Sub(embeddedFrontend, "frontend")
		if err != nil {
			return nil, fmt.Errorf("embed frontend: %w", err)
		}
		staticFS = http.FS(subFS)
	}
	e.Use(frontendStaticMiddleware(staticFS))

	api := e.Group("/api")
	api.Use(middlewares.RateLimiter())
	routes.Register(api)

	port := config.Port()
	host := config.Host()
	isHttps := config.IsHTTPS()
	addr := fmt.Sprintf("%s:%d", host, port)

	result := &cli.ServerResult{}
	printUrls := func() {
		fmt.Println("")
		protocol := "http:"
		if isHttps {
			protocol = "https:"
		}
		ticket, err := config.NewAuthTicket()
		if err != nil {
			fmt.Println("Error generating auth ticket:", err)
		}
		ticketParam := ""
		if ticket.Value != "" {
			ticketParam = "ticket=" + ticket.Value
		}
		frontendPort := config.FrontendPort()

		ips := utils.PrintUrls(protocol, host, frontendPort, ticketParam)
		fmt.Println("IP Selector:")

		localhostUrl := fmt.Sprintf("%s//127.0.0.1:%d", protocol, frontendPort)
		encodedData, err := utils.EncodeIpSelectorParams(utils.IpSelectorParams{
			IPs:      ips,
			Port:     frontendPort,
			Protocol: protocol,
			Ticket:   ticket.Value,
		})
		if err != nil {
			fmt.Println("Error encoding IP selector data:", err)
		}
		urlIpSelector := fmt.Sprintf("%s/ip?data=%s", localhostUrl, encodedData)
		result.UrlIpSelector = urlIpSelector
		fmt.Println(urlIpSelector)
		fmt.Println("")
		fmt.Printf("Ticket: %s\n", ticket.Value)
		fmt.Printf("Ticket expires at: %s.\n", ticket.ExpiresAt.Format("2006-01-02 15:04:05"))
		fmt.Println("")
	}

	echoInstance = e

	go func() {
		if isHttps {
			key := filepath.Join(config.DataBaseDir(), config.Config().SSLKey)
			cert := filepath.Join(config.DataBaseDir(), config.Config().SSLCert)
			fmt.Println("HTTPS enabled")
			server = &http.Server{Addr: addr, Handler: e}
			if err := e.StartTLS(addr, cert, key); err != nil && err != http.ErrServerClosed {
				e.Logger.Fatal(err)
			}
		} else {
			server = &http.Server{Addr: addr, Handler: e}
			if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
				// ignore closed
			}
		}
	}()

	time.Sleep(100 * time.Millisecond)
	result.PrintUrls = printUrls
	return result, nil
}

func stopServer() {
	routes.StopSharedWSServices()
	if echoInstance != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := echoInstance.Shutdown(ctx); err != nil {
			_ = echoInstance.Close()
		}
		server = nil
		echoInstance = nil
		fmt.Println("server stopped")
	}
}

func bootServer(createConfig bool, overrides cli.Overrides) (*cli.ServerResult, error) {
	cli.ApplyDataDirOverride(overrides)
	if err := config.LoadConfig(createConfig); err != nil {
		return nil, err
	}
	cli.ApplyCliOverrides(overrides)
	res, err := startServer()
	if err != nil {
		return nil, err
	}
	res.PrintUrls()
	return res, nil
}

func waitForSignal() {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
}

func main() {
	overrides, err := cli.ParseArgv(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		fmt.Fprintln(os.Stderr, "Try 'file-lite-go --help' for more information.")
		os.Exit(2)
	}
	if overrides.Version {
		cli.PrintVersion()
		os.Exit(0)
	}
	if overrides.Help {
		cli.PrintHelp()
		os.Exit(0)
	}

	if overrides.WithTLS && !overrides.CreateConfig {
		fmt.Fprintln(os.Stderr, "--with-tls requires --create-config")
		fmt.Fprintln(os.Stderr, "Try 'file-lite-go --help' for more information.")
		os.Exit(2)
	}
	if overrides.CreateConfig {
		cli.ApplyDataDirOverride(overrides)
		if err := config.LoadConfig(true); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if overrides.WithTLS {
			key, cert, generated, err := cli.EnsureSelfSignedTLS(config.DataBaseDir())
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			if err := config.SetSSLAndPersist(key, cert); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			label := "tls cert exists"
			if generated {
				label = "tls cert written"
			}
			fmt.Printf("%s: %s, %s\n", label, key, cert)
		}
		fmt.Printf("config written: %s\n", config.ConfigFilePath())
		os.Exit(0)
	}

	var serverResult *cli.ServerResult
	exited := false

	ensureStarted := func() error {
		if isServerRunning() {
			return nil
		}
		res, err := bootServer(false, overrides)
		if err != nil {
			return err
		}
		serverResult = res
		return nil
	}

	getCtx := func() cli.CmdCtx {
		return cli.CmdCtx{
			ServerResult: serverResult,
			CreateConfigAndReload: func() error {
				stopServer()
				serverResult = nil
				res, err := bootServer(true, overrides)
				if err != nil {
					return err
				}
				serverResult = res
				return nil
			},
			Reload: func() error {
				stopServer()
				serverResult = nil
				res, err := bootServer(false, overrides)
				if err != nil {
					return err
				}
				serverResult = res
				return nil
			},
			Exit: func() error {
				stopServer()
				serverResult = nil
				exited = true
				return nil
			},
		}
	}

	if err := ensureStarted(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	useTui := (isatty.IsTerminal(os.Stdin.Fd()) || isatty.IsCygwinTerminal(os.Stdin.Fd())) && !overrides.NoTui
	if useTui {
		if err := cli.RunTui(getCtx, func() bool { return !exited }); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	} else {
		waitForSignal()
		stopServer()
	}
}
