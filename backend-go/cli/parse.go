package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
	"unicode"

	"file-lite-go/config"
)

// expandGluedShortFlags turns -p3100 / -H0.0.0.0 into -p 3100 / -H 0.0.0.0.
func expandGluedShortFlags(args []string) []string {
	out := make([]string, 0, len(args))
	for _, arg := range args {
		if strings.HasPrefix(arg, "-p") && len(arg) > 2 && unicode.IsDigit(rune(arg[2])) {
			out = append(out, "-p", arg[2:])
			continue
		}
		if strings.HasPrefix(arg, "-H") && len(arg) > 2 && !strings.HasPrefix(arg, "--") {
			out = append(out, "-H", arg[2:])
			continue
		}
		out = append(out, arg)
	}
	return out
}

func ParseArgv(args []string) (Overrides, error) {
	var o Overrides
	fs := flag.NewFlagSet(config.PkgName, flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	fs.BoolVar(&o.Help, "help", false, "Show help")
	fs.BoolVar(&o.Help, "h", false, "Show help")
	fs.BoolVar(&o.Version, "version", false, "Show version")
	fs.BoolVar(&o.Version, "v", false, "Show version")
	fs.BoolVar(&o.NoTui, "no-tui", false, "Run without interactive menu")
	fs.BoolVar(&o.CreateConfig, "create-config", false, "Create config.json if missing")
	fs.BoolVar(&o.WithTLS, "with-tls", false, "With --create-config: generate self-signed cert")
	fs.StringVar(&o.Port, "port", "", "Override listen port")
	fs.StringVar(&o.Port, "p", "", "Override listen port")
	fs.StringVar(&o.Host, "host", "", "Override listen host")
	fs.StringVar(&o.Host, "H", "", "Override listen host")
	fs.StringVar(&o.DataDir, "data-dir", "", "Data directory")

	expanded := expandGluedShortFlags(args)
	if err := fs.Parse(expanded); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			o.Help = true
			return o, nil
		}
		return o, err
	}
	if rest := fs.Args(); len(rest) > 0 {
		return o, fmt.Errorf("unknown argument: %s", rest[0])
	}
	return o, nil
}
