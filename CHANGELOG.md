# Changelog

The version number is defined in `frontend/src/enum/version.ts` and must stay in sync with `const Version` in `backend-go/config/config.go`.

## 1.6.0

### UI

- **Plugins menu**: Installed plugins moved out of the global menu's submenu into their own button next to it, which appears only when at least one plugin is installed (frontend).

### Features

- **Linked plugins**: A plugin in the data directory's `plugins/` folder can now be a link to a folder or an `.html` file elsewhere, so a plugin's build output can be used without copying it (backend).
- **Plugin SDK**: Built-in apps and plugins now share one API; plugins can read text files in their own encoding, build stream URLs, stream a file in chunks, inspect and update their launch state, select or reveal files in the explorer, and open the file picker (frontend).
- **File picker**: The file manager's picker is now one dialog shared by everything: single files, several files, a folder, or a save target with a file name, opened through the SDK (`pick`) instead of each caller embedding its own window; saving onto an existing name asks before replacing it (frontend).
- **Text editor**: The menu bar has one File entry (Refresh stays next to it), Open / Save / Save As choose their file in the file manager instead of a browser dialog, and unsaved changes are marked with a dot in the window title instead of a `*` in the menu (frontend).
- **Player picker**: Opening a server video or subtitle from the player's settings uses the shared picker (frontend).
- **Plugin menus**: Open, Save and Save As default to the file manager; opening and saving on this computer are a separate group below them, and `Ctrl+O` / `Ctrl+Shift+S` follow the same default (frontend).

### Fixes

- **File picker**: A new pick no longer inherits the filter from the previous one, so `pick` without `extensions` shows every file (frontend).
- **Text editor**: A text file opened for the first time showed an empty editor until the window was closed and opened again (frontend).
- **Unsaved prompt**: The dialog asks whether to discard the changes, with a Discard button, instead of "continue to exit/reload" (frontend).
- **Monaco Editor plugin**: Documents open and save in their own encoding, the window title is the file's full path, and the status line no longer says "Opening …" long after the document has loaded (frontend).
- **Markdown Viewer plugin**: A GB18030 document renders correctly, and the file is read as a stream instead of one buffer (frontend).
- **Webamp Player plugin**: Tracks play straight from the stream URL, so a playlist no longer reads every file into memory (frontend).
- **Boxed Wine plugin**: Programs and archives are streamed into the emulated drive with progress, instead of being buffered first (frontend).
- **ONLYOFFICE plugin**: The welcome page offers Open (from the file manager) and Open from this computer; a new document asks where to save it and is written as soon as it is created; Save (Ctrl+S or the toolbar button) now really writes the file instead of only reporting "all changes saved", and nothing is written without that action; the window title shows `·` while the editor has changes and `●` when the editor saved but the file manager still has the old file (spreadsheets commit a cell on blur); the title bar can no longer rename the document; Save copy asks for its target instead of auto-naming a file (frontend).
- **Breadcrumb**: On Windows, a location that has its own name (Home, a network location) is labeled by that name in the address bar instead of showing its full path (frontend).

### Engineering

- **Plugin API**: Plugins no longer get a compatibility branch: `onOpen` always receives one `{ path, filename, directory }` object, and the old `(path, filename)` callback form and `name` field are gone (frontend).

## 1.5.2

### UI

- **Folder view**: The list or grid view is saved per folder and inherited by its subfolders, instead of one global view for every folder (frontend).

### Fixes

- **Folder state**: The sort mode is saved per folder and inherited by subfolders (frontend).
- **Subtitles**: A subtitle added outside File Lite shows up in an already open player after its folder is refreshed, without reloading the page (frontend).

## 1.5.1

### UI

