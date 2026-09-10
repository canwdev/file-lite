# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go`.

## 1.4.5

### UI

- The transfer window title now shows both the file count and the transferred/total size, plus the current total transfer speed, and progress updates are throttled to the display refresh rate so large queues stay smooth (frontend).
- The transfer window footer shows a Retry All button while any transfer has failed (frontend).

### Features

- `--create-config --with-tls` puts detected local IPs in the certificate SAN (or, when `--tls-host` names hosts explicitly, exactly those hosts) and prints the certificate details, including its SAN, validity and SHA-256 fingerprint (backend).
- `--create-config --with-tls` generates the self-signed certificate with the Go standard library, so OpenSSL no longer needs to be installed (backend).
- `allowedCIDRs` in `config.json` restricts access to the listed IP ranges; the generated default is `null` (allow all) and an empty list denies all (backend).

### Fixes

- Uploading or downloading many files no longer returns 429: the blanket per-request limit on the whole API was removed, and brute-force protection now rate-limits and bans only the login endpoint (backend).
- The transfer window no longer re-renders once per finished file, which had made its buttons unclickable while moving many small files (frontend).
- Downloading a folder shows real byte progress and a total speed again: queued download tasks carry the size from the directory listing, and a file that finishes between frames still contributes its final bytes (frontend).

### Engineering

- The Node.js backend and its npm distribution were removed: File Lite now ships only the Go binary, and one build command packages the frontend and the current platform (all platforms for releases).
- Building now fails early when `frontend/src/enum/version.ts` and `backend-go/config/config.go` disagree on the version.

## 1.4.4

### Features

- EndlessGallery also switches images with the left/right arrow keys, and keyboard switching no longer plays the slide animation (frontend).
- EndlessGallery has a bottom thumbnail strip that fades in on hover: scroll it horizontally with the native scrollbar, click a thumbnail to jump instantly, and the semi-transparent theme-color background shows how far the current image is in the folder (frontend).
- EndlessGallery collects the current image with the `c` key (frontend).
- On touch screens EndlessGallery keeps up with fast repeated swipes instead of ignoring a swipe that arrives while the previous image is still sliding (frontend).
- EndlessGallery plays video and audio with its own minimal controls: tap to play or pause, a translucent play icon while paused, muted autoplay that loops, a mute toggle at the bottom left, and a thin seek bar you can drag (frontend).
- EndlessGallery unloads the video or audio element and its source as soon as the item leaves the screen, and resumes from where it was when you come back (frontend).
- Grid and list thumbnails now load only once they scroll near the viewport instead of all at once when a folder opens (frontend).
- Grid-view file previews and folder preview thumbnails now come from a local IndexedDB cache of ≤256px thumbnails (1 GB LRU), so revisiting a photo folder downloads each original image only once (frontend).
- Preview Size now only limits downloading originals: an image that is already cached still shows its thumbnail even when it exceeds the limit, and it disappears again only when Preview is disabled (frontend).
- Full-size image streams now revalidate with the browser using the file's size/mtime (ETag / Last-Modified), returning 304 instead of re-downloading unchanged files (Node.js / Go).

### Engineering

- Frontend icons are now on-demand inline SVGs from the MDI set instead of the full `@mdi/font` webfont (no font file is loaded anymore).
- Frontend bundles shrink by about a third: Element Plus styles are imported per component instead of the full stylesheet, and the `moment` dependency is replaced with the much smaller `dayjs` (frontend).
- The Go single-file binary is roughly 1 MB smaller per platform: the embedded frontend is stored gzip-compressed, static assets are served with gzip, and cross builds are static with trimmed paths (Go).

### Fixes

- Folder preview thumbnails no longer stretch the folder icon vertically when a contained image is taller than wide (frontend).
- Deleting or moving a file that is in use now reports the real failure reason instead of silently succeeding (Go; Node.js already surfaced delete errors).
- Failed deletes and fully-failed/cancelled uploads no longer refresh the file list (frontend).
- Multi-file zip downloads now fail with a clear error when a file can't be read, instead of silently dropping it from the archive (Go).
- Rename / create-directory failures now return the actual error message instead of a generic failure or an HTML error page (Node.js / Go).
- Cut & paste on the same drive is now a real instant move that keeps file metadata and hard links, instead of copy-then-delete (Node.js / Go).
- Copying or moving folders containing symbolic links keeps the links instead of recursively copying their targets (Go; Node.js already did).
- EndlessGallery no longer stars the current image on a double tap, so accidental double taps don't change the collection (frontend).
- Dragging on a video in EndlessGallery now swipes to the next item instead of being ignored (frontend).
- The EndlessGallery thumbnail strip no longer freezes on folders with thousands of images, because it only renders the part that is on screen (frontend).

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

