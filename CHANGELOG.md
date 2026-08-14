# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go` and `backend/package.json`.

## 1.4.3

- Refine UI details, enhance experience
- Optimize code structure
- Refactor the keyboard shortcut functionality and centrally manage keyboard shortcuts
- Add [File Viewer](https://github.com/flyfish-dev/file-viewer) app
- Supports the Clear Local Data feature


## 1.4.2

### UI

- The whole UI converges on the `@canwdev/vgo-ui` 0.4.0 style contract: only one button type, three panel variants and one list row remain. Toolbars, sidebars, status bars, empty states, progress bars and overlay buttons no longer each define their own styles. Spacing, font sizes, icons, control heights, z-index and animation durations all go through tokens.
- The immersive gallery, Steam cards, lyric page and player atmosphere backgrounds keep their look and are excluded from the convergence.
- "Open current filter results in gallery" moved from the file manager toolbar to the settings panel.

### Engineering

- `frontend/scripts/check-styles.mjs`: style-contract guardrail, run with `bun run lint`. Bans literal colors / border-radius, custom shadows, `backdrop-filter`, gradients, `var(--el-*)`, and non-scoped `<style>`; when truly necessary, write `// vgo-allow: reason` above the line.
- Cleared the existing lint errors; `bun run lint` is fully green for the first time.

## 1.4.1

- Source folder auto-refreshes after cut & paste; cut items appear semi-transparent.
- Newly created files / folders are auto-selected.
- Added e-ink mode; config persistence refactored.
- Service title is now configurable to tell multiple instances apart.

## 1.4.0

- CLI mode and zero-config startup, with automatic self-signed certificate generation.
- Fixed token invalidation caused by network errors.
