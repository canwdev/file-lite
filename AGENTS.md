---
description: 
alwaysApply: true
---

# File Lite

## 概述

一个的轻量级 web 文件管理器，包含 Node.js 和 Go 两种后端实现。`README.md` 是项目主文档。

## 前端架构

- 架构：Vite + Vue3 + TypeScript
- 包管理：bun
- 开发构建步骤参考：`frontend/README.md`
- 核心交互：基于WebUI的文件管理器：`frontend/src/views/FileManager`
- 支持用 App 打开特定类型的文件：`frontend/src/views/Apps`
- 接口定义：`frontend/src/api`
- 纯SCSS UI框架：`@canwdev/vgo-ui`，尽可能使用HTML原生实现，小部分使用`element-plus`
- 图标库：`@mdi/font`
- 使用 `@vueuse/core` 做持久化和一些常用hooks，例如`useStorage`、`useDebounceFn`等
- 整个项目的版本号定义：`frontend/src/enum/version.ts`，需要需要修改config.go:const Version 的版本号以保持一致

### 样式契约

组件里只写布局（flex / grid / 定位 / 尺寸），视觉表达一律来自 vgo-ui 的基元和 token。**新建按钮 / 面板 / 列表类之前，先查 vgo-ui 文档站的「样式总览」页**（`vgo-ui/docs/src/views/docs/styles.md`），那是唯一的词汇表。

- 按钮：`.vgo-button` + `--primary` / `--danger` / `--text` / `--overlay` / `--overlay-light`，与 `--icon` / `--round` / `--sm` / `--lg` 正交；选中态用 `.is-active`。
- 面板：`.vgo-panel`（卡片）、`--flat`（工具栏 / 头部 / 底栏）、`--overlay` 与 `--overlay-light`（浮在图片视频上，按底下媒体的明暗选，两套都不随主题翻转）。没有第五种。
- 列表行：`.vgo-list-item` + `.is-active` / `.is-disabled`。另有 `.vgo-empty`、`.vgo-badge`、`.vgo-progress`。
- 间距 / 字号 / 图标 / 控件高度 / 层级 / 时长一律用 `--vgo-space-*`、`--vgo-font-*`、`--vgo-icon-*`、`--vgo-control-*`、`--vgo-z-*`、`--vgo-duration-*`。

禁止：字面量颜色、字面量 `border-radius`、自定义 `box-shadow`、`backdrop-filter`、渐变背景、`var(--el-*)`、`var(--vgo-x, #hex)` 兜底、非 scoped `<style>`。

`bun run lint` 会执行 `scripts/check-styles.mjs` 强制上述规则，违规即失败。两种豁免方式：

- 沉浸式 / 3D / 歌词编排等"氛围层"整文件豁免，名单在脚本的 `FULLY_EXEMPT` 里。
- 单行或单条声明豁免，在其上方写 `// vgo-allow: 理由`，理由必须写清楚。

注意主题层选择器是 `body.vgo-theme-default .vgo-x`（特异度 0,2,1），平铺的单个 scoped 类压不过它。要覆盖主题给的属性（典型是 `--flat` 的 `border: 0`）必须多嵌一层父选择器。


## CHANGELOG

`CHANGELOG.md` 在仓库根目录，**极简**：只记使用者能感知到的变化，一条一件事。

- 新版本在最前。未发布的内容写在 `## 未发布` 下，发版时改成版本号。
- 分组按需出现，不要空标题：`### 界面` / `### 功能` / `### 修复` / `### 工程`。`工程` 只放会影响开发流程的事（护栏、构建、lint），纯内部重构不写。
- 用一句话说清用户看到什么变化，不要罗列改了哪些文件、哪些类名——那是 git log 的事。
- 前后端行为不一致时要点明是哪一侧（Node.js / Go）。
- 版本号三处必须一致，发版时一起改：`frontend/src/enum/version.ts`、`backend-go/config/config.go` 的 `const Version`、`backend/package.json`。

## Node.js 后端架构

- 架构：Express.js + TypeScript
- 包管理：bun
- 开发构建步骤参考：`backend/README.md`
- 配置文件读取：`backend/src/config`
- 鉴权：JWT、短时间Ticket、Cookie、IP限流`backend/src/middlewares`
- 核心接口：`backend/src/routes/files`

## Go 后端架构

优先实现Node.js后端需求后，再实现Go后端。功能与Node.js后端完全相同，可以参考Node.js后端实现。

- 架构：Echo
- 开发构建步骤参考：`backend-go/README.md`

## 测试

`test`目录下包含一些测试文件，用于测试后端接口。但这些内容很久没更新了，请无视。