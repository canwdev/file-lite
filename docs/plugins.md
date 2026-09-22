# 插件

把一个网页放进数据目录的 `plugins/`，全局菜单的 Plugins 里就能打开它，任意网页都可以。开发插件见 [开发者须知](https://github.com/canwdev/file-lite/docs/design/plugins.md#开发者须知)。

## 下载预制插件

仓库里已经适配好插件的 zip 包在 [plugins-repo](https://github.com/canwdev/file-lite/plugins-repo)，需要自己下载。

1. 打开上面的目录，下载 zip。目前有 `jspaint.zip`。
2. 解压到数据目录的 `plugins/`。解压后应是 `plugins/jspaint/index.html`。
3. 刷新生效。

## 插件形态

两种形态：

- 单个网页：`plugins/hello.html`，地址是 `/plugins/hello.html`。
- 一个文件夹：`plugins/jspaint/index.html`，地址是 `/plugins/jspaint/index.html`。同名时文件夹优先于单文件。

可选的 `manifest.json` 放在文件夹里：

```json
{
  "name": "JS Paint",
  "entry": "index.html",
  "icon": "🎨",
  "openWith": [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]
}
```

- `name`：菜单和窗口上的名字。不写就用文件夹名或文件名。
- `icon`：一个 emoji，或插件里的图片相对路径（如 `icon.png`）。不写就用默认拼图图标。
- `entry`：入口网页，相对插件文件夹。不写就是 `index.html`。
- `openWith`：可以用这个插件打开的扩展名。留空或不写，就只能从 Plugins 菜单单独启动。
