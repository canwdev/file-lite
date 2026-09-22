# File Lite

中文 | [English](./README.md)

<p align="center">
  <img src="frontend/public/favicon.webp" alt="File Lite" width="72" height="72" />
</p>

**Web 文件管理器** · Vue 3 + TypeScript + Go

一个轻量的 Web 文件管理器：单一 Go (Echo) 服务，前端资源内嵌，打包成一个可执行文件。

> 功能列表、界面截图与完整说明以英文 [README.md](./README.md) 为**唯一维护源**，
> 本文件只保留最短的上手信息，避免两份全文互相漂移。

## 安装

从 [GitHub Releases](https://github.com/canwdev/file-lite/releases) 下载对应平台的压缩包，
解压后运行可执行文件：

```shell
# 以 Linux amd64 为例
unzip file-lite-linux_amd64-v*.zip
cd linux_amd64
./file-lite-go
```

启动后控制台会直接打印可用的访问链接，第一次使用不需要输密码——链接里的 `ticket`
就是登录凭证：

```text
Listening on: 0.0.0.0:3111
http://192.168.1.10:3111?ticket=a1b2c3d4
```

配置存放在 `<cwd>/file-lite/config.json`（可用 `FILE_LITE_DATA_BASE_DIR` 覆盖所在目录）：
登录密码是 `password` 字段，为空时会自动生成随机密码并写回，`jwtToken` 签名密钥同理。
每个字段的含义与缺省值见 [config.json 配置说明](./docs/config.md)；
控制台不会打印密码与签名密钥。

## 文档

| 内容 | 位置 |
| --- | --- |
| 功能、截图、安装、开发 | [README.md](./README.md) |
| 配置字段 | [docs/config.md](./docs/config.md) |
| 插件 | [docs/design/plugins.md](./docs/design/plugins.md) |
| IP 网段限制 / HTTPS | [docs/ip-allowlist.md](./docs/ip-allowlist.md) · [docs/ssl.md](./docs/ssl.md) |
| 设计文档 | [docs/design/](./docs/design/) |
| 端到端测试 | [e2e/README.md](./e2e/README.md) |

## 开发

前端使用 **Bun**，后端使用 **Go 1.20+**；编译与 `bun run build:all` 说明见
[backend-go/README.md](./backend-go/README.md)。

```shell
# 后端：热重载开发服务，端口 3111
cd backend-go
bun i
bun run dev
```

```shell
# 前端：Vite 开发服务，端口 3110，将 /api 代理到后端
cd frontend
bun i
bun run dev
```

```shell
# 打包当前平台：依次构建前端、Go 二进制和发布用 zip
cd backend-go
bun run build
```