- **Terminal menu**: The first menu entry is now Open Web UI, which opens the loopback page directly instead of the IP selector (backend).
- **Toolbar**: The eye button that toggled hidden files is now Properties, which opens the Properties window for the current selection; Ctrl+H still toggles hidden files (frontend).
- **Properties**: The toolbar Properties button also works with nothing selected and then shows the current folder (frontend).
- **Paths**: The More menu of a selection and a folder's address-bar menu can copy a path with Windows backslashes, next to Copy Path (frontend).
- **Subtitles**: Every subtitle matching the video is now found, including files kept in a subtitle folder beside it such as `SRT/`, `Subs/` or `字幕/`, and can be selected in the native track menu or the Artplayer settings menu (frontend).
- **Subtitle style**: Artplayer subtitles are larger and sit farther from the bottom edge (frontend).
- **Settings**: The Data section is now File Management and holds Show hidden files, Show folders first and Disable preview (frontend).
- **Fullscreen**: The global menu no longer toggles browser fullscreen; every app window has a fullscreen button in its title bar that fills the screen with that window's content, and Esc leaves it (frontend).
- **Fonts**: The interface uses the system UI font stack instead of Inter/Avenir (frontend).
- **Player menus**: The playback speed and loop mode buttons now toggle their menus open and closed on click, stay highlighted while open, and open above the control bar (frontend).

### Features

