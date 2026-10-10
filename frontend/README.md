# frontend

Vue 3 + Vite + TypeScript 前端应用。

## 开发与构建

使用 Bun 安装依赖并执行脚本。构建脚本里的 `vite` 由 Node 执行，因此还需要 Node `^20.19.0 || >=22.12.0`。

```sh
bun i

# 开发
bun run dev

# 构建：输出到 backend-go/frontend/，并打包为 backend-go/frontend-assets.tar.gz（Go 二进制内嵌的 gzip 压缩资源）
bun run build
```

## 国际化

- 语言包在 `src/i18n/locales/<locale>/index.json`，所有文案挂在单层命名空间 `file_lite_i18n` 下。
- `en-US` 是基准语言；`zh-CN` 暂时留空，运行期回退到 `en-US`。
- 模板里用 `$t`（vue-i18n 注入），`<script setup>` 与 `.ts` 里的 `$t` 由 unplugin-auto-import 从 `@/i18n` 自动引入。
- 界面语言存在服务端 `file_lite_settings_store` 的 `language` 字段；首次访问按浏览器语言检测并写回。
- 新增非技术文案直接改语言包（不再有提取脚本）；**同样的意思优先复用已有条目**，不要另起一条；用户没有要求翻译就不要自动翻译。
- 技术性内容保持字面量、不进语言包：抛出的异常、`hooks/` 与 `api/` 里的错误信息、`useShortcut` 的 `description`、按键名、比较值以及纯格式串（URL、CSS、HTML）。
- 省略号也不进语言包：语言包里存不带省略号的文案，调用点用 `ELLIPSIS`（见 `src/i18n/index.ts`）或模板里直接写 `…` 拼上。

