# frontend

Vue 3 + Vite + TypeScript 前端应用。

## 开发与构建

使用 Bun 安装依赖并执行脚本。

```sh
bun i

# 开发
bun run dev

# 构建 Node.js 后端使用的前端产物
bun run build

# 构建 Go 后端使用的前端产物，输出到 backend-go/frontend/
bun run build:for-go
```
