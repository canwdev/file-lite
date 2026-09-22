# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go`.

## 1.5.0

### UI

- **Icons**: New icon set across the gallery, media player, video player, file viewer and text sync, with outline file icons and distinct icons for common file types (frontend).
- **Grid badges**: Grid view shows each file’s default app badge, and plugins are listed in a submenu when no built-in app matches (frontend).
- **Top bar**: The top bar now holds the page title, global menu, tab strip, sidebar toggle and shared transfer panel (frontend).
- **Sidebar**: The sidebar uses the raised surface colour, keeps its Storage heading pinned, remembers visibility, and highlights the current favourite or drive (frontend).
- **Breadcrumbs**: Breadcrumbs collapse with a leading …, highlight the current folder in the dropdown, and stop Up navigation at the starting location (frontend).
- **Menus**: Context menus have a border and dark-mode shadow, show existing shortcuts, and use title-cased Config labels and Material theme names (frontend).
- **Transfer panel**: The transfer panel has separate Transfers and Tasks tabs with their own summaries, actions, row layout, progress wash, type icons and status badges (frontend).
- **In-place updates**: Finished file operations update the current folder in place, and reloads keep the list, selection and scroll position (frontend).
- **Folder errors**: Folder open failures show the reason and a Try again button in the list area (frontend).
- **Drag and drop**: Drag and drop highlights targets, auto-scrolls the list, supports Ctrl-drag duplication, and uploads system files onto folders, breadcrumbs, favourites and drives (frontend).
- **Split view**: Split view has a narrower divider drag area, per-pane list/grid and icon size, focus outline, and remembered split (frontend).
- **Tabs**: New tabs and new split panes inherit the view they were opened from, and middle-clicking a drive, favourite, breadcrumb or toolbar Back/Forward/Up opens the target in a new tab (frontend).
- **Covers**: The player loads each queue item’s embedded cover from the shared thumbnail cache at thumbnail size instead of decoding the full-size artwork, and hides covers when content previews are disabled (frontend).
- **Compact layout**: The explorer toolbar and file list switch to a compact layout based on pane width (frontend).
- **Shortcuts**: Keyboard shortcuts are listed in a live menu (`?`), with additional shortcuts for tabs, sidebar, menu and app windows (frontend).

### Features

- **Plugins**: Plugins can be dropped into the server plugins folder, appear in the main menu, open in windows, and can read/write files and list directories (frontend, backend).
- **Tabs**: The explorer has built-in tabs that remember folder, selection, filter and scroll, can be reordered, split, merged, and moved between panes (frontend).
- **Branch and grouping**: Branch view (Ctrl+B) flattens subdirectories for batch actions, and folders can be grouped by name, type, size or date in list and grid views (frontend, backend).
- **Background tasks**: Copy, move, delete and duplicate run as background tasks visible in every open window, with conflict handling, retry of failed items, and in-place listing refreshes (frontend, backend).
- **Conflicts**: Uploads with existing names ask to replace, skip or keep both, and failed copy/move/delete reports list exactly which items failed (frontend, backend).
- **Properties**: The Properties window shows icon, name, type, path, size, contained files, and created/modified dates, counting folder sizes in the background (frontend, backend).
- **Access config**: `allowedRoots` restricts the file manager to listed folders; `startPath` is removed; `logLevel` replaces `enableLog` (backend).
- **Storage sidebar**: Linux sidebar shows only real storage with free/total space, and network locations, WSL distributions, mapped drives and locked BitLocker volumes appear with appropriate icons (backend, frontend).
- **Network paths**: Network paths in the address bar browse correctly, with clear errors for unreachable locations and host-only paths (frontend, backend).
- **Backend controls**: Self-update, stop and restart backend actions are available only when `allowSelfUpdate` is set (frontend, backend).
- **Open File picker**: The Open File picker opens with Esc, remembers folder and window size, and is selection-only (frontend).
- **Docs**: The README and the top-level configuration guides are available in Chinese as well as English.
- **README**: The README is shorter for new users: about 10MB, a Windows double-click install, and every document listed once at the bottom.
- **Plugins**: Plugin pages are served cross-origin isolated, so a plugin can use WebAssembly threads (SharedArrayBuffer) (frontend, backend).

### Fixes

