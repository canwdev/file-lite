---
description: 
alwaysApply: true
---

# File Lite

## Overview

A lightweight web file manager with Node.js and Go backend implementations. `README.md` is the project's main document.

## Frontend architecture

- Stack: Vite + Vue 3 + TypeScript
- Package manager: bun
- Development/build steps: see `frontend/README.md`
- Core interaction: WebUI-based file manager: `frontend/src/views/FileManager`
- Opening specific file types with apps: `frontend/src/views/Apps`
- API definitions: `frontend/src/api`
- Pure SCSS UI framework: `@canwdev/vgo-ui` — use native HTML where possible; `element-plus` is used in a few places
- Icon library: `@mdi/font`
- `@vueuse/core` for persistence and common hooks such as `useStorage`, `useDebounceFn`, etc.
- The project-wide version is defined in `frontend/src/enum/version.ts`; the `const Version` in `config.go` must be updated to keep in sync

### Style contract

Components only write layout (flex / grid / positioning / sizing); visual expression always comes from vgo-ui primitives and tokens. **Before creating any new button / panel / list class, check the "Style Overview" page of the vgo-ui docs** (`vgo-ui/docs/src/views/docs/styles.md`) — it is the single vocabulary.

- Buttons: `.vgo-button` + `--primary` / `--danger` / `--text` / `--overlay` / `--overlay-light`, orthogonal with `--icon` / `--round` / `--sm` / `--lg`; the selected state uses `.is-active`.
- Panels: `.vgo-panel` (card), `--flat` (toolbar / header / footer), `--overlay` and `--overlay-light` (floating over images/videos; pick by the brightness of the underlying media — neither flips with the theme). There is no fifth variant.
- List rows: `.vgo-list-item` + `.is-active` / `.is-disabled`. Also `.vgo-empty`, `.vgo-badge`, `.vgo-progress`.
- Spacing / font size / icons / control height / z-index / duration always use `--vgo-space-*`, `--vgo-font-*`, `--vgo-icon-*`, `--vgo-control-*`, `--vgo-z-*`, `--vgo-duration-*`.

Banned: literal colors, literal `border-radius`, custom `box-shadow`, `backdrop-filter`, gradient backgrounds, `var(--el-*)`, `var(--vgo-x, #hex)` fallbacks, non-scoped `<style>`.

`bun run lint` runs `scripts/check-styles.mjs` to enforce the rules above; any violation fails. Two exemption mechanisms:

- Immersive / 3D / lyric-orchestration "atmosphere layers" are exempt per file; the list lives in the script's `FULLY_EXEMPT`.
- Exempt a single line or declaration by writing `// vgo-allow: reason` above it; the reason must be clear.

Note that the theme-layer selector is `body.vgo-theme-default .vgo-x` (specificity 0,2,1), which a flat single scoped class cannot beat. To override a themed property (typically `--flat`'s `border: 0`), nest one more parent selector.

## Changelog

`CHANGELOG.md` lives at the repository root and is **minimal**: only record changes users can perceive, one item per thing.

- Newest version first. Unreleased content goes under `## Unreleased` and is changed to a version number at release.
- Groups appear only as needed, with no empty headings: `### UI` / `### Features` / `### Fixes` / `### Engineering`. `Engineering` only holds things that affect the development workflow (guardrails, build, lint); purely internal refactors are not recorded.
- Use one sentence to say what change the user sees; do not list which files or class names changed — that is git log's job.
- When frontend and backend behavior differ, say which side (Node.js / Go).
- The version number must match in three places and be changed together at release: `frontend/src/enum/version.ts`, `const Version` in `backend-go/config/config.go`, and `backend/package.json`.

## Node.js backend architecture

- Stack: Express.js + TypeScript
- Package manager: bun
- Development/build steps: see `backend/README.md`
- Config file loading: `backend/src/config`
- Auth: JWT, short-lived tickets, cookies, IP rate limiting — `backend/src/middlewares`
- Core routes: `backend/src/routes/files`

## Go backend architecture

Implement the Node.js backend requirements first, then the Go backend. Its functionality is exactly the same as the Node.js backend; the Node.js implementation can serve as reference.

- Stack: Echo
- Development/build steps: see `backend-go/README.md`

## Testing

The `test` directory contains some test files for the backend APIs, but they haven't been updated in a long time — ignore them.
