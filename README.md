# File Lite

中文 | [English](./README-en.md)

Web 文件管理器，技术栈 Express.js + TypeScript + Vue 3

![screenshot](docs/screenshot.webp)

- 打包体积不超过 10MB
- 功能
  - 支持文件创建、删除、重命名、移动、复制
  - 支持批量文件上传、上传文件夹、下载、下载文件夹为zip
  - 支持文本编辑，图片、视频、音频文件预览
- 安全
  - 支持密码认证，支持密码错误超过次数封禁IP
  - 支持限制路径访问范围
  - 支持 HTTPS 协议（使用自签名证书）
  - 支持访问频率限制

## 开发

使用 bun 开发和编译，最终产物在 Node.js 环境运行

```shell
# backend
bun i
bun run dev
bun run build

# frontend
cd frontend
bun i
bun run frontend:dev
bun run frontend:build

# run dist
cd dist
node file-lite.min.mjs
```

## 配置文件

- 配置文件路径：`./data/config.json`
- 配置文档：[IConfig](./src/enum/config.ts)
- 支持的环境变量示例 [.env.development](.env.development)
- [使用 mkcert 生成并信任自签名证书](./docs/mkcert.md)
