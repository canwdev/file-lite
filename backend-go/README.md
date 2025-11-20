# file-lite-go

## 介绍

一个基于 Echo 的轻量级 web 文件管理服务，完整还原 `file-lite` nodejs 后端的接口与行为。

## 目录结构

- `main.go`：入口与服务启动
- `config/`：配置与环境
- `routes/`：路由与业务处理
- `middlewares/`：认证与限流
- `utils/`：工具函数
- `types/`：类型定义

## 编译

- 要求 Go 1.20+。
- 需要提前编译[前端](../frontend/package.json) `frontend:build-go`，确保 `backend-go/frontend/` 存在

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

或指定环境变量：

- `ENV_DATA_BASE_DIR`：数据根目录，默认 `./data`
- `HOST`：监听地址，默认 `0.0.0.0`
- `PORT`：监听端口，默认 `3100`

首次启动会在数据目录生成 `config.json`，可按需修改：

```json
{
  "host": "",
  "port": "",
  "noAuth": false,
  "password": "",
  "safeBaseDir": "./data/public",
  "enableLog": true,
  "sslKey": "",
  "sslCert": ""
}
```

如果配置了 `sslKey` 与 `sslCert`（相对 `data/`），将以 HTTPS 启动。

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

认证：`Authorization: <token>` 或 `?auth=<token>`，当 `noAuth=true` 时免认证。

## 格式化

使用 `gofmt` 格式化代码。

```
gofmt -w .\
```
