package config

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io/fs"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Cfg struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	NoAuth      bool   `json:"noAuth"`
	Password    string `json:"password"`
	SafeBaseDir string `json:"safeBaseDir"`
	EnableLog   bool   `json:"enableLog"`
	SSLKey      string `json:"sslKey"`
	SSLCert     string `json:"sslCert"`
}

const PkgName = "file-lite-go"
const Version = "1.1.2"

var cfg Cfg
var dataBaseDir string
var safeBaseDir string
var authToken string
var configInitialized bool
var configFilePath string

func normalizePath(p string) string {
	s := strings.ReplaceAll(p, "\\", "/")
	s = strings.ReplaceAll(s, "//", "/")
	return s
}

func DataBaseDir() string     { return dataBaseDir }
func SafeBaseDir() string     { return safeBaseDir }
func AuthToken() string       { return authToken }
func Config() Cfg             { return cfg }
func ConfigInitialized() bool { return configInitialized }
func ConfigFilePath() string  { return configFilePath }

func LoadConfig(allowCreate bool) {
	fmt.Printf("%s version: %s\n\n", PkgName, Version)
	base := os.Getenv("ENV_DATA_BASE_DIR")
	if base == "" {
		wd, _ := os.Getwd()
		base = filepath.Join(wd, "file-lite")
	}
	dataBaseDir = base
	fmt.Printf("DATA_BASE_DIR: %s\n", dataBaseDir)

	if allowCreate {
		_ = os.MkdirAll(dataBaseDir, fs.ModePerm)
	}

	def := Cfg{
		Host:        "",
		Port:        "",
		NoAuth:      false,
		Password:    "",
		SafeBaseDir: "./",
		EnableLog:   true,
		SSLKey:      "",
		SSLCert:     "",
	}
	fp := filepath.Join(dataBaseDir, "config.json")
	configFilePath = fp

	if _, err := os.Stat(fp); err != nil {
		if allowCreate {
			b, _ := json.MarshalIndent(def, "", "  ")
			_ = os.WriteFile(fp, b, 0644)
			cfg = def
			configInitialized = true
		} else {
			cfg = def
			configInitialized = false
		}
	} else {
		b, _ := os.ReadFile(fp)
		_ = json.Unmarshal(b, &cfg)
		configInitialized = true
	}

	if cfg.SafeBaseDir != "" {
		wd, _ := os.Getwd()
		abs := normalizePath(filepath.Clean(filepath.Join(wd, cfg.SafeBaseDir)))
		if filepath.IsAbs(cfg.SafeBaseDir) {
			abs = normalizePath(filepath.Clean(cfg.SafeBaseDir))
		}
		safeBaseDir = abs
		if safeBaseDir != "" {
			if allowCreate {
				if _, err := os.Stat(safeBaseDir); err != nil {
					_ = os.MkdirAll(safeBaseDir, fs.ModePerm)
				}
			}
			fmt.Printf("safeBaseDir: %s\n", safeBaseDir)
		}
	} else {
		safeBaseDir = ""
	}

	if cfg.Password != "" {
		authToken = cfg.Password
	} else {
		authToken = s4() + s4()
	}
	fmt.Printf("password: %s\n", authToken)
}

func s4() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(0x10000))
	v := int(n.Int64()) + 0x10000
	s := strconv.FormatInt(int64(v), 16)
	return s[1:5]
}

func Port() int {
	env := os.Getenv("PORT")
	p := cfg.Port
	if p == "" {
		p = env
	}
	if p == "" {
		p = "3100"
	}
	i, _ := strconv.Atoi(p)
	return i
}

func Host() string {
	env := os.Getenv("HOST")
	h := cfg.Host
	if h == "" {
		h = env
	}
	if h == "" {
		h = "0.0.0.0"
	}
	return h
}

func IsHTTPS() bool { return cfg.SSLKey != "" && cfg.SSLCert != "" }

func AuthParam() string {
	if cfg.NoAuth {
		return ""
	}
	return "auth=" + authToken
}
