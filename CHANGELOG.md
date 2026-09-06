# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go` and `backend/package.json`.

## Unreleased

### Engineering

- Frontend icons are now on-demand inline SVGs from the MDI set instead of the full `@mdi/font` webfont (no font file is loaded anymore).

## 1.4.4

### Features

- Grid-view file previews and folder preview thumbnails now come from a local IndexedDB cache of ≤256px thumbnails (1 GB LRU), so revisiting a photo folder downloads each original image only once (frontend).
- Preview Size now only limits downloading originals: an image that is already cached still shows its thumbnail even when it exceeds the limit, and it disappears again only when Preview is disabled (frontend).
- Full-size image streams now revalidate with the browser using the file's size/mtime (ETag / Last-Modified), returning 304 instead of re-downloading unchanged files (Node.js / Go).

### Fixes

- Folder preview thumbnails no longer stretch the folder icon vertically when a contained image is taller than wide (frontend).
- Deleting or moving a file that is in use now reports the real failure reason instead of silently succeeding (Go; Node.js already surfaced delete errors).
- Failed deletes and fully-failed/cancelled uploads no longer refresh the file list (frontend).
- Multi-file zip downloads now fail with a clear error when a file can't be read, instead of silently dropping it from the archive (Go).
- Rename / create-directory failures now return the actual error message instead of a generic failure or an HTML error page (Node.js / Go).
- Cut & paste on the same drive is now a real instant move that keeps file metadata and hard links, instead of copy-then-delete (Node.js / Go).
- Copying or moving folders containing symbolic links keeps the links instead of recursively copying their targets (Go; Node.js already did).

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

