package cli

import (
	"fmt"
	"os"

	"file-lite-go/config"
)

type Overrides struct {
	Port         string
	Host         string
	DataDir      string
	CreateConfig bool
	WithTLS      bool
	NoTui        bool
	Help         bool
	Version      bool
}

func ApplyDataDirOverride(o Overrides) {
	if o.DataDir != "" {
		_ = os.Setenv("FILE_LITE_DATA_BASE_DIR", o.DataDir)
	}
}

func ApplyCliOverrides(o Overrides) {
	config.ApplyListenOverrides(o.Port, o.Host)
}

func PrintVersion() {
	fmt.Printf("%s v%s\n", config.PkgName, config.Version)
}

func PrintHelp() {
	fmt.Printf(`%s v%s

Usage:
  file-lite-go [options]

Options:
  -h, --help           Show help
  -v, --version        Show version
  --no-tui             Run without interactive menu
  --create-config      Create config.json if missing and exit
  --with-tls           With --create-config: generate self-signed cert via openssl
  -p, --port <port>    Override listen port
  -H, --host <host>    Override listen host
  --data-dir <path>    Data directory (default: ./file-lite under cwd;
                       env: FILE_LITE_DATA_BASE_DIR)

Ephemeral mode (no config.json): no files are written; use printed Ticket to sign in.
`, config.PkgName, config.Version)
}
