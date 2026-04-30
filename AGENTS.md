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