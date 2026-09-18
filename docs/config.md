# config.json 配置说明

File Lite（Go 后端）的配置来自数据目录下的 `config.json`。本文列出文件位置、写入时机和每个字段的含义；类型定义见 [`Cfg`](../backend-go/config/config.go)。

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
  "startPath": "",
  "logLevel": "warn",
  "sslKey": "",
  "sslCert": "",
  "allowedCIDRs": [],
  "allowSelfUpdate": false
}
```

## 字段

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `host` | string | `""` | 监听地址，空表示 `0.0.0.0`（所有网卡）。优先级：`--host` / `-H` > 配置文件 > 环境变量 `HOST` |
| `port` | string | `"3100"` | 监听端口。优先级：`--port` / `-p` > 配置文件 > 环境变量 `PORT` |
| `password` | string | 随机 | 登录密码。为空时随机生成并写回；ephemeral 模式下只存在于内存。控制台不打印它，请查配置文件 |
| `jwtToken` | string | 随机 | JWT 签名密钥。改它会让所有已登录会话立刻失效 |
| `startPath` | string | `""` | 首次打开页面时进入的目录，空表示从驱动器列表开始。相对路径按启动时的工作目录解析。只影响首次导航，**不限制**能访问哪些路径 |
| `logLevel` | string | `"warn"` | 事件日志阈值：`verbose` / `warn` / `error` / `none`，未知值回落到 `warn`。启动提示不受它影响 |
| `sslKey` / `sslCert` | string | `""` | 两个都非空才以 HTTPS 启动，路径相对数据目录，见 [ssl.md](./ssl.md) |
| `allowedCIDRs` | string[] | `[]` | 允许访问的客户端 IP 段（CIDR），空表示不限制，见 [ip-allowlist.md](./ip-allowlist.md) |
| `allowSelfUpdate` | bool | `false` | 是否注册 `POST /api/update`（校验并替换自身二进制、重启）、`POST /api/update/restart`（原地重启进程）和 `POST /api/update/exit`（退出进程）。关闭时这三条路由**根本不注册**，请求得到 404 |

超过上表的字段都会当作未配置。曾经可配的 `ffmpegPath`、`taskConcurrency`、`copyFileConcurrency`、`copyFsync` 已删除：ffmpeg 固定在 `PATH` 中查找，任务并发固定 2、单任务内文件并发固定 4，临时文件在改名之前一定 fsync。

`safeBaseDir` 也已删除：**文件管理器可以访问进程有权限访问的任意路径**，不再有一个受限根。需要改变首次进入的位置用 `startPath`，它只影响起点、不是访问范围。

## 注意

- `password` 和 `jwtToken` 是明文保存的机密：不要把 config.json 提交进仓库或分享出去。
- **服务进程有权访问的每一个路径，登录后都能读写**（`safeBaseDir` 删除后的行为）。只在你信任的网络里运行；必要时配合 `allowedCIDRs` 限制来源。
- `allowSelfUpdate` 打开后，**任何已登录用户**都能上传并运行任意二进制，或重启、停掉服务。只在你信任的网络里打开，必要时配合 `allowedCIDRs` 一起用；详见 [ip-allowlist.md](./ip-allowlist.md)。
- 改 `password` / `jwtToken` / `port` / `host` / `sslKey` / `sslCert` 之后需要重启进程。
- 环境变量只在配置文件没有写该字段时生效：命令行 > 配置文件 > 环境变量。
