---
description: 
alwaysApply: true
---

# File Lite

## Overview

A lightweight web file manager with a Go backend implementation. `README.md` is the project's main document.

## Frontend architecture

- Stack: Vite + Vue 3 + TypeScript
- Package manager: bun
- Development/build steps: see `frontend/README.md`
- Core interaction: WebUI-based file manager: `frontend/src/views/FileManager`
- Opening specific file types with apps: `frontend/src/views/Apps`
- API definitions: `frontend/src/api`
- Pure SCSS UI framework: `@canwdev/vgo-ui` — use native HTML where possible; `element-plus` is used in a few places
- Icons: `@mdi/font` plus `unplugin-icons`. Prefer the directly imported component (`<i-mdi-folder />`) whenever the name is a literal — it is compiled in and needs nothing else. `MdiIcon` (and a context menu's `icon:` field) takes a *name* that is resolved at runtime through `mdiIconRegistry` in `frontend/src/utils/icons.ts`, and an unregistered name silently falls back to a question-mark file icon instead of failing the build. **Every new name handed to `MdiIcon` or to a menu `icon:` must be registered**: import `~icons/mdi/<name>` and add the entry to that registry.
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

### E2E tests

`e2e/` is a separate Playwright sub-project that drives the built app in a real browser (see `e2e/README.md`).

- **Do not add or run E2E tests unless the user asks.** A small change — copy, styling, a menu entry, a debug fixture — is verified by reading the code and running `bun run lint` / `bun run type-check`, plus the Go tests next to whatever backend code it touches. The suite rebuilds the frontend, embeds it and starts a server, so it costs about a minute for a one-line change.
- When the user does ask for tests, or the change is large enough that reading it is not enough (dialogs, task lifecycle, upload/download flows), add the case to `e2e/` and run **only the affected spec** first (`cd e2e && node scripts/run-tests.mjs tests/0x-....spec.ts`). Run the whole suite only when asked.
- Keep the suite worth its cost: test the user-visible contract (the clipboard, the files on disk, the dialogs on screen), not the implementation. The three bugs it did find were only visible in a browser.
- Screenshots come from the tests (`e2e/screenshots/`) and are what the docs embed; when a test is removed, its screenshot goes too, and the docs reference is dropped with them.
- `expect.poll` fails immediately when its callback throws instead of retrying, so waiting for an asynchronous result must read through a non-throwing helper (`readTextIfExists` in `e2e/tests/helpers.ts`).
- Things that cannot be driven from a browser (file-operations primitives, task state machine, HTTP handlers) belong in Go tests next to the code.

## Changelog

`CHANGELOG.md` lives at the repository root and is **minimal**: only record changes users can perceive, one item per thing.

- Newest version first. Unreleased content goes under `## Unreleased` and is changed to a version number at release.
- Groups appear only as needed, with no empty headings: `### UI` / `### Features` / `### Fixes` / `### Engineering`. `Engineering` only holds things that affect the development workflow (guardrails, build, lint); purely internal refactors are not recorded.
- Use one sentence to say what change the user sees; do not list which files or class names changed — that is git log's job.
- When a change is specific to the frontend or the backend, say which side (frontend / backend).
- The version number must match in two places and be changed together at release: `frontend/src/enum/version.ts` and `const Version` in `backend-go/config/config.go`.

## Go backend architecture

The Go backend is the only backend implementation; there is no second implementation to keep in sync.

- Stack: Echo
- Development/build steps: see `backend-go/README.md`
- Config file loading: `backend-go/config`
- Auth: JWT, short-lived tickets, cookies, IP rate limiting — `backend-go/middlewares`
- Core routes: `backend-go/routes/files.go`
