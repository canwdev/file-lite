# File Lite

Web 文件管理器，技术栈 go (Echo) + Vue 3 (TypeScript)

![screenshot](docs/screenshot.webp)

- 打包体积不超过 20MB
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

进入前后端目录，查看对应文档。

- [后端](./backend/README.md)
- [前端](./frontend/README.md)

## 配置

支持的环境变量：

- `PORT`：服务端口，默认 `3100`
- `HOST`：服务主机，默认 `0.0.0.0`
- `ENV_DATA_BASE_DIR`：数据存储目录，默认 `data`

### data/config.json

```ts
interface IConfig {
  // 监听地址，如果传入 127.0.0.1 则不允许外部设备访问，默认 '0.0.0.0'
  host: string
  // 监听端口，默认 '3100'
  port: string
  // 是否开启无密码模式，开启后将不会检查密码。默认 false
  noAuth: boolean
  // 密码，留空则每次启动随机生成。默认 ''
  password: string
  // 安全路径(支持绝对路径和相对路径)，如果访问范围超出该目录会报错，设置为空字符串不检查。默认 ''
  safeBaseDir: string
  // 是否开启日志。默认 true
  enableLog: boolean
  // 传入以下两个参数来开启https
  // 生成证书(Windows 可以用 git bash 生成)：openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
  sslKey: string
  sslCert: string
}
```

- [使用 mkcert 生成并信任自签名证书](./docs/mkcert.md)
