# 缩略图与预览架构

文件列表里的图片缩略图、音频封面和视频封面共用同一条管线：**后端按需生成、浏览器负责缓存、后端不落盘**。

服务端唯一的缓存是进程内、按字节上限的 LRU，重启即空；真正长期存在的缓存是浏览器的 IndexedDB。这样没有磁盘写入、没有缓存失效清理，只读挂载也能跑。

## 接口

```
GET /api/files/thumbnail?path=<绝对路径>&size=<边长>&kind=<image|video>
```

挂在 `/api/files` 之下，走与其他文件操作相同的鉴权（Cookie 或 `Authorization`）。

| 参数 | 说明 |
| --- | --- |
| `path` | 必填，必须是 `safeBaseDir` 之内的文件 |
| `size` | 目标边长，规整到 `64 / 128 / 256 / 512`（向上取最近档），缺省 512 |
| `kind` | `image`（缺省）走 imaging 解码；`video` 走 ffmpeg 抽帧 |
| `m` | 仅作 HTTP 缓存标识，服务端**不信任**它，自己 `stat` 文件 |

响应带 `ETag`（由 kind、生成参数版本、文件大小、mtime、边长组成）并支持 `If-None-Match` → `304`；`Cache-Control: private, max-age=0, must-revalidate`。

**状态码是前后端之间的契约**，前端据此决定回退动作：

| 状态码 | 含义 | 前端动作 |
| --- | --- | --- |
| `415` | 解码不了（格式不支持 / 文件损坏 / 动画 WebP） | 图片：回退原图直连；视频：类型图标 |
| `422` | 超过体积或解码内存上限 | 类型图标（不下原文件） |
| `501` | 能力未启用（没有 ffmpeg） | 类型图标，但**可重试** |
| `503` | 排队超时 | 类型图标，但**可重试** |
| `404 / 400` | 不存在 / 路径不安全 | 类型图标 |

## 取图方式

前端按扩展名与文件体积把每个文件分派到四种方式之一：

| 条件 | 方式 | 说明 |
| --- | --- | --- |
| 图片（JPEG/PNG/GIF/BMP/TIFF/WebP）且 > 256 KB | `server` | 下载后端缩略图，入 IndexedDB |
| 图片（AVIF/HEIC/HEIF）且 > 256 KB | `client` | 浏览器拉原图后 canvas 降采样，入 IndexedDB |
| 音频 | `audio` | 从内嵌标签抽封面再降采样，入 IndexedDB |
| 视频 | `server` + `kind=video` | 需后端 ffmpeg 能力，未启用则不出预览 |
| 其余（SVG/ICO 等矢量与图标容器）与小图 | `direct` | 直连原图流，不入缓存 |

需要前端自己下载原图的那几类还受 `IMAGE_PREVIEW_RAW_MAX_BYTES`（20 MB）约束，超限直接不出预览——避免为一个网格格子拉一个大文件。

## 后端

处理链：`image.DecodeConfig` 读文件头 → 挡掉解压炸弹 → `imaging.Decode`（开 EXIF 自动定向）→ `imaging.Fit` 等比缩放（不放大）→ 按是否含透明通道选 JPEG(82) 或 PNG。

三道资源闸：

| 限制 | 值 | 作用 |
| --- | --- | --- |
| 源文件体积保险丝 | 256 MiB | **只对图片**，只 `stat` 不读文件，直接 422 |
| 解码内存估算 | 320 MiB | 按 `ColorModel` 推算每像素字节数（16 位为 8，非 4），约合 8 位 80 MP / 16 位 40 MP |
| 解码并发 | 图片 2 / 视频 1 | 分开计数；共用一个闸会让视频把整屏图片缩略图拖垮 |

其余：同一 `kind|path|边长|大小|mtime` 的并发请求由 singleflight 合并；图片排队上限 30 s、视频 5 s（视频槽位只有 1 个，等太久会白白占住前端的并发槽位）；ffmpeg 单进程超时 20 s，输出上限 4 MiB，先试 `-ss 3` 取帧、取不到再退回第 0 帧（因此不依赖 ffprobe）。LRU 上限 128 MiB，单条上限 4 MiB。

### 能力上报

`GET /api/files/auth` 兼作能力上报，前端启动时必调：

```json
{ "capabilities": { "videoThumbnail": true } }
```

没有 ffmpeg 时前端**根本不发**视频封面请求，而不是为每个视频发一次注定失败的请求。

### ffmpeg 探测

先看 `config.json` 的 `ffmpegPath`，为空则在 `PATH` 中查找。命中后结论在进程内永久缓存；**未命中只缓存 60 秒**，所以装完 ffmpeg 不必重启。视频不套用图片那条 256 MiB 保险丝，几 GB 的影片是常态，靠超时兜底。

## 前端

IndexedDB 分 `meta` 与 `blobs` 两个 store：淘汰与统计只读 meta，不加载 blob。指纹是 `THUMB_CACHE_VERSION : size : lastModified`——**改了后端的生成参数（滤镜、质量、输出格式）就递增 `THUMB_CACHE_VERSION`**，旧条目会自动失效。缓存总量上限 1 GiB，按最久未使用淘汰。

音频封面复用播放器那条带 Cookie 的 HTTP Range tokenizer，只读标签所在的分片，**不下载整个音频文件**；`music-metadata` 是动态 `import()`，不会进入首屏包。没有内嵌封面是一个确定的否定结果，会被记住，不会每次滚动都重新探测。

同一次会话内已经定论的失败也会被记住（避免反复重试），但 `501` / `503` 属于可重试失败，**不记**，下次滚动回来还会再试。

菜单里的 **Disable preview** 整体关闭预览（含文件夹内容预览），并同时清空缩略图缓存；开关只存本机。

## 已知边界

- **HEIC** 只有 Safari 能解，其他浏览器最终显示类型图标。
- **动画 GIF / APNG / 动画 WebP**：GIF 与 `.png` 动图只出第一帧；动画 WebP 后端解不了（`x/image/webp` 不支持 `ANIM`/`ANMF`），会 415 并回退原图直连，由浏览器播放。
- **ICC 色彩配置**不处理（Go 标准库限制），广色域照片颜色会偏淡。
- **文件夹 2×2 预览不含视频**：每格都要单起一次 ffmpeg，一屏几十个文件夹会挤爆只有一个槽位的视频闸门。

## 配置

| 字段 | 说明 |
| --- | --- |
| `ffmpegPath` | ffmpeg 可执行文件路径；留空表示在 `PATH` 中查找，都没有则关闭视频封面（不报错） |
