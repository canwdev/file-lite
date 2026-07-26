package cli

import (
	"fmt"
	"time"

	"file-lite-go/config"
	"file-lite-go/utils"
)

type ServerResult struct {
	UrlIpSelector string
	PrintUrls     func()
}

type CmdCtx struct {
	ServerResult          *ServerResult
	CreateConfigAndReload func() error
	Reload                func() error
	Exit                  func() error
}

type Command struct {
	ID    string
	Label string
	When  func(ctx CmdCtx) bool
	Run   func(ctx CmdCtx) error
}

func Commands() []Command {
	return []Command{
		{
			ID:    "open-ip",
			Label: "Open IP selector",
			When:  func(ctx CmdCtx) bool { return ctx.ServerResult != nil },
			Run: func(ctx CmdCtx) error {
				if ctx.ServerResult != nil {
					ctx.ServerResult.PrintUrls()
					utils.Opener(ctx.ServerResult.UrlIpSelector)
				}
				time.Sleep(time.Second)
				return nil
			},
		},
		{
			ID:    "print-urls",
			Label: "Print urls",
			When:  func(ctx CmdCtx) bool { return ctx.ServerResult != nil },
			Run: func(ctx CmdCtx) error {
				fmt.Print("\033[H\033[2J")
				if ctx.ServerResult != nil {
					ctx.ServerResult.PrintUrls()
				}
				return nil
			},
		},
		{
			ID:    "create-config",
			Label: "Create config file",
			When:  func(CmdCtx) bool { return !config.ConfigInitialized() },
			Run: func(ctx CmdCtx) error {
				return ctx.CreateConfigAndReload()
			},
		},
		{
			ID:    "open-config",
			Label: "Open config file",
			When:  func(CmdCtx) bool { return config.ConfigInitialized() },
			Run: func(CmdCtx) error {
				if config.ConfigInitialized() {
					utils.Opener(config.ConfigFilePath())
				}
				return nil
			},
		},
		{
			ID:    "reload",
			Label: "Restart server",
			When:  func(ctx CmdCtx) bool { return ctx.ServerResult != nil },
			Run: func(ctx CmdCtx) error {
				fmt.Print("\033[H\033[2J")
				return ctx.Reload()
			},
		},
		{
			ID:    "exit",
			Label: "Exit",
			Run: func(ctx CmdCtx) error {
				return ctx.Exit()
			},
		},
	}
}