- **Background themes**: Settings has a separate Theme dropdown with Default and Translucent; Translucent uses a pickable wallpaper (preset, URL, uploaded image or an image's More context menu) behind semi-transparent surfaces, the light/dark and background settings stay local to the browser, and the color theme still syncs across devices (frontend).
- **Public links**: Selected files can be copied as a public link that expires after 3 hours, 24 hours, 7 days or 30 days, or downloaded as an M3U playlist, so an external player such as PotPlayer can open the video without signing in (frontend, backend).
- **Session**: The access token now expires after 15 minutes and renews itself while the app is open or used, so a stolen token is short-lived without signing the user out (frontend, backend).
- **Session lifetime**: A session that sits unused for 30 days asks for the password again; the renewal window slides on use (frontend, backend).
- **Session upgrade**: Sessions created before 1.5.1 sign in once after the update (backend).
- **Ticket tiers**: The IP Chooser can issue a login ticket that lasts 15 minutes, 1 hour, 8 hours, or 24 hours, or the persistent renewable session (frontend, backend).
- **Temporary sessions**: A fixed-lifetime ticket logs the device out when it expires, cannot renew, and cannot mint further tickets; the terminal's printed ticket keeps the persistent behaviour (frontend, backend).
- **Ticket links**: A browser that is already signed in ignores a ticket link instead of replacing its current session or tier (frontend, backend).
- **Login tickets**: A ticket link now stays valid for five minutes instead of two, so there is more time to open it or scan the QR code (backend).
- **Ticket format**: A login ticket is now ten lowercase letters and digits instead of eight mixed-case characters, so it is easier to type (backend).
- **IP Chooser**: The page no longer shows a WebSocket disconnected notice, because it never opens a socket (frontend).
- **Login**: Remember login status is unchecked by default; ticket links remain persistent (frontend, backend).
- **Windows 32-bit**: The release now includes a 32-bit Windows build that runs on Windows 7 or later (backend).

### Fixes

- **HTTPS/HTTP switch**: Auth cookies are now named per scheme, so a browser that once opened the HTTPS URL can sign in over HTTP again instead of being stuck at `not signed in`; existing sessions sign in once after the update (backend, frontend).
- **Login links**: Every printed address now has its own one-time ticket, so opening the loopback link no longer makes the LAN link fail; a ticket is still accepted only once (backend).
- **IP Chooser**: Refreshing the ticket keeps the address that was selected instead of switching back to the default one (frontend).
- **Auth errors**: A rejected request or sign-in now says why — for example `Unauthorized: wrong password` or `Unauthorized: ticket is invalid or already used` — instead of a bare Unauthorized (backend).
- **Login attempts**: A wrong password now needs 15 failures from one IP before the 15-minute ban instead of 5, so mistyping a password no longer locks the user out so easily (backend).
- **Windows restart**: Restarting the backend from a terminal opens a terminal window for the new process instead of continuing in the background, so the TUI comes back (backend).
- **Media playback**: A video, thumbnail, or download requested after the access token expired now renews the session on that read itself, so playback continues from where it was instead of stopping or reloading, and the client-side media recovery is gone (frontend, backend).
- **Player covers**: The music player still shows embedded covers when content previews are disabled; on a CD-ROM the playing track parses its cover once and caches it, and playlist rows only read the cache (frontend).
- **Optical previews**: A file list on a CD-ROM now shows thumbnails that are already in the browser cache instead of hiding every preview, but never generates a new one (frontend).
- **Playback controls**: The two time labels keep their full width in a narrow player window; only the progress bar between them shrinks (frontend).
- **Resume playback**: The file list's resume button no longer restarts the track that is already playing or makes its title, artist and lyrics disappear (frontend).
- **Lyrics**: Tracks whose timed lyrics live in a non-standard tag field (for example `UNSYNCED LYRICS`) now show them in the player instead of appearing to have none (frontend).
- **Column resize**: The divider between two file-table column headers can be grabbed on both sides, and it highlights on hover; the drag area no longer stops at the header cell's edge (frontend).
- **Translations**: A string a locale has not translated yet falls back to English instead of showing the raw key, and the Chinese login validity period label is back (frontend).
- **Group headers**: The pinned group header now scrolls horizontally with the file list/table instead of staying fixed at the left edge and misaligning with the columns (frontend).

## 1.5.0

### UI

- **Endless Gallery**: The thumbnail strip is a row of its own under the picture instead of an overlay on top of it, and a mini handle centred on its top edge collapses and expands it (frontend).
- **Endless Gallery zoom**: Holding the right mouse button while scrolling zooms around the pointer, and the right button no longer drags the picture or opens the browser's menu (frontend).
- **Text Sync**: Opening the app focuses the textarea, so typing (or pasting) can start right away (frontend).
- **Utility windows**: Speed Test and Keyboard Shortcuts open as normal windows instead of maximised (frontend).
- **Gallery controls**: The whole overlay layer — navigation buttons, the collection button at the bottom left, the zoom toolbar, the thumbnail strip and its progress band — shares one palette that follows the theme (light surfaces with dark icons in light mode, dark surfaces with light icons in dark mode), and the wheel and the navigation buttons step through media instantly instead of sliding; only a swipe still animates (frontend).
- **Settings**: The Preview section is now Data and no longer has an Image cache row of its own (the cache is cleared from Local data); the Page section is gone and Title moved to the end of Appearance (frontend).
- **Delete dialog**: The delete confirmation lists the file and folder names in bold, shows folder names in the danger colour, and lists at most the first five names (frontend).
- **Settings**: Theme, app preferences, page title, preview cache and development actions open in a Settings window instead of nested menu items (frontend).
- **Drive icons**: Storage icons use the outline form when that icon exists (frontend).
- **File system**: Hovering a drive shows its file system (ext4, NTFS, 9p, iso9660, …) in the tooltip (frontend, backend).
- **Extract**: Opening an unsupported file shows File Viewer, Extract... (when the archive can be extracted), and Open in Browser (frontend).
- **IP Chooser**: On a wide screen the address list scrolls on the left and the QR code stays on the right; on a narrow screen the QR code sits above a scrolling list (frontend).
- **App windows**: Pressing Esc closes the active app window. In the gallery, Esc first closes the end-of-gallery overlay (frontend).
- **Properties**: Properties opens as its own small window, not maximised and centred in the viewport, and each selection opens another one that can be minimised (frontend).
- **Color themes**: Each accent color uses a darker shade in light mode and a lighter shade in dark mode, and switching the mode applies the matching shade (frontend).
- **Icons**: New icon set across the gallery, media player, video player, file viewer and text sync, with outline file icons and distinct icons for common file types (frontend).
- **Grid badges**: Grid view shows each file’s default app badge, and plugins are listed in a submenu when no built-in app matches (frontend).
- **Folder previews**: The folder tab on thumbnail previews is drawn as a folder-shaped trapezoid instead of a rounded bar (frontend).
- **Top bar**: The top bar now holds the page title, global menu, tab strip, sidebar toggle and shared transfer panel (frontend).
- **Sidebar**: The sidebar uses the raised surface colour, keeps its Storage heading pinned, remembers visibility, and highlights the current favourite or drive (frontend).
- **Breadcrumbs**: A storage icon on the left opens the volume list and breadcrumbs collapse when the pane is narrow, the subfolder dropdown highlights the current folder, and Up navigation stops at the starting location (frontend).
- **Breadcrumb fit**: Long paths keep as many trailing segments as fit the address bar width, instead of always collapsing to the last two, and stay correct after a refresh or a tab switch (frontend).
- **Menus**: Context menus have a border and dark-mode shadow, show existing shortcuts, and use title-cased Config labels and Material theme names (frontend).
- **Menu rendering**: Context menus and the text editor menu bar now use vgo-ui’s menu component, so their colours and dark mode come from the shared theme tokens (frontend).
- **Menu buttons**: The top-bar Menu button and the file list Menu button toggle their menu open and closed, and stay highlighted while it is open (frontend).
- **Breadcrumb menu**: The caret after a breadcrumb segment opens its subfolder list as a vgo-ui dropdown menu (frontend).
- **Transfer panel**: The transfer panel has separate Transfers and Tasks tabs with their own summaries, actions, row layout, progress wash, type icons and status badges (frontend).
- **In-place updates**: Finished file operations update the current folder in place, and reloads keep the list, selection and scroll position (frontend).
- **Folder errors**: Folder open failures show the reason and a Try again button in the list area (frontend).
- **Drag and drop**: Drag and drop highlights targets, auto-scrolls the list, supports Ctrl-drag duplication, and uploads system files onto folders, breadcrumbs, favourites and drives (frontend).
- **Split view**: Split view has a narrower divider drag area, per-pane list/grid and icon size, focus outline, and remembered split (frontend).
- **Tabs**: New tabs and new split panes inherit the view they were opened from, and middle-clicking a drive, favourite, breadcrumb or toolbar Back/Forward/Up opens the target in a new tab (frontend).
- **Tab strip**: Tabs use a Firefox-style floating rounded box. Every closable tab shows a close button when there is room; when the strip is crowded, inactive tabs keep the folder icon and the active tab swaps the icon for close (frontend).
- **Tab icons**: A tab opened at a volume root shows that volume’s icon instead of the folder icon (frontend).
- **Covers**: The player loads each queue item’s embedded cover from the shared thumbnail cache at thumbnail size instead of decoding the full-size artwork, and hides covers when content previews are disabled (frontend).
- **Compact layout**: The explorer toolbar and file list switch to a compact layout based on pane width, and a narrow toolbar stacks the navigation buttons above a full-width address bar (frontend).
- **Sort inheritance**: A folder without its own sort or grouping setting follows the nearest ancestor that has one, then the default (frontend).
- **View presets**: The View menu has By Name / By Modified / By Size / By Type / By Date shortcuts that set sort + grouping in one click and reverse on a second click; they also apply to subfolders through inheritance (frontend).
- **Shortcuts**: Keyboard shortcuts are listed in a live menu (`?`), with additional shortcuts for tabs, sidebar, menu and app windows (frontend).
- **Favourites**: Sidebar favourites use a starred folder icon, and the toolbar star toggle sits next to Refresh (frontend).
- **Favourites menu**: Right-clicking the toolbar star lists every starred folder and opens the one you pick (frontend).
- **Clear local data**: The Clear Local Data dialog lists each kind of local data with its own checkbox, all selected by default, so only the ticked ones are cleared (frontend).
- **Gallery background**: The Endless Gallery transparency checkerboard follows the theme, using light greys in light mode, and its navigation arrows keep dark buttons in every theme so they stay visible (frontend).
- **Gallery keyboard**: In the End of gallery overlay, the arrow keys move focus between its buttons instead of only Tab; Home and End jump to the first and last item, and clicking the zoom percentage resets the zoom (frontend).
- **New file and folder**: Create File and Create Folder focus the name and select the suggested text so it can be replaced immediately (frontend).

### Features

- **Settings shortcut**: Ctrl+, opens Settings and closes it again, and the global menu shows the shortcut next to the Settings entry (frontend).
- **Interface language**: The frontend is now translatable. On a first visit the language is detected from the browser and saved in the server settings; Appearance has a Language selector. English is the base language, Simplified Chinese builds on it (untranslated entries fall back to English), and a language file is only downloaded when that language is in use (frontend).
- **Gallery delete**: The Endless Gallery can delete the current file with Del or the new button under Locate. After confirming, it shows the next item when you were browsing forward and the previous one when you were browsing back, and deleting the last item leaves the empty state (frontend).
- **Last opened media**: Turning Remember last opened media off keeps the remembered file per folder instead of clearing it; dropping it is explicit, from the explorer's clear button or Clear local data (frontend).
- **App windows**: The Single app instance setting is gone; opening an app again reuses its window when the app list marks that app `singleInstance` (frontend).
- **Thumbnails**: Moving, renaming or copying a file or folder reuses its cached thumbnails, including a folder's contents, and deleting it drops them instead of leaving them to be evicted (frontend).
- **Optical media**: ISO 9660 and UDF mounts, and Windows CD-ROM drives, show up as their own volumes with a disc icon. Content previews stay off on them, thumbnail requests are refused, and directory listings use a lower stat concurrency (frontend, backend).
- **Previews**: Turning off Disable Preview leaves the thumbnail cache in place, and Image Cache stays in the menu so it can still be cleared on its own (frontend).
- **Auth**: The login token is kept in an HttpOnly cookie, so page scripts can no longer read it, the WebSocket URL no longer carries it, and logout clears it on the server (frontend, backend).
- **IP Chooser**: The IP chooser opens from the main menu in a new page, so the file manager stays on its current folder. It loads its address list and QR code through an authenticated API call, so the QR code always carries a freshly issued login ticket instead of one encoded in the URL (frontend, backend).
- **Leave guard**: While an upload or an in-page download is still running, refreshing, closing, or leaving for another page asks you to stay. Server tasks no longer trigger it: they keep running on the server and come back in the transfers panel after a reload (frontend).
- **Plugins**: Plugins can be dropped into the server plugins folder, appear in the main menu, open in windows, and can read/write files and list directories (frontend, backend).
- **Plugin names**: A plugin folder or HTML file can use any name. Names starting with `.` and other file types in the plugins folder are still ignored (backend).
- **Tabs**: The explorer has built-in tabs that remember folder, selection, filter and scroll, can be reordered, split, merged, and moved between panes (frontend).
- **Branch and grouping**: Branch view (Ctrl+B) flattens subdirectories for batch actions, and folders can be grouped by name, type, size or date in list and grid views (frontend, backend).
- **Background tasks**: Copy, move, delete and duplicate run as background tasks visible in every open window, with conflict handling, retry of failed items, and in-place listing refreshes (frontend, backend).
- **Clipboard menu**: The two clipboard entries are named Copy Path and Paste from Clipboard, Paste from Clipboard has Ctrl+Shift+V, and right-clicking a folder pastes the cut or copied items into that folder (frontend).
- **View shortcut**: Ctrl+1 and Ctrl+2 switch the explorer to list and grid view, and the View menu shows both (frontend).
- **Text files**: `.jsonc` files open in the text editor like the other plain-text formats (frontend).
- **7-Zip**: When 7-Zip is installed, the file menu can compress into a format 7-Zip can create and extract into the current folder or a folder named after the archive. The name field shows the suggested name without the format extension; several files use the current folder name plus a timestamp. Compress separately writes one archive per selected item with an optional prefix, and opening a supported file with no app (including xlsx) asks where to extract (frontend, backend).
- **Conflicts**: Uploads with existing names ask to replace, skip or keep both, and failed copy/move/delete reports list exactly which items failed (frontend, backend).
- **Properties**: The Properties window shows icon, name, type, path, size, contained files, and created/modified dates, counting folder sizes in the background (frontend, backend).
- **Multi-select properties**: Selecting several items opens one aggregated Properties window with the combined size, file and folder counts, common location and modified/created date range, measuring the selected folders in the background one by one (frontend).
- **Access config**: `allowedRoots` restricts the file manager to listed folders; `startPath` is removed; `logLevel` replaces `enableLog` (backend).
- **Storage sidebar**: Linux sidebar shows only real storage with free/total space, and network locations, WSL distributions, mapped drives and locked BitLocker volumes appear with appropriate icons (backend, frontend).
- **Network paths**: Network paths in the address bar browse correctly, with clear errors for unreachable locations and host-only paths (frontend, backend).
- **Backend controls**: Self-update, stop and restart backend actions are available only when `allowSelfUpdate` is set (frontend, backend).
- **Open File picker**: The Open File picker is a modal window (mask, Esc, focus trap), remembers folder and window size, and is selection-only (frontend).
- **Docs**: The README and the top-level configuration guides are available in Chinese as well as English.
- **README**: The README is shorter for new users: about 10MB, a Windows double-click install, and every document listed once at the bottom.
- **Plugins**: Plugin pages are served cross-origin isolated, so a plugin can use WebAssembly threads (SharedArrayBuffer) (frontend, backend).
- **Uploads**: A file is written straight to its destination, so a large upload no longer needs the same amount of free space a second time in a temporary folder and finishes sooner (frontend, backend).
- **Upload conflicts**: The "file already exists" question is answered with one request for the whole batch instead of one per file, so the dialog appears immediately even for a large selection (frontend, backend).
- **Startup**: Server-side settings are read in one request instead of one per key, and a setting is no longer written back when nothing actually changed (frontend).
- **Fallback**: A browser that cannot run the app, or one with JavaScript turned off, is now given a link to the classic `/ie` interface instead of a dead-end message (frontend).
- **Classic UI**: The `/ie` HTML interface, laid out and styled like a Windows 95 window with a favourites/drives sidebar, gives old browsers such as IE8 sign-in (a password or a login ticket picked in the same form), folder browsing and download (backend).
- **Classic UI files**: The same interface can upload files, create a folder, rename and delete; deleting opens its own confirmation page first (backend).
- **Classic UI opening**: In the `/ie` interface a file name opens the file inline in a new window instead of saving it, and every file row has its own Download link in the actions column (backend).
- **Classic UI folder download**: In the `/ie` interface the Download action also works on a folder, saving it as `<folder>.zip` (backend).
- **Classic UI rows**: In the `/ie` list, the row under the pointer is highlighted (backend).
- **Hidden files**: Hidden files are shown by default in both the app and the classic interface (frontend).
- **Text editor status bar**: A bar under the text shows the cursor position, the line count, the line ending (Windows (CRLF) / Unix (LF) / Macintosh (CR)) and the file's encoding (frontend).
- **Auto subtitles**: A video shows the subtitle file sitting next to it — `movie.srt` or a language-tagged `movie.chs.srt` (`.srt`, `.ass`, `.vtt` or `.ssa`) — by itself, in the video player and in the media player, with either playback backend, and the native control bar can turn it off (frontend).
- **Lyrics files**: A track with no lyrics in its tags loads a same-named `.lrc` or `.vtt` next to it, including a language-tagged name like `song.zh.lrc` (frontend).

### Fixes

- **Malformed images**: An image whose header declares an enormous size no longer takes the server down; the size guard cannot overflow and a decoder panic is reported as a failed thumbnail instead of ending the process (backend).
- **Login tickets**: A ticket link is single-use now — redeeming it a second time within its two minutes no longer issues another session — and ticket links are rate limited per IP (backend).
- **CSRF**: Only the explicit `FILE_LITE_DEV_MODE=true` enables development mode, so an unrelated `NODE_ENV=development` in the environment no longer turns the CSRF check off for cookie-authenticated writes (backend).
- **Named pipes**: Copying a folder or downloading it as a zip skips named pipes and other non-regular files instead of hanging the operation forever, and a linked directory is no longer packed into the archive (backend).
- **WebSocket limit**: The per-IP WebSocket connection limit counts the real client address, so a client-supplied forwarding header can no longer raise it (backend).
- **Date groups**: The “Earlier this week”, “Earlier this month” and “Earlier this year” groups have their own labels instead of repeating “Last week”, “Last month” and “Last year” (frontend).
- **File Viewer**: The viewer script is loaded from a pinned version of the CDN package instead of `@latest`, so an upstream publish cannot change the code running in the app (frontend).
- **Upload speed**: An uploading row shows the real transfer speed instead of a fixed 0 B/s (frontend).
- **Text encoding**: A text file that is not UTF-8 — a GBK subtitle, a UTF-16 note — no longer opens as mojibake in the text editor, the browser view or a subtitle loaded from the server, and editing it keeps the encoding and the line endings it came with; the server detects the encoding and sends the text as UTF-8, while downloads and media streams keep their original bytes (frontend, backend).
- **Local subtitles**: A subtitle picked from this device is decoded with its detected encoding, so a local GBK .srt no longer shows as mojibake (frontend).
- **Context menus**: A menu or submenu whose entries add up to a fraction of a pixel more than its box no longer draws a scrollbar that cannot scroll, which showed up on 175% and 200% display scaling (fixed in vgo-ui 0.4.4).
- **Compressing**: A compress or extract task shows its percentage instead of a byte count, which read "100 B" once it finished (frontend, backend).
- **Lyrics**: Music metadata and lyrics load again in Simplified Chinese and Japanese, where a translated HTTP header name made every range request fail (frontend).
- **Classic interface**: A long file name is clipped with an ellipsis instead of widening the name column and stretching the table (backend).
- **Text Sync**: A channel's text now survives reopening the app, reconnecting, and the last client leaving or reloading the page — it stays in server memory until the process restarts. Joining a channel you are already in is also a no-op now, instead of leaving and re-entering it (backend).
- **Shortcuts and dialogs**: While a confirmation dialog or a context menu is open, the page behind it no longer reacts to keyboard shortcuts such as the arrow keys or Delete — the dialog keeps the keyboard (frontend).
- **Breadcrumb menu**: When the subfolder dropdown is long enough to scroll, it now scrolls instantly to the highlighted current folder instead of leaving it out of view (frontend).
- **Folder previews**: A folder's thumbnail preview updates when files are added, deleted, renamed or moved inside it, instead of showing the old contents until the page is reloaded (frontend).
- **Text editor**: Opening a file focuses the editor. Esc, the window close button, a double-click on the title icon, and Exit all ask before closing when the file has unsaved changes (frontend).
- **App focus**: Closing an app with Esc returns focus to the file item that was focused when the app opened (frontend).
- **Finished tasks**: Clearing a completed task that was already removed no longer returns 404, and the row leaves the list without a refresh (frontend, backend).
- **Task progress**: A finished task with no progress tick, such as a quick delete, shows 100% next to Done (frontend).
- **Multi-select properties**: The aggregated Properties window no longer stays on “Measuring folders… 0 / N” after a folder has already been counted (frontend).
- **Folder open**: Double-clicking a folder name while that folder is still opening no longer appends the name again and requests a missing path (frontend).
- **Zip dates**: Downloaded zip archives keep each file’s modification time, so entries no longer appear without a date (backend).
- **Sandboxed previews**: Streamed HTML and SVG files are sandboxed into a unique origin and sent with `nosniff`, so opening one can no longer run script on the app’s origin (frontend, backend).
- **Command injection**: On Windows, the “reveal in host explorer” fallback opens the folder through the shell API instead of `cmd`, so a crafted folder name cannot execute a command (backend).
- **Config permissions**: `config.json` is written owner-only, and an existing file is tightened on startup (backend).
- **Archive password**: Extracting an encrypted archive without a password reports that a password is required, instead of the 7-Zip copyright line (backend).
- **Plugin files** cache: Plugin files revalidate on every request, so an edited page or script is picked up the next time the plugin opens, and an unchanged file is not downloaded again (backend).
- **Locate in folder**: Locating a file from the gallery or playlist opens it in the focused tab and leaves the other tabs on their own paths (frontend).
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
- **Top bar**: The tab strip uses the dark surface colour in dark mode (frontend).
- **Classic UI navigation**: In the `/ie` interface the Up button climbs to the allowed root instead of stopping at the first listed location, and a favourite or drive is highlighted when it is the folder currently open (backend).
- **Classic UI actions**: In the `/ie` list the row actions (Download / Rename / Delete) are spaced apart instead of running together (backend).

### Engineering

- **Docs screenshots**: `docs:screenshots` captures the transfers shot again — the generator matched the upload button by an old title that no longer ends in three dots, so that shot timed out and the README kept a stale image (frontend).
- **CI**: A `CI` workflow runs `go vet` and the Go tests, plus lint, type check and the unit tests on the frontend, so a failing suite is visible on a pull request instead of only in a release build (frontend, backend).
- **Unit tests**: `bun test` installs the auto-imported `$t` through a preload, so a module that uses UI copy can be unit tested instead of failing with `$t is not defined` (frontend).
- **UPX**: Release builds compress Linux and Windows amd64 binaries with UPX before packing the zip, so those downloads are smaller. macOS and Windows ARM64 builds stay unpacked (backend).
- **FS facade**: File reads and writes now go through one shared facade (`utils/fs`), so apps no longer import the file manager's internals or call the file API directly (frontend).
- **Facade enforcement**: Only that facade may call the file API directly: an eslint rule rejects `fsWebApi` anywhere else, because a missed call site only shows up as an empty preview (frontend).
- **Shared path rules**: The canonical path rules moved out of the file manager into the shared layer, because both the explorer and the storage facade need them (frontend).
- **E2E project**: A Playwright end-to-end sub-project (`e2e/`) drives the built app in a real browser and runs the conflict, progress, cancel and retry flows; its method and cases live in `e2e/README.md`.
- **Docs screenshots**: The README's feature screenshots are generated from a demonstration library by `cd e2e && bun run docs:screenshots`, so they follow the UI instead of being retaken by hand; the sample media is downloaded once into a gitignored cache.
- **E2E polling**: Waiting for an asynchronous result in the E2E suite no longer fails spuriously: `expect.poll` gives up as soon as its callback throws, so those checks read through a helper that returns null instead.
- **Windows E2E runner**: The E2E runner works on Windows again: it used to spawn Playwright's `.bin` shim, which Windows refuses to execute when it is a `.cmd` (and Bun installs an `.exe`), so the suite died with `spawn EINVAL` before running a single test; it now runs Playwright's `cli.js` through `node` on every platform (engineering).
- **Node version check**: The frontend build stops immediately with a message naming the required Node range when the running Node is too old, instead of failing deep inside rolldown with `ERR_INVALID_ARG_VALUE` (frontend).
- **API contract**: The HTTP API is REST-shaped (`/api/session`, `/api/fs/*`, `/api/tasks`, `/api/settings`), every failure carries a stable error `code`, and the WebSocket only pushes (plus the text-sync channel); the contract lives in `docs/design/api.md`, and the two halves always ship together (frontend, backend).
- **Dev server**: The Vite dev server proxies `/ie` and `/ip` to the backend, so the server-rendered classic interface can be opened while developing instead of being answered with the SPA shell (frontend).

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

