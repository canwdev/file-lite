# Changelog

版本号定义在 `frontend/src/enum/version.ts`，与 `backend-go/config/config.go` 的 `const Version`、`backend/package.json` 保持一致。

## 1.4.2

### 界面

- 全站 UI 收敛到 `@canwdev/vgo-ui` 0.4.0 的样式契约：只剩一种按钮、三种面板、一种列表行。工具栏、侧边栏、状态栏、空状态、进度条、浮层按钮不再各写各的样式。间距、字号、图标、控件高度、层级、动画时长全部走 token。
- 沉浸式画廊、Steam 卡片、歌词页、播放器氛围底保持原样，不参与收敛。
- 「用画廊打开当前筛选结果」从文件管理器工具栏移到设置面板。

### 工程

- `frontend/scripts/check-styles.mjs`：样式契约护栏，随 `bun run lint` 执行。禁止字面量颜色 / 圆角、自定义阴影、`backdrop-filter`、渐变、`var(--el-*)`、非 scoped `<style>`；确有必要时在该行上方写 `// vgo-allow: 理由`。
- 清掉存量 lint 报错，`bun run lint` 首次全绿。

## 1.4.1

- 剪切粘贴后自动刷新源文件夹，被剪切项显示为半透明。
- 新建文件 / 文件夹后自动选中。
- 新增 e-ink 模式，配置持久化重构。
- 可设置服务标题，便于区分多个实例。

## 1.4.0

- 支持 CLI 模式与零配置启动，自动生成自签证书。
- 修复网络错误导致 token 失效。
