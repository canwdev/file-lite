# 插件

插件是数据目录 `plugins/` 里的静态网页。宿主扫描目录、提供文件、在入口 HTML 注入 SDK，并用 `postMessage` 替它读写资源管理器里的文件。

## 扫描与地址

- 只扫 `{DATA_BASE_DIR}/plugins`。每次 `GET /api/plugins` 现扫，不监视目录。页面加载时请求一次，之后用这份列表；Plugins 子菜单里的 Refresh 再请求一次。
- 文件夹插件（有 `index.html` 或 `manifest.json`）的地址是 `/plugins/{id}/...`。
- 单文件 `.html` 不套一层 id：`/plugins/hello.html`。同名时文件夹优先。
- `manifest.json` 可选。`openWith` 为空则只能从 Plugins 菜单启动。

## 开发者须知

- 页面里的脚本、样式、图片用相对路径。
- 宿主会在入口网页里注入 `/plugin-sdk.js`，页面上有 `window.fileLiteSDK`：
  - `readFile(path)` 读资源管理器里的一个文件，得到 `ArrayBuffer`
  - `writeFile(path, data)` 写回该路径（覆盖）
  - `onOpen(callback)` 从「打开方式」启动时收到 `path` 和文件名；从菜单单独启动不会调用
  - `exit()` 关掉自己的窗口。`window.close()` 也是这一件事
  - `setTitle(title)` 改窗口标题

## SDK

入口 HTML 在 `</head>` 前插入 `<script src="/plugin-sdk.js"></script>`。其它资源不注入。已经引用过 `plugin-sdk.js` 的页面不再插。

`window.fileLiteSDK`：

| 方法 | 作用 |
| --- | --- |
| `readFile(path)` | `ArrayBuffer` |
| `writeFile(path, data)` | 覆盖写入。`data` 为 `ArrayBuffer`、`Uint8Array` 或 `Blob` |
| `onOpen(cb)` | 宿主推 `{ event: "open", path, name }`。菜单单独启动不推 |
| `exit()` | 请宿主关掉这个窗口 |
| `setTitle(title)` | 窗口标题 |

消息只有 `postMessage`，且只接受来自该 iframe 的调用。读写转到现有文件 API，范围仍是 `allowedRoots`。

`window.close` 被设成 `fileLiteSDK.exit()`。没有宿主强制卸载插件的反向接口：关掉窗口就是拆掉 iframe。


## 契约

不建议把现有 App 接口抽进 SDK。

SDK 只表示宿主窗口能力：读写文件、关窗、改标题。文本编辑、播放器、画廊绑的是资源管理器自己的列表、缩略图和快捷键，留在宿主里。缺了一种窗口能力再加一条，不要把内置 App 的接口镜像进来。