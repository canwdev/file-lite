# Plugins

Static pages in the data directory's `plugins/` folder. The host scans that directory, serves the files, injects the SDK into the entry HTML, and reads and writes files for the plugin over `postMessage`.

## Scan and URLs

- Only `{DATA_BASE_DIR}/plugins` is scanned. The result is reused until the plugins directory, a plugin directory, or a `manifest.json` changes. Nothing watches the directory. The page requests `GET /api/plugins` once on load; Refresh in the Plugins submenu requests it again.
- Served files use `Cache-Control: private, max-age=0, must-revalidate` and an ETag from the file's size and modification time. Entry HTML also includes the SDK injection revision. Unchanged files answer 304.
- A folder (with `index.html` or `manifest.json`) is served at `/plugins/{id}/...`.
- A single `.html` file is not wrapped in an id: `/plugins/hello.html`. When a folder and a file share a name, the folder wins.
- A name can contain any characters. Entries whose names start with `.` are skipped. Only a folder or a single `.html` file becomes a plugin; other files in the plugins root are ignored. The folder or file name is percent-encoded in its URL.

## Contract

The SDK is the single host API for both plugins and built-in apps. A plugin gets it as `window.fileLiteSDK` through `postMessage`; a built-in app gets the same object from `useFileLiteSdk()` in the host. When a capability is missing, add it to the SDK once for both transports; never implement it for one transport only.

Host UI is not a capability: dialogs, i18n, the theme, the router, stores and keyboard shortcuts stay in the host. Built-in apps keep their implementation private; the SDK describes window and file capabilities, not a particular app's interface.

## Development

The entry HTML does not inject the script itself. PluginHost inserts `<script src="/plugin-sdk.js"></script>` before `</head>`, or before `</body>` when there is no `<head>`.
A nested page that needs the SDK must reference that script itself. A plugin talks to the host through `window.fileLiteSDK` and must not call `postMessage` directly.

The directory defaults to `file-lite/plugins` under the process working directory.

- A single file `plugins/hello.html` has no manifest. Its menu name is `hello`, `openWith` is empty, and `singleInstance` is `false`.
- A folder `plugins/jspaint/index.html` may include `manifest.json`. Scripts, styles, and images use paths relative to that plugin directory. A single file's relative paths resolve from the `plugins/` root.

```json
{
  "name": "JS Paint",
  "entry": "index.html",
  "icon": "🎨",
  "openWith": [".png", ".jpg"],
  "singleInstance": false,
  "version": "1.0.0"
}
```

- `name`: menu label and window title. Defaults to the folder name.
- `icon`: an emoji, or a path to an image inside the plugin. Defaults to the puzzle icon. Icon-library names are not accepted.
- `entry`: the entry page, relative to the plugin folder. Defaults to `index.html`.
- `openWith`: extensions including the dot. When non-empty, the plugin appears in Open With and Set Default App, and `onOpen` receives that file. When empty, it can only be started from the Plugins menu, and the `onOpen` argument is `undefined`.
- `singleInstance`: defaults to `false`. Each open creates a new window and calls `onOpen` once. `true` reuses the existing window and calls `onOpen` again on the next open.
- `version`: shown on the right of that Plugins menu item only. It is not used for loading or compatibility. Omitted versions are not shown.

### SDK

Register it synchronously in the page script. The host pushes `onOpen` after the iframe `load` event. A callback registered after that push does not receive it.

The whole surface is one object. Nothing is optional: a method that exists always answers, and a failure always rejects.

```ts
interface FileLiteSdk {
  readonly version: 2

  list(path: string): Promise<SdkEntry[]>
  readFile(path: string): Promise<ArrayBuffer>
  readText(path: string): Promise<{ text: string, charset: string }>
  writeFile(path: string, data: BlobPart, options?: SdkWriteOptions): Promise<SdkWriteResult>
  pick(options?: SdkPickOptions): Promise<SdkPickResult | null>
  url(path: string): string
  stream(path: string, options?: { signal?: AbortSignal }): Promise<Response>

  getLaunch(): Promise<SdkLaunch | null>
  onOpen(callback: (launch: SdkOpenEvent | undefined) => void): void
  updateLaunch(launch: Partial<SdkLaunch>): Promise<void>
  setTitle(title: string): Promise<void>
  selectItems(names: string[]): Promise<void>
  revealItem(name: string): Promise<void>
  exit(): Promise<void>
}

interface SdkEntry {
  name: string
  /** Full path of the entry. */
  path: string
  ext: string
  isDirectory: boolean
  isLink?: boolean
  hidden?: boolean
  /** `null` for a directory. */
  size: number | null
  /** Milliseconds. */
  lastModified: number
  /** Milliseconds. */
  birthtime?: number
}

interface SdkLaunch {
  /** Full path of the opened file, `''` when the window has none. */
  path: string
  /** Base name of `path`, `''` when the window has none. */
  filename: string
  /** Directory used by `selectItems` / `revealItem`. */
  directory: string
  /** The directory listing captured when the window opened. */
  entries: SdkEntry[]
}

interface SdkOpenEvent {
  path: string
  filename: string
  directory: string
}

interface SdkWriteOptions {
  /** Default `overwrite`. */
  conflict?: 'error' | 'overwrite' | 'keep-both' | 'skip'
  /** Encoding to write back, from `readText`. Omitted means UTF-8. */
  charset?: string
}

interface SdkWriteResult {
  /** Where the bytes landed; `keep-both` may rename the file. */
  path: string
  name: string
}

interface SdkPickOptions {
  /** Default `file`. */
  mode?: 'file' | 'files' | 'folder' | 'save'
  /** Dialog title; the host picks a sensible default. */
  title?: string
  /** Extensions including the dot, e.g. `['.txt', '.md']`. File modes only. */
  extensions?: string[]
  /** Suggested file name for `save`. */
  defaultName?: string
  /** Folder the dialog opens at; defaults to the launch directory. */
  startPath?: string
}

interface SdkPickResult {
  /** Chosen files (`file` / `files`); empty for `folder` and `save`. */
  items: SdkEntry[]
  /** The folder the dialog was in when it was accepted. */
  directory: string
  /** `save`: the path to write. `file`: the chosen file. `folder`: the folder. `files`: ''. */
  path: string
  /** Last segment of `path`; for `save` the name that was typed. */
  name: string
}
```

