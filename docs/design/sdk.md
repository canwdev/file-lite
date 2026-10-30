# FileLite SDK

The one host-facing API for plugins (an iframe, reached over `postMessage`) and built-in apps (Vue components in the host window, reached in process). The plugin side is documented in [plugins.md](./plugins.md); this page describes the code split and the rules for adding a capability.

## Layers

```
built-in app ──useFileLiteSdk()──┐
                                 ├── broker ── fs facade / window manager / explorer bus
plugin iframe ──postMessage──────┘
```

| Layer | File | Responsibility |
| --- | --- | --- |
| Contract | `frontend/src/sdk/contract.ts` | `SDK_VERSION`, source tags, method names, SDK types, wire message shapes. No Vue or DOM imports. |
| Broker | `frontend/src/sdk/broker.ts` | Implements every method over `SdkHostContext` and the `fs` facade. The file API is injected, so tests and future backends can pass a fake. |
| iframe transport (host) | `frontend/src/sdk/iframe-bridge.ts` | Origin/source checks, request-id correlation, transfer lists, the wire message shapes. |
| iframe transport (client) | `frontend/public/plugin-sdk.js` | Standalone page script exposed as `window.fileLiteSDK`. It cannot import the contract, so `frontend/src/sdk/compat.test.ts` runs it against the contract. |
| In-process transport | `frontend/src/sdk/use-app-sdk.ts` | Creates the same SDK object for a window, pushes `onOpen`, and replays the last push to a late subscriber. |
| App provider | `frontend/src/views/Apps/AppSdkProvider.vue` | Per-window `provide()` of the SDK; translates launch state to/from the window manager. |
| Registry | `frontend/src/views/Apps/registry.ts` | One descriptor for a built-in app or plugin: id, name, icon, single-instance, chrome, component. Open With, Set Default App and window reuse read it. |
| Picker | `frontend/src/views/FileManager/file-picker.ts`, `FilePickerHost.vue` | The one file/folder/save dialog, mounted once by `FileLite.vue`. `pick()` in the broker calls `openFilePicker`; built-in apps and plugin iframes both end up here. |

## Rules

- A capability is implemented once, in the broker. Never add a method to only one transport.
- The contract stays plain TypeScript and DOM-free; Vue state lives in the transports and the provider.
- `SDK_VERSION` increases when a method or signature is removed or changed. Adding a method or an optional field is additive; old clients ignore it.
- `frontend/public/plugin-sdk.js` is a page script, not a module: keep it ES5-compatible and keep its strings in sync with `contract.ts` (`compat.test.ts` guards the duplication).
- `window.fileLiteSDK` is the plugin entry object and `onOpen` always passes one `{ path, filename, directory }` object. There is no compatibility branch for older callback shapes; a plugin that declares `(path, filename)` receives the object and `undefined`, which is why the bundle was updated in the same release.
- Host UI (dialogs, i18n, theme, router, stores, shortcuts) is not a capability. Do not expose it through the SDK. A file *picker* is an exception only because picking a path is a file capability: `pick()` returns a path, it does not return a dialog.
- `url()` and `stream()` are the two client-side methods: they build the same stream URL and fetch it from the page. A `ReadableStream` cannot cross `postMessage`, and fetching the URL directly is what makes `Range` requests (media seeking, chunked reads) work.
- Built-in apps are `defineAsyncComponent`, so the first time one opens its chunk loads after the window has already pushed its launch. The in-process transport therefore keeps the last push and replays it to a callback that subscribes late; the iframe transport does not (a plugin page loads the client before `load`), and its documented rule is "register `onOpen` synchronously".
- New capabilities are file/window operations, not one app's interface. For example, the gallery's folder navigation is `updateLaunch`, and its selection actions are `selectItems` / `revealItem`.
- The SDK does not manage tasks, upload queues or archives. Those stay in the host; the SDK only reads and writes bytes the file manager can already reach.

## Compatibility boundary

Plugin pages always load `plugin-sdk.js` from the host, so the client is replaced along with the host: a plugin only depends on the object it receives, not on a version it ships. That is why the SDK can change shape in one release (1.6.0) instead of carrying a compatibility branch.

What stays fixed is the wire security model and the error contract:

- same origin, the `file-lite-plugin` / `file-lite-host` source tags, and request ids;
- failures reject with the server's reason, and `writeFile` overwrites by default;
- `window.close` remains `fileLiteSDK.exit()`.

Built-in apps are not plugins: they receive the same object in process and no longer rely on the old prop-and-emit contract.