- **Root folder**: On Linux, opening the root (`/`) from the sidebar no longer breaks entering its subfolders or their previews (frontend).
- **View refresh**: All open views refresh after upload, create, rename or save, and saved files update their size and modification time (backend, frontend).
- **Copy progress**: Copy progress is no longer double-counted, and upload/download rows update their progress, percentage and speed (backend, frontend).
- **Transfer cancellation**: Cancelling a transfer or task removes or marks its row correctly, and retries replace the old row (frontend).
- **Partial files**: Cancelled or interrupted copies and uploads no longer leave half-written files, and the server refuses overwrites unless requested (backend).
- **Batch results**: Batch copy/move reports every item’s result instead of stopping at the first conflict (backend).
- **Large deletes**: Deleting large folders runs as a cancellable task and refreshes the listing when done (frontend, backend).
- **Downloads**: Downloads preserve real names, including spaces and `+`, and no longer save as `download.<ext>` (frontend, backend).
- **Self-copy**: Copying a file into its own folder makes a copy beside it instead of replacing itself (frontend, backend).
- **Cross-disk moves**: Moving files or folders across disks works on Windows, including deep folders (backend).
- **Dotted filenames**: Uploading filenames with two dots in a row no longer fails as invalid (backend).
- **Editors and dialogs**: Text editor saving, video player settings, custom default app warnings, and share-sheet cancellation are fixed (frontend).
- **Image previews**: Image previews are requested earlier and kept until cells leave view; split-view thumbnails no longer fall back to question-mark icons (frontend).
- **Grid rendering**: The icon grid renders rows in the document flow to avoid drawing one row out of place (frontend).
- **Windows console**: On Windows, extracting video covers, opening the browser and checking for updates no longer flash a black console window (backend).
- **Tabs and navigation**: “Open in new Tab” always opens another tab, and Up/breadcrumb navigation stops at the starting location (frontend).
- **Properties and stale listings**: The Properties window works on network shares and mapped drives, and folder listings no longer stay stale after operations underneath a drive root (backend).

### Engineering

- **FS facade**: File reads and writes now go through one shared facade (`utils/fs`), so apps no longer import the file manager's internals or call the file API directly (frontend).
- **Facade enforcement**: Only that facade may call the file API directly: an eslint rule rejects `fsWebApi` anywhere else, because a missed call site only shows up as an empty preview (frontend).
- **Shared path rules**: The canonical path rules moved out of the file manager into the shared layer, because both the explorer and the storage facade need them (frontend).
- **E2E project**: A Playwright end-to-end sub-project (`e2e/`) drives the built app in a real browser and runs the conflict, progress, cancel and retry flows; its method and cases live in `e2e/README.md`.
- **Docs screenshots**: The README's feature screenshots are generated from a demonstration library by `cd e2e && bun run docs:screenshots`, so they follow the UI instead of being retaken by hand; the sample media is downloaded once into a gitignored cache.
- **E2E polling**: Waiting for an asynchronous result in the E2E suite no longer fails spuriously: `expect.poll` gives up as soon as its callback throws, so those checks read through a helper that returns null instead.
- **Windows E2E runner**: The E2E runner works on Windows again: it used to spawn Playwright's `.bin` shim, which Windows refuses to execute when it is a `.cmd` (and Bun installs an `.exe`), so the suite died with `spawn EINVAL` before running a single test; it now runs Playwright's `cli.js` through `node` on every platform (engineering).

## 1.4.5

### UI

- A "Disable preview" switch turns off every content preview in the file list; turning it on also clears the image cache, since none of it would be used again (frontend).
- The "Preview size" setting was removed: images always show a preview now, up to 20 MB for the formats the backend cannot generate thumbnails for (frontend).
- Formats the backend cannot decode (SVG, ICO, AVIF, HEIC) keep previewing through the browser, and large AVIF/HEIC files are still downscaled locally (frontend).
- Previews of audio and video files carry a small file-type icon in the bottom-right corner, since the cover alone does not say what the file is (frontend).
- Animated GIF previews now show a still first frame (frontend, backend).
- The transfer window title now shows both the file count and the transferred/total size, plus the current total transfer speed, and progress updates are throttled to the display refresh rate so large queues stay smooth (frontend).
- The transfer window footer shows a Retry All button while any transfer has failed (frontend).

### Features

- Image previews are now generated by the backend and cached in the browser, so grids and folder previews no longer download and decode full-size originals (frontend, backend).
- Music files show their embedded cover art, read from the file's own tags with range requests instead of downloading the whole track (frontend).
- Video files show a preview frame when ffmpeg is available; `ffmpegPath` in `config.json` points at the binary (empty means look on `PATH`), and without one video covers are simply absent instead of an error (frontend, backend).
- `--create-config --with-tls` puts detected local IPs in the certificate SAN (or, when `--tls-host` names hosts explicitly, exactly those hosts) and prints the certificate details, including its SAN, validity and SHA-256 fingerprint (backend).
- `--create-config --with-tls` generates the self-signed certificate with the Go standard library, so OpenSSL no longer needs to be installed (backend).
- `allowedCIDRs` in `config.json` restricts access to the listed IP ranges; the generated default is `null` (allow all) and an empty list denies all (backend).

### Fixes

- Previews no longer stop working entirely when another tab still holds an older version of the thumbnail cache open during an upgrade (frontend).
- Video covers give up quickly when the server is busy instead of holding a preview slot for thirty seconds (frontend, backend).
- The image cache no longer silently disables itself after upgrading from an earlier version, which had left the "Image cache" menu entry permanently empty (frontend).
- A thumbnail that only failed because the server was momentarily busy is retried the next time it is looked at, instead of showing a file icon until the view is reopened (frontend).
- Uploading or downloading many files no longer returns 429: the blanket per-request limit on the whole API was removed, and brute-force protection now rate-limits and bans only the login endpoint (backend).
- Switching files in the text editor no longer risks showing the previous file's content: the earlier load is cancelled as soon as another file is opened (frontend).
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

