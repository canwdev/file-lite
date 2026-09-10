# file-lite-go

## Introduction

A lightweight web file management service built on Echo; it is File Lite's only backend, embedding the built frontend into a single static binary.

## Building

- Install [Go 1.20+](https://go.dev/dl/).
- `bun run build` in `backend-go/` builds the [frontend](../frontend/package.json) first (it emits `backend-go/frontend/` and packs `backend-go/frontend-assets.tar.gz`, which the Go build embeds gzip-compressed), then the binary for the current platform and the release zip.

```shell
# Go proxy
# Enable Go Modules
go env -w GO111MODULE=on

# Configure the GOPROXY environment variable; pick one of the following

# 1. Qiniu CDN
go env -w  GOPROXY=https://goproxy.cn,direct

# 2. Alibaba Cloud
go env -w GOPROXY=https://mirrors.aliyun.com/goproxy/,direct

# 3. Official
go env -w  GOPROXY=https://goproxy.io,direct

# Verify:
go env | grep GOPROXY
#GOPROXY="https://goproxy.cn"
```

```bash
go mod download
go build -o file-lite-go.exe ./
# Run
./file-lite-go.exe
```

## Development and build scripts

Use Bun to run the scripts in `backend-go/package.json`.

```shell
bun i

# Generate Windows icon resources
bun run icon

# Start a hot-reload dev environment with air
bun run dev

# Build the current platform: frontend + Go binary + release zip
bun run build

# Build every release target and pack one zip per platform
bun run build:all
```

`bun run build` detects the current platform automatically (no `GOOS`/`GOARCH` needed) and writes `file-lite-<os>_<arch>-v<version>.zip` to the repository root, with the platform folder as the only top-level entry. It fails early if `frontend/src/enum/version.ts` and `backend-go/config/config.go` disagree on the version. Pass `--skip-frontend` to reuse an existing `backend-go/frontend-assets.tar.gz` (the release workflow does this). At runtime the binary serves its built-in UI unless a `frontend/` folder sits next to it (that folder then takes precedence).

## Hot-reload dev environment with air

```shell
# Then run the install
go install github.com/air-verse/air@latest

# fish_add_path ~/go/bin

# Start
air
```

## API

Base path: `http(s)://<host>:<port>/api`.

- `GET /`: returns name, version and timestamp
- `GET /files/auth`: authentication probe
- `GET /files/drives`: drive list
- `GET /files/list?path=`: directory listing
- `POST /files/create-dir`: create directory
- `POST /files/rename`: rename
- `POST /files/copy-paste`: copy/move
- `POST /files/delete`: delete
- `POST /files/open-in-host-explorer`: open and select in the host system's file explorer
- `GET /files/stream?path=`: inline file preview
- `GET /files/download?path=` or `paths[]=`: download or archive
- `POST /files/upload-file`: `form-data` field `file`

Authentication: `Authorization: <token>` header or `file_lite_auth_token` cookie

## Formatting

Format the code with `gofmt`.

```
gofmt -w .\
```

# Icon generation

- Install the rsrc tool: `go install github.com/akavel/rsrc@latest`
- Run `bun run icon` in backend-go to generate `icon.ico` and the `rsrc_windows_*.syso` files.
- `go build` picks the matching `.syso` up automatically when targeting Windows.
