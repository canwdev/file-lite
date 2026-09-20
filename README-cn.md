# File Lite

中文 | [English](./README.md)

<p align="center">
  <img src="frontend/public/favicon.webp" alt="File Lite" width="72" height="72" />
</p>

**Web 文件管理器** · Vue 3 + TypeScript + Go

---

![File Lite](docs/screenshots/00-main.webp)

|  |  |
| :-: | :-- |
| ![标签页与拆分视图](docs/screenshots/01-tabs-split.webp) | **多标签页与拆分视图**：类似 Chrome + Total Commander 的多标签页和多面板视图，支持水平和垂直分隔，内容可以直接从一个面板拖进另一个面板。 |
| ![传输与后台任务](docs/screenshots/02-transfers-tasks.webp) | **传输与后台任务**：上传下载，复制 / 移动 / 删除在服务端跑，有进度，可取消。进度集中显示在右上角面板。 |
| ![Endless Gallery](docs/screenshots/03-gallery.webp) | **Endless Gallery**：像刷短视频一样纵向浏览当前目录里的图片、视频和音频，支持触屏、滚轮和键盘操作。支持收藏。 |
| ![音乐播放器](docs/screenshots/04-music-player.webp) | **音乐播放器**：播放列表、文件内嵌封面与同步歌词播放。 |
| ![视频播放器](docs/screenshots/05-video-player.webp) | **视频播放器**：ArtPlayer 与原生 `<video>` 可在菜单中切换，并支持记住上次打开的文件。 |
| ![缩略图与预览](docs/screenshots/06-thumbnails.webp) | **缩略图与预览**：图片预览、视频首帧（ffmpeg）与音频封面都由服务端生成，并在浏览器中缓存。 |
| ![文本编辑器](docs/screenshots/07-text-editor.webp) | **文本编辑器**：在网页里直接编辑并保存文本文件。 |
| ![属性窗口](docs/screenshots/08-properties.webp) | **Windows 风格属性窗口**：Apps 支持多窗口交互并支持最小化。 |

- **后端**：单一 Go (Echo) 服务，编译为内嵌前端资源的单文件可执行程序
- **打包体积**：单包不超过约 20MB
- **功能**
  - 资源管理器：标签页与拆分视图、列表 / 网格、面包屑、收藏夹、磁盘、隐藏文件、过滤、按路径记住排序与布局
  - 网络驱动器：SMB / UNC 共享与 WSL 发行版是一等公民，映射盘符、「此电脑」里添加的网络位置、已安装的 WSL 发行版都会出现在侧边栏，其余路径直接在地址栏输入即可
  - 对象存储本身不提供挂载：先用 rclone、s3fs 等第三方工具把它挂成本机目录，挂好之后就能像普通目录一样浏览和读写；Windows 上用 rclone 挂载时请加 `--network-mode`，这样才会被认成网络驱动器、按更低的并发读取，而不是当成一块本机硬盘
  - 文件与目录：创建、重命名、移动、复制、重制副本、删除、属性、按扩展名设置默认打开方式
  - 挂载文件夹：通过 File System Access API（Chromium）把本机的一个文件夹挂成侧边栏位置，可就地浏览、写入与播放，并与服务端双向复制 / 移动（[设计与实现](./docs/design/browser-mounted-folders.md)）
  - 传输：拖拽上传（文件或文件夹）、下载、将文件夹打包为 ZIP 下载；复制 / 移动 / 删除是走 WebSocket 的可取消后台任务（[设计与实现](./docs/design/async-file-operations-ws-design.md)），有进度和失败重试
  - 同名冲突：替换、跳过或保留两者，可按单项或整批处理；目录按 Windows 资源管理器的方式合并
  - 预览：服务端生成缩略图 —— 图片预览、视频首帧（ffmpeg）、音频封面（[架构说明](./docs/design/thumbnails.md)）—— 并在浏览器缓存
  - 媒体：图片查看器（缩放、旋转）、视频播放器、音乐播放器（播放列表、内嵌封面、同步歌词）
  - Endless Gallery：类短视频流的纵向浏览，支持收藏与缩略图条
  - 编辑器与查看器：文本编辑器、HTML 查看器
  - 外部集成：通过短时 `ticket` 链接把 File Lite 当作“打开文件”选择器嵌入其它应用，无需密码
  - 实用工具：测速、实时文本同步
  - 界面：浅色 / 深色 / 跟随系统，多套配色，减少动效，全屏，屏幕常亮，触屏友好
  - 运维：在 Development 菜单中更新后端二进制、重启或退出服务
- **安全**
  - 密码登录后签发 JWT 会话令牌
  - 控制台链接使用短时 `ticket` 登录参数，有效期 2 分钟；重新打印链接会生成新的 `ticket`
  - 支持“记住登录状态”：持久 Cookie 或浏览器会话 Cookie
  - 密码错误超次数可封禁 IP
  - 可按 IP 段限制访问（[`allowedCIDRs`](./docs/ip-allowlist.md)）
  - 支持 HTTPS（[含自签名证书](./docs/ssl.md)）
  - 登录尝试频率限制

## 安装

从 [GitHub Releases](https://github.com/canwdev/file-lite/releases) 下载对应平台的压缩包，解压后运行可执行文件。

```shell
# 以 Linux amd64 为例
unzip file-lite-linux_amd64-v*.zip
cd linux_amd64
./file-lite-go
```

启动后控制台会直接打印可用的访问链接，第一次使用不需要输密码——链接里的 `ticket` 就是登录凭证：

```text
Listening on: 0.0.0.0:3111
http://192.168.1.10:3111?ticket=a1b2c3d4
```

配置存放在 `<cwd>/file-lite/config.json`（可用 `FILE_LITE_DATA_BASE_DIR` 覆盖所在目录）：登录密码是 `password` 字段，为空时会自动生成随机密码并写回，`jwtToken` 签名密钥同理。每个字段的含义与缺省值见[config.json 配置说明](./docs/config.md)；控制台不会打印密码与签名密钥。

## 开发

前端使用 **Bun**，后端使用 **Go 1.20+**；编译与 `bun run build:all` 说明见 [backend-go/README.md](backend-go/README.md)。

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

界面由 Playwright 子项目在真实浏览器里跑完整应用来覆盖：[e2e/README.md](e2e/README.md)，测试方法与用例截图见 [frontend-ui-testing.md](./docs/design/frontend-ui-testing.md)；上面的功能截图由 `cd e2e && bun run docs:screenshots` 生成，输出到 [docs/screenshots](./docs/screenshots)。
