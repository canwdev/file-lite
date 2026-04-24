# File Lite

中文 | [English](./README-en.md)

<p align="center">
  <img src="frontend/public/favicon.webp" alt="File Lite" width="72" height="72" />
  &nbsp;&nbsp;
  <img src="backend/favicon-nodejs.webp" alt="Node.js backend" width="72" height="72" />
</p>

<p align="center"><b>Web 文件管理器</b> · Vue 3 + TypeScript</p>

![screenshot](docs/screenshot.webp)

---

## 双后端

项目提供 **两种服务端实现**，共享同一套前端，可按部署场景选择其一：

| | **Node.js 后端** (`backend/`) | **Go 后端** (`backend-go/`) |
|:---|:---|:---|
| **技术** | Express.js + TypeScript，使用 Bun 开发与打包 | Echo，单文件可执行程序 |
| **典型用途** | `npm i -g file-lite` 全局安装、快速迭代与插件式扩展 | 资源占用低、容器 / 边缘设备单二进制分发 |
| **文档** | 见下文「开发」与配置说明 | [backend-go/README.md](backend-go/README.md) |

> 前端构建：Go 镜像需先执行 `frontend:build-go`，将静态资源输出到 `backend-go/frontend/`（详见 Go 后端 README）。


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
  - 密码认证；密码错误超次数可封禁 IP
  - 可限制允许访问的根路径范围
  - 支持 HTTPS（含自签名证书）
  - 访问频率限制

## 安装

```shell
# 全局安装（Windows 需要管理员权限）
npm i -g file-lite

# 运行
file-lite

# 卸载
npm uninstall -g file-lite
```

## 开发

使用 **Bun** 安装依赖与执行脚本；**默认产物面向 Node.js 运行时**（由 `backend` 打包并嵌入前端）。

```shell
# Node.js 后端
cd backend
bun i
bun run dev
bun run build
```

```shell
# 前端
cd frontend
bun i
bun run frontend:dev
bun run frontend:build
```

```shell
# 一键构建（后端嵌入前端）
cd backend
bun run build:auto

cd dist
node file-lite.min.mjs
```

- **Go 后端**：编译与 `frontend:build-go` 说明见 [backend-go/README.md](backend-go/README.md)

## 配置文件

- 配置文件路径：`${cwd}/data/config.json`
- 配置类型说明：[IConfig](backend/src/config/types.ts)
- 环境变量示例：[.env.development](./backend/.env.development)
- [使用 mkcert 生成并信任自签名证书](./docs/mkcert.md)
