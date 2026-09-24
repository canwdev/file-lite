# Plugins

Static pages in the data directory's `plugins/` folder. The host scans that directory, serves the files, injects the SDK into the entry HTML, and reads and writes files for the plugin over `postMessage`.

## Scan and URLs

- Only `{DATA_BASE_DIR}/plugins` is scanned. The result is reused until the plugins directory, a plugin directory, or a `manifest.json` changes. Nothing watches the directory. The page requests `GET /api/plugins` once on load; Refresh in the Plugins submenu requests it again.
- Served files use `Cache-Control: private, max-age=0, must-revalidate` and an ETag from the file's size and modification time. Entry HTML also includes the SDK injection revision. Unchanged files answer 304.
- A folder (with `index.html` or `manifest.json`) is served at `/plugins/{id}/...`.
- A single `.html` file is not wrapped in an id: `/plugins/hello.html`. When a folder and a file share a name, the folder wins.
- An id must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Anything that does not match, or that starts with `.`, is skipped.

## Contract

Do not lift the existing app interfaces into the SDK. The SDK only exposes host-window capabilities: read and write files, list a directory, close the window, and change the title. The text editor, players, and gallery stay in the host. When a window capability is missing, add that one capability. Do not mirror a built-in app's interface into the SDK.

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

| Method | Returns | Role |
| --- | --- | --- |
| `readFile(path)` | `Promise<ArrayBuffer>` | Read `path`. Rejects on failure |
| `writeFile(path, data)` | `Promise<void>` | Overwrite `path`. `data` is an `ArrayBuffer`, `Uint8Array`, or `Blob`. Rejects on failure |
| `list(path)` | `Promise<object[]>` | List one level of `path`, not recursively. Rejects on failure. Each item is `{ name, path, ext, isDirectory, size, lastModified }`. `path` is that item's full path; `size` is `null` for a directory; `lastModified` is a timestamp in milliseconds |
| `onOpen(callback)` |  | Called when a new window starts. The argument is `{ path, filename }` when a file was opened, otherwise `undefined`. Called again when a `singleInstance: true` window is opened again |
| `exit()` | `Promise<void>` | Close the current window |
| `setTitle(title)` | `Promise<void>` | Change the host window title, not `document.title` |

`path` is the file's full path. `filename` is the file name. Read and write use the same scope as the file manager. Do not destructure `undefined`.

`window.close` is `fileLiteSDK.exit()`. There is no unload API in the other direction: closing the window removes the iframe.

There is no API to create a directory, pick a file, write a save-as back, or talk to another plugin.

```html
<script>
fileLiteSDK.onOpen(function (file) {
  if (!file)
    return
  var { path, filename } = file
  fileLiteSDK.readFile(path)
})
</script>
```
