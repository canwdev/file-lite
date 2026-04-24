# file-lite-go

## 介绍

一个基于 Echo 的轻量级 web 文件管理服务，完整还原 `file-lite` [nodejs 后端](../backend)的接口与行为。

## 编译

- 安装 [Go 1.20+](https://go.dev/dl/)。
- 需要提前编译[前端](../frontend/package.json) `frontend:build-go`，确保 `backend-go/frontend/` 存在

```shell
# go 镜像
# 启用 Go Modules 功能
go env -w GO111MODULE=on

# 配置 GOPROXY 环境变量，以下三选一

# 1. 七牛 CDN
go env -w  GOPROXY=https://goproxy.cn,direct

# 2. 阿里云
go env -w GOPROXY=https://mirrors.aliyun.com/goproxy/,direct

# 3. 官方
go env -w  GOPROXY=https://goproxy.io,direct

#确认一下：
go env | grep GOPROXY
#GOPROXY="https://goproxy.cn"
```

```bash
go mod download
go build -o file-lite-go.exe ./
# 启动
./file-lite-go.exe
```

## 使用 air 热重载开发环境

```shell
# 安装 air
go install github.com/air-verse/air@latest

# 启动
air
```

## 接口

基础路径 `http(s)://<host>:<port>/api`。

- `GET /`：返回名称、版本与时间戳
- `GET /files/auth`：认证探测
- `GET /files/drives`：驱动列表
- `GET /files/list?path=`：目录列表
- `POST /files/create-dir`：创建目录
- `POST /files/rename`：重命名
- `POST /files/copy-paste`：复制/移动
- `POST /files/delete`：删除
- `GET /files/stream?path=`：文件内联预览
- `GET /files/download?path=` 或 `paths[]=`：下载或打包
- `POST /files/upload-file`：`form-data` 字段 `file`

认证：`Authorization: <token>` 或 Cookie `file_lite_auth_token`，当 `noAuth=true` 时免认证。

## 格式化

使用 `gofmt` 格式化代码。

```
gofmt -w .\
```

# icon 生成

- Install rsrc tool: `go install github.com/akavel/rsrc@latest`
- Run `bun run icon` in backend-go. This generates `rsrc_windows_amd64.syso` and `rsrc_windows_arm64.syso`.
- The go build command will automatically include the correct `.syso` for the target architecture.