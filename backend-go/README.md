# file-lite-go

## Introduction

A lightweight web file management service built on Echo that fully reproduces the APIs and behavior of the `file-lite` [Node.js backend](../backend).

## Building

- Install [Go 1.20+](https://go.dev/dl/).
- Build the [frontend](../frontend/package.json) with `build:for-go` first: it emits `backend-go/frontend/` and packs `backend-go/frontend-assets.tar.gz`, which the Go build embeds (gzip-compressed).

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
bun run dev:go

# Build the Go backend executable
bun run build:win:amd64
```

Before packaging the backend, run `bun run build:for-go` in `frontend/` first; static assets are output to `backend-go/frontend/` and embedded into the single-file executable as the gzip-compressed `frontend-assets.tar.gz`. At runtime the binary serves its built-in UI unless a `frontend/` folder sits next to it (that folder then takes precedence).

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
- Run `bun run icon` in backend-go to generate `icon.ico`.
- `rsrc.syso` is generated per-architecture automatically by the `build:win:*` scripts and removed after each build.
