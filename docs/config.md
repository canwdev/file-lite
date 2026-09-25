# config.json Configuration Reference

[中文](./zh-CN/config.md) | English

File Lite's (Go backend) configuration comes from `config.json` in the data directory. This document lists the file location, when it is written, and what each field means. The type definition is [`Cfg`](../backend-go/config/config.go).

## File location

- Default: `<process working directory>/file-lite/config.json`.
- Change the data directory with `--data-dir <path>` or the `FILE_LITE_DATA_BASE_DIR` environment variable (`--data-dir` sets that variable).
- `sslKey` / `sslCert` are paths **relative to the data directory**.

## When it is generated and written

| Case | Behavior |
| --- | --- |
| `--create-config` | Writes a default config (including a randomly generated `password` and `jwtToken`) and exits. Adding `--with-tls` also generates a self-signed certificate; see [ssl.md](./ssl.md). |
| config.json already exists | Read as-is. If `password` or `jwtToken` is empty, a random value is generated and **written back**. |
| No config.json, and `--create-config` was not passed | **Ephemeral mode**: the password and signing key exist only in memory. Nothing is written. Log in with the ticket printed on the console; everything is gone when the process exits. |

## Example

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

## Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | string | `""` | Listen address. Empty means `0.0.0.0` (all interfaces). Priority: `--host` / `-H` > config file > `HOST` |
| `port` | string | `"3100"` | Listen port. Priority: `--port` / `-p` > config file > `PORT` |
| `password` | string | random | Login password. Generated and written back when empty; in ephemeral mode it exists only in memory. The console does not print it — read the config file. |
| `jwtToken` | string | random | JWT signing key. Changing it invalidates every existing session immediately. |
| `logLevel` | string | `"warn"` | Event-log threshold: `verbose` / `warn` / `error` / `none`. Unknown values fall back to `warn`. Startup messages are not affected. |
| `sslKey` / `sslCert` | string | `""` | HTTPS starts only when both are non-empty. Paths are relative to the data directory; see [ssl.md](./ssl.md). |
| `allowedCIDRs` | string[] | `null` | Client IP ranges (CIDR) allowed to connect. `null` (the default) means no restriction; `[]` denies everyone. See [ip-allowlist.md](./ip-allowlist.md). |
| `allowSelfUpdate` | bool | `false` | Whether to register `POST /api/update` (verify and replace this binary, then restart), `POST /api/update/restart` (restart in place) and `POST /api/update/exit` (exit). When off, these three routes are **not registered at all** and the request gets 404. |
| `allowedRoots` | string[] | `[]` | Root paths the file manager may access — a **scope limit**. Empty means no restriction. See below. |

Any field not in the table is treated as unset. `ffmpegPath`, `taskConcurrency`, `copyFileConcurrency` and `copyFsync` used to be configurable and have been removed: ffmpeg is always looked up on `PATH`, task concurrency is fixed at 2, and per-task file concurrency is fixed at 4. 7-Zip is probed the same way (on Windows, also in the default `Program Files\7-Zip` locations) and is not a config field; without it, compress and extract stay hidden. On a **local volume** the temporary file is always fsynced before it is renamed. On a network location (SMB / NFS / an object-storage mount) that fsync is skipped, and permissions and timestamps are not aligned either — each of those is a network round trip, and the mount itself already guarantees the data is committed.

`startPath` has been removed. The first open lands on **the first entry in the locations list** (usually Home); after that the address bar or the sidebar switches location freely. The start location is no longer a setting, so a config that names a directory which does not exist can no longer happen. A leftover field in an old config is ignored and does not affect startup.

## allowedRoots

Empty by default means no restriction: **after login, every path the server process is allowed to access can be read and written**. Once a set of absolute paths is configured, anything outside that set returns 403, and the sidebar lists only those locations.

```json
"allowedRoots": ["C:/Users/me/Shared", "//nas/media"]
```

- Several entries are a **union**: a path is allowed if it falls inside any one of them, so you can expose directories that do not contain each other (one local, one on a NAS).
- Nested entries collapse to the outer one: writing both `/srv` and `/srv/files` keeps only `/srv`. The inner path does not make anything new reachable, and leaving it in only duplicates a sidebar entry.
- Each entry must be an absolute path in canonical form: `C:/Users/me`, `//server/share`, `/home/me` (backslashes are accepted and normalized). Empty strings are ignored.
- **Checked at startup.** An illegal form, a missing directory, or a path that points at a file fails startup, and the error includes that path. One wrong path would 403 every request with nothing in the UI to explain it, so failing to start is the safer outcome.
- The startup log prints the effective scope: `file access scope: ... (allowedRoots)`, or `the whole file system` when unset.
- The destination must be inside the scope. **The source may be outside it** — otherwise there would be no way to copy a file from elsewhere into a controlled directory, which is the main reason the setting exists.

It is **not a sandbox**. The process still runs with the service account's permissions. What it stops is lateral movement after authentication: signatures last a long time and cookies persist, so a leaked token would otherwise be the whole machine. Known boundaries:

- A symlink inside the scope that points outside it is not blocked. Canonical paths do not resolve symlinks (design decision 10). Blocking that would mean resolving every request, which both opens a TOCTOU window and makes a path that does not exist impossible to judge.
- Access through a symlink (`/srv/files -> /mnt/pool/files`) is judged on **the symlink's own path**. With `allowedRoots: ["/srv/files"]`, `/mnt/pool/files` is out of scope. That is intentional and explainable.
- Paths the server opens for itself (the data directory, the thumbnail cache) are not constrained. That is the process acting on its own, not a user request.

## Notes

- `password` and `jwtToken` are secrets stored in plaintext. Do not commit `config.json` or share it.
- The login token is kept in an HttpOnly cookie, so page scripts cannot read it and the WebSocket URL no longer carries it. Logging out asks the server to clear the cookie. Over plain HTTP the cookie still travels unencrypted — use `--with-tls` when that matters.
- **By default, after login, every path the server process can access can be read and written** (`allowedRoots` empty). Run it only on a network you trust. Use `allowedCIDRs` to limit where clients come from, or `allowedRoots` to narrow the scope.
- With `allowSelfUpdate` on, **any logged-in user** can upload and run an arbitrary binary, or restart or stop the service. Turn it on only on a network you trust, and pair it with `allowedCIDRs` when you need to. See [ip-allowlist.md](./ip-allowlist.md).
- Restart the process after changing `password` / `jwtToken` / `port` / `host` / `sslKey` / `sslCert`.
- An environment variable applies only when the config file does not set that field: command line > config file > environment variable.