### list(path)

Lists one level of `path`, not recursively. Each item is an `SdkEntry` whose `path` is already the full path, so a caller never joins names by hand.

### readFile(path)

Reads the raw bytes as an `ArrayBuffer`. Use it for images, archives and any binary format.

### readText(path)

Reads a text file. The returned `text` is always UTF-8, and `charset` is the encoding the file actually has on disk (`''` when the server did not treat it as text). Pass that `charset` back to `writeFile` and the file keeps its encoding after an edit.

### writeFile(path, data, options?)

Writes `data` — an `ArrayBuffer`, a typed array or a `Blob`; a plain string is rejected, because a string has no encoding — to `path` and resolves with where it landed. A missing path is rejected before anything is written. `options.conflict` decides what happens when the file already exists; the default `overwrite` is what a save means. Without `options.charset` the bytes are stored as UTF-8.

### pick(options?)

Opens the file manager's own picker dialog and resolves with what the user chose, or `null` when it is cancelled. This is the only way a plugin asks for a file or a save target: the host owns the dialog, so it is the same picker the built-in apps use, and it is not limited by the plugin window's size.

- `file` — one existing file; `items` has it, and `path`/`name` point at it.
- `files` — one or more files; read `items`.
- `folder` — one folder; `path` is the folder.
- `save` — a folder plus a typed file name; `path` is the file to write.

`extensions` filters what can be picked (dots included). Each request is independent: omitting `extensions` or passing an empty list leaves the picker unfiltered, without reusing the extension filter of an earlier `pick`. `startPath` sets the folder the dialog opens at, `defaultName` pre-fills the name in `save` mode. Nothing is written by `pick` itself: a `save` result is a path, and the plugin still calls `writeFile`.

```js
fileLiteSDK.pick({ mode: 'save', defaultName: 'note.txt', extensions: ['.txt'] }).then(function (target) {
  if (!target)
    return // cancelled
  return fileLiteSDK.writeFile(target.path, new Blob([text]), { conflict: 'overwrite' })
})
```

### url(path)

Builds the stream URL synchronously, for `src` and `href`. It needs no round trip to the host, so it can be used while rendering. The URL supports `Range` requests, so an `<audio>`/`<video>` element streams and seeks without reading the file first.

### stream(path, options?)

`fetch`es that same stream URL and resolves with the `Response`, so the body can be read in chunks:

```js
const response = await fileLiteSDK.stream(path)
const reader = response.body.getReader()
```

It runs in the page (a `ReadableStream` cannot be sent through `postMessage`), so it costs no host round trip; the request carries the page's session. Use it for large files — a log, an archive, a media file — instead of `readFile`, which materialises the whole file in memory.

### getLaunch()

Returns the current launch, or `null` when the window was opened without a file. `entries` is the directory listing the file manager had when the window opened; ask for it only when the listing is needed, because it can be large.

### onOpen(callback)

Called when the window starts, and again every time a `singleInstance: true` window is reused for another file. The argument is an `SdkOpenEvent`, or `undefined` when the window has no file. Register it synchronously in the page script: the host pushes the launch right after the iframe `load` event, and a callback registered later does not receive that first push. The push carries the target only; call `getLaunch()` for the listing.

### updateLaunch(launch)

Merges a partial launch into the window state (for example after navigating inside your page) and updates the host window. It does not call `onOpen` again, so a plugin that publishes its own navigation cannot loop.

### setTitle(title)

Sets the host window title. `document.title` is not the window title.

### selectItems(names) / revealItem(name)

Act on the launch's `directory`: select those names in the file manager, or reveal one of them. Scrolling, focus and the surrounding UI belong to the host.

### exit()

Closes the current window. `window.close` is the same call: the host overrides it because closing an iframe is not something a page can do by itself. There is no unload API in the other direction — closing the window removes the iframe.

`path` is always the file's full path, and read, write and explorer actions use the same scope as the file manager. Do not destructure a possibly `undefined` callback argument.

There is no API to create a directory, rename or delete, or talk to another plugin; `pick` only returns paths.

### Example

```html
<script>
fileLiteSDK.onOpen(function (file) {
  if (!file)
    return
  var path = file.path
  fileLiteSDK.readText(path).then(function (result) {
    // result.text is UTF-8; result.charset is the encoding on disk
    editor.value = result.text
    return fileLiteSDK.writeFile(path, new Blob([result.text]), {
      conflict: 'overwrite',
      charset: result.charset,
    })
  })
})
</script>
```

Read `readText` and write with its `charset` whenever the plugin edits text: the server converts the file to UTF-8 for the page and encodes it back on write, so a GB18030 or Shift-JIS document stays in its own encoding.
