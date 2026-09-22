# File Lite

中文 | [English](../../README.md)

![File Lite](../../frontend/public/favicon.webp)

**轻量、多功能的 Web 文件管理器** · Vue 3 + TypeScript + Go

> 这是一个 Vibe Coding 开源项目（早期版本为手写）。欢迎使用并反馈，但不保证稳定性，作者保留随时重写的权利。

---

![File Lite](../screenshots/00-main.webp)

| 截图 | 功能 |
| :-: | :-- |
| ![标签页与分栏](../screenshots/01-tabs-split.webp) | **标签页与分栏**：类似 Chrome 的标签页，加上 Total Commander 式的多栏视图，横竖都可以，文件能从一个栏直接拖到另一个栏。 |
| ![传输与后台任务](../screenshots/02-transfers-tasks.webp) | **传输与后台任务**：上传和下载；复制、移动、删除在服务端进行，带进度和取消，集中在右上角面板。 |
| ![Endless Gallery](../screenshots/03-gallery.webp) | **Endless Gallery**：把当前文件夹里的图片、视频和音频排成短视频式的竖向信息流，支持触摸、滚轮和键盘，并有收藏列表。 |
| ![音乐播放器](../screenshots/04-music-player.webp) | **音乐播放器**：播放列表、内嵌封面和同步歌词。 |
| ![视频播放器](../screenshots/05-video-player.webp) | **视频播放器**：ArtPlayer 或原生 `<video>`，可在应用菜单里切换，并记住上次打开的文件。 |
| ![预览与缩略图](../screenshots/06-thumbnails.webp) | **预览与缩略图**：图片预览、视频首帧（ffmpeg）和音频封面都由服务端生成，并缓存在浏览器里。 |
| ![文本编辑器](../screenshots/07-text-editor.webp) | **文本编辑器**：在浏览器里直接编辑并保存文本文件。 |
| ![属性窗口](../screenshots/08-properties.webp) | **Windows 风格的属性**：内置应用支持多窗口，也可以最小化。 |

- **后端**：单个 Go (Echo) 服务，界面内嵌，打成一个静态二进制
- **体积**：大约 **10MB**
- **功能**
  - 标签页与分栏、列表或网格、收藏和驱动器
  - 侧边栏里的网络共享和 WSL 发行版
  - 新建、重命名、复制、移动和删除；拖放上传和下载，可以把文件夹下载成 ZIP
  - 图片、视频和音乐预览，以及文本编辑器
  - Endless Gallery：当前文件夹的竖向信息流
  - 浅色、深色和跟随系统的主题
  - 插件（[预制插件](../../plugins-repo/README.md)）
- **安全**
  - 密码或 Ticket 登录
  - 可选的 IP 允许列表（[IP 允许列表](./ip-allowlist.md)）
  - HTTPS，包括自签名证书（[HTTPS](./ssl.md)）

## 安装

从 [GitHub Releases](https://github.com/canwdev/file-lite/releases) 下载对应平台的压缩包，解压后运行。

在 Windows 上，解压后双击 `file-lite-go.exe`。

```shell
# Linux amd64
unzip file-lite-linux_amd64-v*.zip
cd linux_amd64
./file-lite-go
```

控制台会打印可直接打开的地址。第一次运行不需要密码——链接里的 `ticket` 就是凭证：

```text
Listening on: 0.0.0.0:3111
http://192.168.1.10:3111?ticket=a1b2c3d4
```

配置在 `<cwd>/file-lite/config.json`。登录密码是 `password` 字段；为空时会生成并保存。控制台不会打印它。

## 开发

前端用 **Bun**（[前端](../../frontend/README.md)），后端用 **Go 1.20+**（[后端](../../backend-go/README.md)）。

```shell
# 后端：热重载开发服务，端口 3111
cd backend-go
bun i
bun run dev
```

```shell
# 前端：Vite 开发服务，端口 3110，把 /api 代理到后端
cd frontend
bun i
bun run dev
```

```shell
# 打包当前平台：构建前端、Go 二进制和发布用 zip
cd backend-go
bun run build
```

## 文档

- [AGENTS.md](./AGENTS.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [配置](./config.md)
- [HTTPS](./ssl.md)
- [IP 允许列表](./ip-allowlist.md)
- [预制插件](../../plugins-repo/README.md)
- [插件](../design/plugins.md)
- [标签页](../design/explorer-tabs-design.md)
- [后台文件操作](../design/async-file-operations-ws-design.md)
- [缩略图](../design/thumbnails.md)
- [存储与网络路径](../design/vfs-abstraction-design.md)
- [端到端测试](../../e2e/README.md)
