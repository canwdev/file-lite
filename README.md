# File Lite

Node.js 驱动的 Web 文件管理器

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
