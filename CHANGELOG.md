# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go`.

## 1.5.0

### UI

- The floating task window became a panel docked to the bottom right that stays out of the file list, and it is full width on phones (frontend).
- The panel has two tabs: Transfers for uploads and downloads, which always run in the browser, and Tasks for background copy, move, delete and duplicate work on the server. Each tab has its own summary and its own actions, so a progress percentage or a "Cancel All" never mixes the two (frontend).
- Rows in both tabs share one layout — status icon, name, progress details on aligned columns — and the panel's footer only offers what applies to the tab you are looking at (frontend).
- Progress in the panel is now a translucent wash behind each row instead of a bar along its bottom edge, so the row keeps its height and nothing competes with the file name (frontend).
- The Transfers and Tasks tabs use up/down and left/right arrow file icons instead of a cloud and a synced folder (frontend).
- A new transfer opens the panel on its own tab: an upload or download brings up Transfers, a background copy, move, delete or duplicate brings up Tasks (frontend).
- Transfer and task rows keep their type icon — uploads and downloads now use a progress-upload / progress-download icon — and show running, paused, success or failure as a small corner badge instead of replacing the whole icon (frontend).
- The conflict dialog asks "What do you want to do?" and its options are left-aligned instead of centred (frontend).
- The debug switch moved into a Development submenu, which also has an entry that fills the transfer panel with a sample of every row state — uploads, downloads and background tasks alike — so its layout can be checked without transferring anything (frontend).
- The panel no longer leaves a growing list of successful operations behind: entries that finished without problems are dropped once the panel closes, while ones with failures or a cancel stay until removed, and the button that removes them is an × rather than a second checkmark (frontend).

### Features

- Copying, moving, deleting and duplicating are now background tasks: they show a progress bar, can be cancelled, and every open window sees and can cancel them (frontend, backend).
- When a copy or move lands on a name that already exists, a "Replace or Skip Files" dialog asks whether to replace, skip or keep both, with a "do this for all" option, instead of failing the whole batch (frontend, backend).
- Folders are merged the way Windows Explorer does it when the destination already has a folder of the same name, so only the conflicting files inside are asked about (backend).
- "Duplicate" now creates the copy directly with a `name - Copy` name instead of going through a temporary folder (frontend, backend).
- A finished copy or move refreshes both the source and the destination listing, in every open window (frontend, backend).
- Uploading a file whose name already exists now asks whether to replace it, skip it or keep both, instead of overwriting it without a word (frontend, backend).
- A copy, move or delete that fails now lists exactly which items failed and why, and "Try Again" retries only those items (frontend, backend).
- The panel opens itself when a background task starts and closes once every task has finished, and a button in the status bar shows or hides it — hiding it never cancels work in progress (frontend).
- Tasks started in one window are now visible in every other open window, including ones that were already open (frontend).

### Fixes

- Cancelling a background task — from its row or from the Replace or Skip Files dialog — now removes it from the list instead of leaving a "Cancelled" entry behind, and the dialog's Cancel no longer leaves the task waiting for a decision (frontend).
- Retrying a failed or cancelled transfer now shows the retried row and its progress instead of leaving the old, cancelled row on screen (frontend).
- Upload and download rows in the transfer panel now update while they run: the progress bar, percentage and speed used to stay at their first value because the virtualized rows never saw the field changes (frontend).
- Cancelling a transfer now marks its row as cancelled instead of leaving it showing "Uploading" (frontend).
- Several icons showed a question-mark file instead of the real one — the panel's tabs, the Development menu, and the conflict and failure dialogs — because icons named at runtime have to be registered (frontend).
- Opening File Lite now shows the tasks that are already running instead of an empty task window (frontend).
- New tasks appear in the task window immediately, so the progress bar, cancel button and failure list work for them (frontend, backend).
- Cancelling a copy can no longer leave half a file behind: every file is written to a temporary file next to the destination and only renamed into place once complete (backend).
- A batch copy or move no longer stops at the first conflicting name and silently leaves the earlier items done: every item now reports its own result (backend).
- Deleting a large folder no longer blocks the page: it runs as a cancellable task and the listing refreshes when it finishes (frontend, backend).
- An interrupted upload no longer leaves a half-written file at the destination, and the server refuses to overwrite an existing file unless the client asked for it (backend).
- Uploading a folder no longer skips files after the first 100 entries of a subfolder (frontend).
- Cancelling an upload no longer risks deleting a file that had already finished uploading (frontend).
- When a copy or move fails, the failed items are now always included in the report even if there are more results than fit in one message (backend).
- Error messages for a failed copy, move or upload no longer mention the internal temporary file name (backend).
- Downloading a file whose name contains a `+` no longer fails: the download path was decoded twice, and the second pass turned `+` into a space, so the file was reported as not found and the browser saved the error as `download.json` (backend).
- Copying a file and pasting it back into the same folder no longer asks whether to replace it with itself — an answer that rewrote the file in place and silently broke its hard links — and instead makes a copy beside it, the way Explorer does; moving an item into the folder it already lives in is a no-op (frontend, backend).
- Downloads keep their real name. A space in the name came out as `+`, and every file was saved as `download.<ext>` because the `download` attribute overrode the filename the server sent (frontend, backend).

### Engineering

- A Playwright end-to-end sub-project (`e2e/`) drives the built app in a real browser; it produces the screenshots used by `docs/frontend-ui-testing.md` and runs the conflict, progress, cancel and retry flows.
- Waiting for an asynchronous result in the E2E suite no longer fails spuriously: `expect.poll` gives up as soon as its callback throws, so those checks read through a helper that returns null instead.

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

