# frontend

Vue 3 + Vite + TypeScript 前端应用。

## 开发与构建

使用 Bun 安装依赖并执行脚本。

```sh
bun i

# 开发
bun run dev

# 构建：输出到 backend-go/frontend/，并打包为 backend-go/frontend-assets.tar.gz（Go 二进制内嵌的 gzip 压缩资源）
bun run build

# 与 build 等价的历史脚本名
bun run build:for-go
```
