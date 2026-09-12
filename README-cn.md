# File Lite

中文 | [English](./README.md)

<p align="center">
  <img src="frontend/public/favicon.webp" alt="File Lite" width="72" height="72" />
</p>

**Web 文件管理器** · Vue 3 + TypeScript + Go

---

![screenshot](docs/screenshot.webp)

- **后端**：单一 Go (Echo) 服务，编译为内嵌前端资源的单文件可执行程序
- **打包体积**：单包不超过约 20MB
- **功能**
  - 文件与目录：创建、删除、重命名、移动、复制
  - 传输：批量上传、上传文件夹、下载、将文件夹打包为 ZIP 下载
  - 文本编辑器
  - 预览：图片、视频、音频；**音乐播放器**（播放列表、封面、歌词展示）
  - 视频：**ArtPlayer.js** 与**原生 `<video>`** 在菜单中一键切换（偏好持久化）
  - **Endless Gallery**：类短视频流的纵向滑动浏览，聚合当前目录下支持的图片 / 视频 / 音频，触屏与键鼠操作
  - 资源管理器：路径级布局与排序状态持久化、按扩展名设置默认打开方式等
- **安全**
  - 密码登录后签发 JWT 会话令牌
  - 控制台链接使用短时 `ticket` 登录参数，有效期 2 分钟；重新打印链接会生成新的 `ticket`
  - 支持“记住登录状态”：持久 Cookie 或浏览器会话 Cookie
  - 密码错误超次数可封禁 IP
  - 可限制允许访问的根路径范围
  - 可按 IP 段限制访问（`allowedCIDRs`）
  - 支持 HTTPS（含自签名证书）
  - 登录尝试频率限制

## 安装

从 [GitHub Releases](https://github.com/canwdev/file-lite/releases) 下载对应平台的压缩包，解压后运行可执行文件。

```shell
# 以 Linux amd64 为例
unzip file-lite-linux_amd64-v*.zip
cd linux_amd64
./file-lite-go
```

## 开发

前端使用 **Bun**，后端使用 **Go 1.20+**。

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

- **Go 后端**：编译与 `bun run build:all` 说明见 [backend-go/README.md](backend-go/README.md)
- **E2E UI 测试**：独立的 Playwright 子项目 [e2e/README.md](e2e/README.md)，测试方法与截图见 [docs/frontend-ui-testing.md](docs/frontend-ui-testing.md)
- **文件操作**：复制 / 移动 / 删除是走 WebSocket 的可取消后台任务，设计与实现说明见 [docs/async-file-operations-ws-design.md](docs/async-file-operations-ws-design.md)（未实现的多面板方案在 [docs/todo/](docs/todo/)）

## 配置文件

- 配置文件路径：`<cwd>/file-lite/config.json`（可用 `FILE_LITE_DATA_BASE_DIR` 覆盖所在目录）
- 配置类型说明：`Cfg` 见 [backend-go/config/config.go](backend-go/config/config.go)
- [使用 mkcert 生成并信任自签名证书](./docs/mkcert.md)
- [限制可访问的 IP 段（`allowedCIDRs`）](./docs/ip-allowlist.md)
- [缩略图与预览架构](./docs/thumbnails.md)
- `password` 为空时会自动生成随机密码；如果配置文件已存在，会写回到配置文件中
- `jwtToken` 是 JWT 签名密钥；如果配置文件已存在但为空，会自动生成并写回
- 控制台不会打印 JWT 或签名密钥；请通过配置文件查看登录密码
