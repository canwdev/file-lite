# config.json 配置说明

中文 | [English](../config.md)

File Lite（Go 后端）的配置来自数据目录下的 `config.json`。本文列出文件位置、写入时机和每个字段的含义；类型定义见 [`Cfg`](../../backend-go/config/config.go)。

## 文件位置

- 默认：`<进程工作目录>/file-lite/config.json`。
- 用 `--data-dir <path>` 或环境变量 `FILE_LITE_DATA_BASE_DIR` 换数据目录（`--data-dir` 就是设置这个环境变量）。
- `sslKey` / `sslCert` 写的是**相对数据目录**的路径。

## 生成与写入时机

| 情况 | 行为 |
| --- | --- |
| `--create-config` | 写出一份默认配置（含随机生成的 `password`、`jwtToken`）后退出；加 `--with-tls` 会同时生成自签证书，见 [ssl.md](./ssl.md) |
| 已有 config.json | 直接读取；`password` 或 `jwtToken` 为空时随机生成并**写回**该文件 |
| 没有 config.json，也没加 `--create-config` | **ephemeral 模式**：密码和签名密钥只在内存里生成，不写任何文件，用控制台打印的 Ticket 登录，进程一退全部失效 |

## 示例

```json
{
  "host": "",
  "port": "3100",
  "password": "2f8c1a9d0b3e4f56",
  "jwtToken": "9Xk...",
  "logLevel": "warn",
  "sslKey": "",
  "sslCert": "",
  "allowedCIDRs": null,
  "allowSelfUpdate": false,
  "allowedRoots": []
}
```

## 字段

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `host` | string | `""` | 监听地址，空表示 `0.0.0.0`（所有网卡）。优先级：`--host` / `-H` > 配置文件 > 环境变量 `HOST` |
| `port` | string | `"3100"` | 监听端口。优先级：`--port` / `-p` > 配置文件 > 环境变量 `PORT` |
| `password` | string | 随机 | 登录密码。为空时随机生成并写回；ephemeral 模式下只存在于内存。控制台不打印它，请查配置文件 |
| `jwtToken` | string | 随机 | JWT 签名密钥。改它会让所有已登录会话立刻失效 |
| `logLevel` | string | `"warn"` | 事件日志阈值：`verbose` / `warn` / `error` / `none`，未知值回落到 `warn`。启动提示不受它影响 |
| `sslKey` / `sslCert` | string | `""` | 两个都非空才以 HTTPS 启动，路径相对数据目录，见 [ssl.md](./ssl.md) |
| `allowedCIDRs` | string[] | `null` | 允许访问的客户端 IP 段（CIDR）。`null`（缺省）表示不限制，`[]` 表示全部拒绝，见 [ip-allowlist.md](./ip-allowlist.md) |
| `allowSelfUpdate` | bool | `false` | 是否注册 `POST /api/update`（校验并替换自身二进制、重启）、`POST /api/update/restart`（原地重启进程）和 `POST /api/update/exit`（退出进程）。关闭时这三条路由**根本不注册**，请求得到 404 |
| `allowedRoots` | string[] | `[]` | 允许访问的根路径，**范围限制**；空表示不限制。见下 |

超过上表的字段都会当作未配置。曾经可配的 `ffmpegPath`、`taskConcurrency`、`copyFileConcurrency`、`copyFsync` 已删除：ffmpeg 固定在 `PATH` 中查找，任务并发固定 2、单任务内文件并发固定 4，**本机卷上**临时文件在改名之前一定 fsync。网络位置（SMB / NFS / 对象存储挂载）上不做这次 fsync，也不对齐权限与时间——那三处各是一次网络往返，而挂载层本身已经保证数据已提交。

`startPath` 已删除：首次打开进入**位置列表的第一个**（通常是 Home），之后的位置由地址栏或侧边栏自由切换——起点不再是配置项，也就不会再出现「配置里写了一个不存在的目录」这类问题。旧配置里残留的该字段会被忽略，不影响启动。

## allowedRoots

默认空 = 不限制：**服务进程有权访问的每一个路径，登录后都能读写**。配上一组绝对路径之后，范围之外的请求一律 403，侧边栏也只列出这些位置。

```json
"allowedRoots": ["C:/Users/me/Shared", "//nas/media"]
```

- 多条是**并集**：落在任意一条之内都放行，便于同时开放几个互不包含的目录（例如本机一个、NAS 一个）。
- 嵌套的会被折叠成外层那一条：同时写 `/srv` 与 `/srv/files` 只保留 `/srv`——内层不会让任何新路径变得可访问，留着只会让侧边栏出现重复项。
- 每一项都必须是绝对路径的 canonical 形态：`C:/Users/me`、`//server/share`、`/home/me`（也可以用反斜杠写，会被归一化）。空串项被忽略。
- **启动时校验**：形态非法、目录不存在、指向的是文件，都直接启动失败并在错误里带上那条路径。配错一个路径会让所有请求 403，而界面上看不出原因，所以宁可起不来。
- 启动日志会打印生效范围：`file access scope: ... (allowedRoots)`，不配则是 `the whole file system`。
- 目标必须在范围内；**源可以在范围外**——否则就没法把别处的文件拷进受控目录，而那正是它的主要用途。

它**不是沙箱**：进程仍以服务账户的权限运行。它拦的是「认证之后的横向移动」——签名有效期长、cookie 持久化，一个泄露的 token 否则等于整台机器。已知边界：

- 范围内的符号链接指向范围外时不会被拦住：canonical 路径不解析符号链接（设计决策 10），要挡住得解析每一次请求，既有 TOCTOU 窗口又会让不存在的路径无法判断。
- 通过软链访问（`/srv/files -> /mnt/pool/files`）时，范围按**软链那条路径**算：配 `allowedRoots: ["/srv/files"]` 时 `/mnt/pool/files` 不在范围内。这是有意的、可解释的行为。
- 服务端自己访问的路径（数据目录、缩略图缓存）不受它约束，那是进程自身的行为，不是用户请求。

## 注意

- `password` 和 `jwtToken` 是明文保存的机密：不要把 config.json 提交进仓库或分享出去。
- **默认情况下，服务进程有权访问的每一个路径，登录后都能读写**（`allowedRoots` 为空时）。只在你信任的网络里运行；必要时配合 `allowedCIDRs` 限制来源，或用 `allowedRoots` 把范围收窄。
- `allowSelfUpdate` 打开后，**任何已登录用户**都能上传并运行任意二进制，或重启、停掉服务。只在你信任的网络里打开，必要时配合 `allowedCIDRs` 一起用；详见 [ip-allowlist.md](./ip-allowlist.md)。
- 改 `password` / `jwtToken` / `port` / `host` / `sslKey` / `sslCert` 之后需要重启进程。
- 环境变量只在配置文件没有写该字段时生效：命令行 > 配置文件 > 环境变量。
