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
| ![标签页与拆分视图](docs/screenshots/01-tabs-split.webp) | **标签页与拆分视图**：同时打开多个目录，把一个标签拆成左右或上下两个面板，文件可以直接从一个面板拖进另一个面板的文件夹。 |
| ![传输与后台任务](docs/screenshots/02-transfers-tasks.webp) | **传输与后台任务**：上传下载在浏览器里跑，复制 / 移动 / 删除在服务端跑，都是可取消的任务，进度集中显示在右下角面板里。 |
| ![Endless Gallery](docs/screenshots/03-gallery.webp) | **Endless Gallery**：像刷短视频一样纵向浏览当前目录里的图片、视频和音频，支持滑动、滚轮和键盘操作。 |
| ![音乐播放器](docs/screenshots/04-music-player.webp) | **音乐播放器**：播放列表、文件内嵌封面与同步歌词，只读取文件自身的标签，不整包下载。 |
| ![视频播放器](docs/screenshots/05-video-player.webp) | **视频播放器**：ArtPlayer 与原生 `<video>` 可在菜单中一键切换，偏好按浏览器记住。 |
| ![缩略图与预览](docs/screenshots/06-thumbnails.webp) | **缩略图与预览**：图片预览、视频首帧（ffmpeg）与音频封面都由服务端生成，并在浏览器中缓存。 |
| ![文本编辑器](docs/screenshots/07-text-editor.webp) | **文本编辑器**：在网页里直接编辑并保存文本文件，有未保存提醒，保存前会检查文件是否已被改动。 |
| ![属性窗口](docs/screenshots/08-properties.webp) | **Windows 风格属性窗口**：图标、类型、完整路径、大小与日期，文件夹的递归体积在后台计算并回填。 |

- **后端**：单一 Go (Echo) 服务，编译为内嵌前端资源的单文件可执行程序
- **打包体积**：单包不超过约 20MB
- **功能**
  - 资源管理器：标签页与拆分视图、列表 / 网格、面包屑、收藏夹、磁盘、隐藏文件、过滤、按路径记住排序与布局
  - 文件与目录：创建、重命名、移动、复制、重制副本、删除、属性、按扩展名设置默认打开方式
  - 传输：拖拽上传（文件或文件夹）、下载、将文件夹打包为 ZIP 下载；复制 / 移动 / 删除是可取消的后台任务，有进度和失败重试
  - 同名冲突：替换、跳过或保留两者，可按单项或整批处理；目录按 Windows 资源管理器的方式合并
  - 预览：服务端生成缩略图 —— 图片预览、视频首帧（ffmpeg）、音频封面 —— 并在浏览器缓存
  - 媒体：图片查看器（缩放、旋转）、视频播放器、音乐播放器（播放列表、内嵌封面、同步歌词）
  - Endless Gallery：类短视频流的纵向浏览，支持收藏与缩略图条
  - 编辑器与查看器：文本编辑器、HTML 查看器
  - 外部集成：通过短时 `ticket` 链接把 File Lite 当作"打开文件"选择器嵌入其它应用，无需密码
  - 实用工具：测速、实时文本同步
  - 界面：浅色 / 深色 / 跟随系统，多套配色，减少动效，全屏，屏幕常亮，触屏友好
  - 运维：在 Development 菜单中更新后端二进制、重启或退出服务
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
- **E2E UI 测试**：独立的 Playwright 子项目 [e2e/README.md](e2e/README.md)，测试方法与截图见 [docs/design/frontend-ui-testing.md](docs/design/frontend-ui-testing.md)
- **README 截图**：`cd e2e && bun run docs:screenshots` 会用演示素材重新生成上面的表格，输出到 [docs/screenshots](docs/screenshots)
- **文件操作**：复制 / 移动 / 删除是走 WebSocket 的可取消后台任务，设计与实现说明见 [docs/design/async-file-operations-ws-design.md](docs/design/async-file-operations-ws-design.md)

## 配置文件

- 配置文件路径：`<cwd>/file-lite/config.json`（可用 `FILE_LITE_DATA_BASE_DIR` 覆盖所在目录）
- [配置项说明：每个字段的含义与缺省值](./docs/config.md)
- 配置类型说明：`Cfg` 见 [backend-go/config/config.go](backend-go/config/config.go)
- [启用 HTTPS（自签名证书）](./docs/ssl.md)
- [限制可访问的 IP 段（`allowedCIDRs`）](./docs/ip-allowlist.md)
- [缩略图与预览架构](./docs/design/thumbnails.md)
- `password` 为空时会自动生成随机密码；如果配置文件已存在，会写回到配置文件中
- `jwtToken` 是 JWT 签名密钥；如果配置文件已存在但为空，会自动生成并写回
- 控制台不会打印 JWT 或签名密钥；请通过配置文件查看登录密码
