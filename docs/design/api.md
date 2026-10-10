# File Lite API contract

The Go backend (`backend-go`) and the web frontend (`frontend`) always ship together,
so this API has **no version negotiation and no backward compatibility**: there is no
`/v1`, no version field in a response, and no legacy route kept alive. When an endpoint
changes, this document changes in the same commit (see §16).

This file is the single place that describes the HTTP and WebSocket surface. Route
registration lives in `backend-go/routes`, the client wrappers live in
`frontend/src/api`, and request/response types that both sides share are mirrored in
`frontend/src/types/server.ts`.

## 1. Principles

- **Commands are HTTP.** Every action the UI can take has an HTTP request. The
  WebSocket is not a command channel: it only carries server→client notifications plus
  the one real-time collaboration channel (`text-sync`).
- **Resources are nouns, plural for collections.** The verb lives in the HTTP method.
  There is no `/create-dir`, `/rename`, `/exists` or `/open-in-host-explorer`.
- **Async work is a resource.** Anything that can take a noticeable amount of time
  (copy, move, delete, compress, extract) creates a task and returns `202 Accepted` or
  `201 Created` with a `Location` pointing at `/api/tasks/{id}`. Progress arrives over
  the WebSocket.
- **One error shape.** Every non-2xx response body is the object in §12.
- **The user's filesystem path is the resource identity** and appears in the URL
  (§2). The client never invents a path-shaped identifier of its own.

Status code vocabulary:

| Code | Meaning |
|---|---|
| 200 | Read succeeded, or a `PUT` replaced an existing resource |
| 201 | A resource was created; `Location` points at it |
| 202 | Work was accepted and runs asynchronously |
| 204 | Success with no body |
| 400 | Malformed request, invalid path or invalid name |
| 401 | No valid session |
| 403 | Outside `allowedRoots`, or a missing CSRF header on an unsafe method |
| 404 | The path or resource does not exist |
| 409 | The request conflicts with the current state (for example a directory where a file belongs) |
| 412 | An `If-None-Match` / `If-Match` precondition failed |
| 415 | The media format is unsupported (thumbnail decoding) |
| 422 | The media is too large to process (thumbnail) |
| 423 | The volume is locked by BitLocker |
| 429 | Rate limited (login only) |
| 503 | A network location is unreachable, or the server is busy |

## 2. Paths in URLs

### Canonical form

All paths crossing the wire use the canonical form produced by `fileops`:

- absolute, `/` separated, no `.` or `..` segments, no trailing slash;
- Windows volume: `C:/Users/a`;
- UNC share: `//server/share/dir`;
- Unix: `/home/a`.

The listing endpoints return this form in `entry.path`, so the client can pass a path
straight back without joining anything.

### URL form

```
/api/fs/<representation>/<percent-encoded path>
```

The path is the **last** URL segment and must be percent-encoded by the client. This is
mandatory, not cosmetic: a raw path may contain `?`, `#`, `%`, spaces, `//` and
non-ASCII characters.

```js
// frontend/src/api/fs.ts
const url = `/api/fs/content/${encodeURIComponent(path)}`
```

Rules the server relies on:

1. Echo's wildcard segment is the only way to accept a path with slashes, and a
   wildcard must be the last segment. Sub-resources after a wildcard
   (`/api/fs/content/{path}/thumbnail`) cannot be registered, which is why thumbnail
   and metadata are separate representation roots instead of sub-resources of content.
2. Echo matches routes against the raw, still-encoded path when Go sets `URL.RawPath`,
   so an encoded `%2F` never acts as a path separator.
3. Echo does **not** decode wildcard parameters. The handler percent-decodes the
   segment exactly once and then hands the result to `fileops.Resolve`, which
   canonicalizes it and enforces `allowedRoots`.
4. Clients must never concatenate a path into a URL by hand; the helpers in
   `frontend/src/api/fs.ts` are the only place that builds these URLs (they serve
   `<img src>`, `<video src>` and `<a download>` as well as `fetch`).

## 3. Resource overview

| Resource | Endpoints |
|---|---|
| Session | `GET POST DELETE /api/session`, `POST /api/session/tickets` |
| Health | `GET /api/health` |
| Volumes | `GET /api/volumes` |
| Plugins | `GET /api/plugins` |
| Directories | `GET PUT /api/fs/directories/{path}` |
| Entries | `GET PATCH /api/fs/entries/{path}` |
| Content | `GET HEAD PUT /api/fs/content/{path}` |
| Entry queries | `POST /api/fs/entry-queries` |
| Thumbnails | `GET /api/fs/thumbnail/{path}` |
| Downloads | `GET /api/fs/downloads?paths=…` |
| Measurements | `GET POST /api/fs/measurements`, `GET DELETE /api/fs/measurements/{id}` |
| Tasks | `GET POST /api/tasks`, `GET DELETE /api/tasks/{id}`, `POST /api/tasks/{id}/retries`, `POST /api/tasks/{id}/resolutions` |
| Settings | `GET /api/settings`, `GET PUT DELETE /api/settings/{key}` |
| Host | `POST /api/host/reveals` |
| Server | `POST /api/server/updates`, `POST /api/server/restarts`, `DELETE /api/server` |
| Diagnostics | `GET /api/speed-test/download`, `POST /api/speed-test/upload` |
| Push | `GET /api/ws` (WebSocket upgrade) |

## 4. Session

The session is a cookie pair; no token ever appears in a response body. See §14.

### `GET /api/session`

Current session plus everything the client needs before it renders.

```json
{
  "capabilities": {
    "videoThumbnail": true,
    "selfUpdate": false,
    "archive": true,
    "archiveExtractExtensions": [".zip", ".7z", ".rar"],
    "archiveCompressFormats": [
      { "id": "7z", "ext": "7z", "label": "7z", "password": true }
    ]
  },
  "allowedRoots": []
}
```

- `capabilities.videoThumbnail` — ffmpeg is available for video covers. When false the
  grid shows a type icon instead of firing one doomed request per video.
- `capabilities.selfUpdate` — the `/api/server/*` endpoints are registered. When false
  they do not exist at all and the UI hides those menu entries.
- `capabilities.archive` — 7-Zip was found. `archiveExtractExtensions` is what Extract
  Here may offer; `archiveCompressFormats` is what Compress may create.
- `allowedRoots` — the configured file access scope. Empty means unrestricted. The
  client uses it to explain a 403 instead of showing a bare error.

`401` when there is no valid session. That is the login probe; there is no
`authenticated` field.

### `POST /api/session`

Creates a session and sets the cookie pair.

```json
{ "password": "…", "remember": true }
```

or, for a QR login ticket:

```json
{ "ticket": "AB12CD", "remember": false }
```

- `201` on success.
- `401` on a wrong password or an expired/unknown ticket.
- `429` when rate limited. This is the only rate-limited endpoint (20 requests per IP
  per minute) and the only one that feeds the failure ban (5 failures ⇒ 15 minute ban).

### `DELETE /api/session`

Clears the cookie pair and returns `204`. Needs no session, so an expired token can
still log out, but a live session cookie must pass the double-submit check.

### `POST /api/session/tickets`

Mints a short-lived login ticket and returns one ready-to-use login URL per local
address, so the frontend can render a QR code:

```json
{
  "value": "AB12CD",
  "urls": ["http://192.168.1.10:8080/?ticket=AB12CD"],
  "expiresAt": "2026-01-02T15:04:05Z"
}
```

`201 Created`. The backend keeps at most one ticket, so every call invalidates the URLs
a previous call returned; the client re-mints before showing a stale QR code.

## 5. Health, volumes and plugins

### `GET /api/health`

`200` with `{ "status": "ok" }`, no session required. Liveness only: the e2e harness
polls it before starting a browser, and an external probe can too. It deliberately says
nothing about the file system or the session.

### `GET /api/volumes`

The navigable locations shown in the sidebar.

```json
[
  { "label": "Home", "path": "/home/a", "kind": "home" },
  { "label": "Data", "path": "D:/", "kind": "volume", "fileSystem": "NTFS", "free": 123456, "total": 999999 }
]
```

`kind` is one of `volume`, `network`, `home`, `locked`, `optical`. `optical` is an
ISO 9660 or UDF mount, or a Windows CD-ROM drive; content previews stay off.
`fileSystem` is the name the OS reports (`ext4`, `NTFS`, `9p`, `iso9660`). It is
omitted for Home and when the volume cannot be read. The sidebar tooltip shows it.
When `allowedRoots` is configured the list is narrowed to the allowed scope and
each allowed root appears as its own location.

### `GET /api/plugins`

```json
[
  {
    "id": "demo",
    "name": "Demo",
    "entryUrl": "/plugins/demo/index.html",
    "iconEmoji": "",
    "iconUrl": "",
    "openWith": ["txt"],
    "singleInstance": true,
    "version": "1.0.0"
  }
]
```

Plugin assets are served from `/plugins/*` (authenticated, cross-origin isolated); the
listing is the only JSON endpoint.

## 6. Filesystem

### `GET /api/fs/directories/{path}`

Lists one directory.

Query parameters:

| Name | Default | Meaning |
|---|---|---|
| `offset` | `0` | Skip this many entries (flat listings only) |
| `limit` | `2000` | Return at most this many entries (max `50000`) |
| `recursive` | `false` | Flatten every file below the directory; directories themselves are not listed |
| `showHidden` | `false` | Only affects `recursive`: hidden directories are pruned instead of walked |

```json
{
  "path": "/home/a/docs",
  "offset": 0,
  "limit": 2000,
  "total": 3,
  "truncated": false,
  "entries": [
    {
      "name": "notes.txt",
      "path": "/home/a/docs/notes.txt",
      "ext": ".txt",
      "isDirectory": false,
      "isLink": false,
      "hidden": false,
      "lastModified": 1735689600000,
      "birthtime": 1735689600000,
      "size": 128,
      "error": null
    }
  ]
}
```

- `total` is the number of entries in the directory after internal temp files are
  filtered out, so the client can page.
- `truncated` is only meaningful for `recursive`, where the walk stops at the cap
  (1,000,000 files) and the caller is told the result is incomplete.
- In recursive mode a file also carries `relativePath` (its path relative to the listed
  directory, `/` separated). `name` is always the base name in both modes.
- Hidden entries are always included in a flat listing with `hidden: true`; the UI
  filters them locally so toggling "show hidden" needs no request. `showHidden` exists
  because a recursive walk has to decide whether to descend.
- Reading a directory entry can fail (permissions, a broken link). That entry still
  appears, with `size: 0` and a non-null `error` instead of failing the whole listing.
- Errors: `400` invalid path, `403` outside `allowedRoots`, `404` missing, `503` a
  network location is unreachable, `423` a locked volume.
- An entry that is a directory is listed with `size: null`.

### `PUT /api/fs/directories/{path}`

Creates a directory, including missing parents. Idempotent.

- `201 Created` with `{ "path": "…", "entry": { … } }` when it was created.
- `200 OK` with the same body when it already existed.
- `400` `invalid_name` for a reserved internal temp name.

### `GET /api/fs/entries/{path}`

Returns one entry (file or directory) in the same shape as a listing entry, wrapped as
`{ "path": "…", "entry": { … } }`. This is how the client refreshes a single row after
a rename or an in-place change. Errors match the directory listing.

### `PATCH /api/fs/entries/{path}`

Renames an entry **within its current directory**. Moving across directories is a task
(`POST /api/tasks` with `kind: "move"`).

```json
{ "name": "renamed.txt" }
```

- `name` must be a base name: no `/` or `\`, not `.` or `..`, not empty.
- `200 OK` with `{ "path": "…", "entry": { … } }`.
- `400` `invalid_name` for a malformed or reserved name.
- `404` when the source does not exist, `409` when the target already exists.

### `GET` / `HEAD` / `PUT /api/fs/content/{path}`

File bytes.

**GET** streams the file inline (`Content-Disposition: inline`). Add
`?disposition=attachment` to download it under its own name instead. The response
carries a strong `ETag` derived from size and mtime, plus `Last-Modified`, and honors
`If-None-Match`, `If-Modified-Since`, `Range` and `If-Range` through
`http.ServeContent`, so media seeking and resume work without special cases.

Content served from the file system is untrusted: every response carries
`X-Content-Type-Options: nosniff`, and HTML/SVG documents also carry
`Content-Security-Policy: sandbox allow-scripts`.

**HEAD** returns the same headers with no body (media probing).

**PUT** writes the request body to the path. This is the upload endpoint:

- Body is the raw file bytes. There is no multipart envelope and no `file` field, so
  the server can stream the body straight to its atomic publish step.
- Writing into a directory that does not exist is a `404`; `PUT` never creates parents.
  A folder upload creates its directories first (`PUT /api/fs/directories/{path}`).
- Preconditions are standard HTTP, and are how the UI expresses its conflict policy:

| Client intent | Request | Server answer |
|---|---|---|
| Create only, never overwrite | `If-None-Match: *` | `201` created, or `412` when the path already exists |
| Replace only if unchanged | `If-Match: <etag from the listing>` | `200` replaced, or `412` when the file changed |
| Replace unconditionally | no precondition | `200` replaced, or `201` created |
| Keep both | `?onConflict=keep-both` | Writes `name (1).ext` instead when the path exists |

- `201 Created` and `200 OK` both return
  `{ "path": "…", "name": "…", "entry": { … } }` and a `Location` header.
- **`Location` is authoritative.** It can differ from the request URL when
  `keep-both` renamed the file, or when the server had to sanitize characters that are
  illegal on the host platform. The client uses the returned `path`/`name`, never its
  own guess.
- `400` `invalid_name`, `400` `precondition_failed`-style malformed preconditions,
  `409` when the target is a directory, `403`, `404` (a missing parent directory),
  `412` on a failed precondition, `503` for an unreachable network location.
- Creating a file with no content is `PUT` with an empty body.

The upload dialog asks about name conflicts **once per batch**, before anything is
uploaded. That question is what `POST /api/fs/entry-queries` answers; the preconditions
above are the actual guard, so a file created between the question and the write still
cannot be overwritten by accident.

### `POST /api/fs/entry-queries`

```json
{ "paths": ["/home/a/one.txt", "/home/a/two.txt"] }
```

```json
{ "existing": ["/home/a/one.txt"] }
```

`200`. The input strings are echoed back verbatim (the caller compares them against the
paths it already holds), so a path that fails to resolve is simply reported as
non-existent rather than as an error. At most 20 000 paths per request; the server
stats them concurrently.

This is a read-only convenience for the conflict dialog and for copy/paste pre-checks.
It never authorizes a write.

### `GET /api/fs/thumbnail/{path}`

Returns a server-generated thumbnail for an image or a video frame.

| Query | Default | Meaning |
|---|---|---|
| `size` | service default | Requested longest edge in pixels; normalized by the service |
| `kind` | `image` | `image` decodes the file, `video` extracts a frame with ffmpeg |

- `200` with the image bytes, a strong `ETag` and
  `Cache-Control: private, max-age=0, must-revalidate`. A matching `If-None-Match`
  returns `304`.
- `415` unsupported/undecodable format, `422` source above the size limit, `501`
  capability unavailable (no ffmpeg), `503` decode slots are busy, `404` missing.
- The client falls back to the original file (images) or a type icon (videos) on these
  codes, and treats `501` as "capability off", not as a file error.

### `GET /api/fs/downloads?paths=…&paths=…`

Downloads a selection. `paths` is a repeated query parameter and must contain at least
one path.

- A single path that is a regular file is served **directly** as an attachment
  (`Content-Disposition: attachment`, `ETag`, `Range`), because zipping one file helps
  nobody.
- A directory, or more than one path, is streamed as a zip with an attachment filename
  derived from the selection.
- `200` with either `application/zip` or the file's own type.
- The server resolves and readability-checks every path **before** it starts writing,
  so a selection that contains an unreadable file fails with a plain JSON error instead
  of a truncated archive.
- The download button uses this endpoint for everything, because it does not always
  know whether the target is a file or a directory. Fetching bytes you already know are
  a file can equally use `GET /api/fs/content/{path}?disposition=attachment`.

### `POST /api/host/reveals`

```json
{ "paths": ["/home/a/docs"] }
```

Opens the given paths in the host's own file manager (Explorer/Finder/…). Returns `204`
on success, `404` when a path does not exist, `500` when the host command fails. This is
an action on the host, hence its own resource root rather than a filesystem resource.

## 7. Tasks

Long-running file operations. The command comes over HTTP; progress, conflicts and the
final result arrive over the WebSocket (§11).

### `POST /api/tasks`

```json
{
  "kind": "copy",
  "fromPaths": ["/home/a/one.txt", "/home/a/two.txt"],
  "toPath": "/home/a/backup",
  "onConflict": "ask",
  "format": "7z",
  "password": "secret",
  "intoFolder": false
}
```

| Kind | Required | Notes |
|---|---|---|
| `copy` | `fromPaths`, `toPath` | Copies into the destination directory |
| `move` | `fromPaths`, `toPath` | Also what an inter-directory rename uses |
| `delete` | `fromPaths` | `toPath` must be absent |
| `duplicate` | `fromPaths`, `toPath` | Creates `name - Copy` next to the source; never asks about conflicts |
| `compress` | `fromPaths`, `toPath`, `format` | `toPath` is the archive file to create; `password` optional |
| `extract` | `fromPaths`, `toPath` | `intoFolder` extracts each archive into a folder named after it |

- `onConflict` is one of `ask` (default), `overwrite`, `skip`, `keep-both`. `ask` makes
  the task pause in `awaiting-conflict` and push a conflict event.
- `201 Created`, `Location: /api/tasks/{id}`, body = task snapshot.
- `400` `unsupported_task_kind`, `400` when required parameters are missing, `400` when
  a source does not exist, `400` when a directory would be moved into its own subtree.
- `password` is a create-time input and is never included in a snapshot or broadcast.

Task snapshot (also the WebSocket payload shape):

```json
{
  "id": "t_1a2b3c4d5e6f7788",
  "kind": "copy",
  "state": "running",
  "fromPaths": ["/home/a/one.txt"],
  "toPath": "/home/a/backup",
  "isMove": false,
  "progress": { "itemsTotal": 2, "itemsDone": 1, "bytesTotal": 0, "bytesDone": 0, "currentPath": "/home/a/two.txt" },
  "stats": { "succeeded": 1, "skipped": 0, "renamed": 0, "failed": 0, "conflict": 0 },
  "canCancel": true,
  "createdAt": 1735689600000,
  "startedAt": 1735689600500
}
```

`state` is one of `queued`, `scanning`, `awaiting-conflict`, `running`, `succeeded`,
`partial`, `failed`, `cancelled`. `progress.bytesTotal`/`bytesDone` are only
meaningful when a total is known; `progress.indeterminate` is set when the worker
cannot report a percentage yet.

### `GET /api/tasks`

`200` with an array of every task snapshot, oldest first. Newest is last.

### `GET /api/tasks/{id}`

`200` with one snapshot, `404` `task_not_found`. Used for polling and for re-syncing
after a reconnect.

### `DELETE /api/tasks/{id}`

Cancels a task that is still running, or removes a finished one from the list. Both
return `204`. Deleting an id that is already gone is also `204`. `GET` of an unknown
id is still `404` `task_not_found`.

### `POST /api/tasks/{id}/retries`

Re-runs the failed and conflicted items of a finished task. The server takes the paths
from its own stored results (which are complete) rather than from the client. Returns
`201` with the new task snapshot and a `Location`. `409` `task_finished`-style
conflicts (for example retrying a task that is still running) are reported as `409`.

### `POST /api/tasks/{id}/resolutions`

Answers a conflict event and lets the task continue.

```json
{
  "policy": "overwrite",
  "applyToAll": true,
  "items": [{ "relativePath": "sub/a.txt", "policy": "skip" }]
}
```

- `policy` applies to every conflict not named in `items`; `applyToAll` extends it to
  conflicts discovered later in the same task.
- `204` on success, `404` unknown task, `409` when the task is not waiting for a
  decision.

## 8. Settings

The settings store holds small JSON values written by the web UI (for example the
per-folder view settings). Keys are opaque strings chosen by the frontend.

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/settings` | `200` `{ "key": value, … }` |
| `GET` | `/api/settings/{key}` | `200` `{ "key": "…", "value": … }`; `value` is `null` when unset |
| `PUT` | `/api/settings/{key}` | Body `{ "value": … }` → `200` `{ "key": "…", "value": … }` |
| `DELETE` | `/api/settings/{key}` | `204` |

Every `PUT` and `DELETE` also broadcasts a `settings.sync` event to all connected
clients, including the caller, so several windows stay consistent without polling.
`500` `settings_failed` when the store cannot be read or written.

## 9. Directory measurements

The Properties window needs the recursive size of a folder, which can take a long time
on a big or remote directory. A measurement is its own short-lived resource; it is not
a task because it produces a number rather than changing files, and because it should
not appear in the Transfers panel.

### `POST /api/fs/measurements`

```json
{ "path": "/home/a" }
```

`201 Created` with `{ "id": "m_…", "path": "/home/a", "complete": false }`.

Progress and the final result are pushed as `measurements` events over the WebSocket
(§11). A file path completes immediately with its own size and zero counts.

### `GET /api/fs/measurements/{id}`

`200` with the current state, so a client that missed the push (or wants to poll) can
recover:

```json
{
  "id": "m_…",
  "path": "/home/a",
  "isDirectory": true,
  "size": 123456,
  "fileCount": 42,
  "folderCount": 7,
  "complete": true
}
```

`404` after the measurement is cancelled, replaced or has been idle long enough to be
dropped.

### `DELETE /api/fs/measurements/{id}`

Cancels the walk and forgets the resource. `204`. Closing the Properties window or
switching to another target cancels the previous measurement.

## 10. Server operations

Registered only when `allowSelfUpdate` is set in the config; otherwise these routes do
not exist and the response is `404` (the endpoint's absence is the answer, not 401/403).

### `POST /api/server/updates`

Body is the raw new backend binary. The server verifies and installs it, then answers
`200` with `{ "from": "1.5.0", "to": "1.5.0", "message": "Updated, restarting" }` and
restarts after the response has been flushed. `400` carries the verification failure.

### `POST /api/server/restarts`

Restarts the process with its original arguments and environment (used to reload the
config). `202` `{ "message": "Restarting" }` before the restart happens.

### `DELETE /api/server`

Stops the process. `202` `{ "message": "Exiting" }` before the exit happens.

## 11. WebSocket channel

`GET /api/ws` upgrades to a WebSocket. The handshake is authenticated by the auth
cookie (`Authorization: Bearer` also works for scripts); the origin is checked against
the request host. At most 20 connections per IP; a per-connection outbound queue drops
progress-only messages when a client is slow instead of blocking broadcasts; ping every
25 s, pong deadline 60 s; the client reconnects after 2 s.

### Client → server

Only the collaboration channel sends messages:

```json
{ "scope": "text-sync", "type": "join",   "channel": "CH1" }
{ "scope": "text-sync", "type": "update", "channel": "CH1", "text": "…" }
```

Anything else is answered with an error message and otherwise ignored. There is no
request/response correlation over the socket; commands are HTTP.

A channel's text lives in server memory until the process restarts, and `join` is
idempotent: joining the channel you are already in only reports its current text. (Leaving
and re-entering instead would drop the text whenever the caller is the last client in that
channel.) A `sync` therefore goes to the joining client alone on `join`, and to every
client in the channel on an `update`.

### Server → client

| `scope` | `type` | Meaning |
|---|---|---|
| `fs` | `changed` | A directory changed. `paths` lists the directories to refresh; `changes` optionally carries the exact added/updated/removed entries for an in-place patch |
| `tasks` | `snapshot` | Full task list, sent right after connect |
| `tasks` | `created` | A task was registered (full snapshot) |
| `tasks` | `update` | Progress patch: `state`, `progress`, `stats`, `canCancel` |
| `tasks` | `conflict` | The task is waiting for a decision: `destPath`, `isMove`, `totalCount`, `truncated`, `conflicts[]` |
| `tasks` | `done` | Terminal state, final `stats`, truncated `results[]`, `error` |
| `tasks` | `removed` | The task left the list |
| `settings` | `sync` | One key changed (`key`, `value`); a full snapshot is sent on connect |
| `measurements` | `progress` | A measurement's partial size/counts |
| `measurements` | `result` | A measurement finished (`complete: true`) or was interrupted |
| `text-sync` | `sync` | A channel's text: the reply to a `join`, and the broadcast of an `update` to everyone in that channel |
| any | `error` | The message could not be parsed, or a text-sync channel was rejected |

Reconnect contract: on connect the server replays the task snapshot, the pending
conflict of every paused task, and the full settings snapshot, so a client that was
disconnected does not miss state that only exists in push form.

## 12. Errors

Every non-2xx response has this body:

```json
{
  "code": "path_not_found",
  "message": "Path not found",
  "details": { "…": "optional, code-specific" }
}
```

- `message` is what the UI shows. It is a stable, user-facing sentence and never
  contains a server-side absolute path unless that path is the one the user asked
  about.
- `code` is what code branches on. Never branch on `message`.
- `details` is optional and only present when there is something structured to say
  (for example the existing entry behind a `409`).

### Error codes

| `code` | Status | Meaning |
|---|---|---|
| `bad_request` | 400 | The request could not be parsed |
| `invalid_path` | 400 | Relative, malformed or non-canonical path |
| `invalid_name` | 400 | A name (not a path) was malformed or reserved |
| `unsupported_task_kind` | 400 | Unknown `kind` on `POST /api/tasks` |
| `out_of_scope` | 400 | A task source or destination violates the task rules (missing source, destination inside the source) |
| `payload_too_large` | 413 | Request body above an endpoint's cap |
| `too_many_paths` | 400 | More paths than `POST /api/fs/entry-queries` accepts |
| `unauthorized` | 401 | No valid session |
| `forbidden` | 403 | Missing CSRF header on an unsafe method |
| `outside_allowed_roots` | 403 | The path is outside the configured `allowedRoots` |
| `not_found` | 404 | The resource does not exist |
| `path_not_found` | 404 | The filesystem path does not exist |
| `task_not_found` | 404 | Unknown task id |
| `measurement_not_found` | 404 | Unknown or expired measurement id |
| `method_not_allowed` | 405 | Wrong HTTP method for a path |
| `conflict` | 409 | Current state forbids the request (target exists, not a directory, task not awaiting a decision) |
| `task_finished` | 409 | The task is already in a terminal state |
| `precondition_failed` | 412 | `If-None-Match` / `If-Match` did not match |
| `unsupported_media` | 415 | Thumbnail: format not decodable |
| `media_too_large` | 422 | Thumbnail: source above the decode limit |
| `preview_disabled` | 422 | Thumbnail: the file is on optical media; show a type icon, do not fetch the original |
| `bitlocker_locked` | 423 | The volume is locked; `message` is the OS text telling the user where to unlock |
| `too_many_requests` | 429 | Login rate limit or failure ban |
| `feature_unavailable` | 501 | Capability off (no ffmpeg) |
| `server_busy` | 503 | Thumbnail decode slots exhausted |
| `network_unreachable` | 503 | A network location is unreachable; the response carries `Retry-After: 3` |
| `network_access_failed` | 503 | Another failure on a network location |
| `io_error` | 500 | Any other filesystem failure; the OS message is not echoed |
| `settings_failed` | 500 | The settings store could not be read or written |
| `internal_error` | 500 | Unexpected server error |

`404` and `503` are deliberately distinct: a network share that is offline must not
look like a deleted file. Only an explicit `ENOENT`/`ENOTDIR` produces
`path_not_found`.

## 13. Caching and conditional requests

| Endpoint | Validator | Client behavior |
|---|---|---|
| `GET /api/fs/content/{path}` | strong `ETag` = size + mtime; `Last-Modified` | `max-age=0, must-revalidate`; 304 on match; `Range` supported |
| `GET /api/fs/thumbnail/{path}` | strong `ETag` from kind, size, mtime | `private, max-age=0, must-revalidate`; 304 on match; the frontend also keeps a decoded copy in IndexedDB |
| Plugin assets | `ETag` from size, mtime and the injected SDK revision | `private, max-age=0, must-revalidate` |
| `GET /api/fs/directories/{path}` | **none** | Directory listings are not cached. They change without the directory mtime changing (a file's size or mtime), so any cheap validator would serve stale rows. Freshness comes from the `fs.changed` push and from explicit reloads |
| everything else | none | — |

The client must not append a timestamp query parameter to defeat the cache; if a stale
read is possible, a new request is the right answer and the validators above already
handle it.

## 14. Authentication and CSRF

- Login issues two cookies: `file_lite_auth_token` (HttpOnly, holds the JWT, never
  readable by scripts) and `file_lite_session` (readable, a random value used only for
  the double-submit check).
- The browser sends the auth cookie automatically. Scripts may use
  `Authorization: Bearer <jwt>` instead.
- Every unsafe method (anything but `GET`, `HEAD`, `OPTIONS`) that is authenticated by
  cookie must echo the readable session value in the `X-File-Lite-CSRF` header. A
  mismatch (or a missing header) is `403 forbidden`. A request authenticated by the
  `Authorization` header is exempt, because another site cannot make a browser send it.
- An auth cookie without its session partner is rejected: it is a leftover from a
  cleared or outdated login and would allow reads while every write fails.
- A rejected cookie pair is cleared on the `401` response so the browser stops
  replaying it.
- Login is the only endpoint with request-rate limiting, plus a 15-minute ban after 5
  failures. Authenticated calls are not capped: bulk listing and transfers must never
  be throttled by a request counter.

## 15. Deliberate exceptions

These do not follow the resource rules above, on purpose:

- **`/api/speed-test/download` and `/api/speed-test/upload`** are transport
  diagnostics, not resources. They are kept as they are (a byte stream in and out) and
  are not part of the resource model.
- **`/api/ws`** is a transport upgrade, not a resource.
- **`/api/host/reveals`** creates a side effect on the host machine, which has no
  representation, so the noun is the request itself.
- **`DELETE /api/server`** means "stop this process"; there is no representation to
  delete, but `DELETE` is closer to the truth than a `POST /shutdown`.
- **`POST /api/tasks/{id}/resolutions` and `/retries`** create sub-resources of a task
  rather than mutating the task in place, because both produce something new (a
  decision, a follow-up task) instead of a field change.
- **`PUT /api/fs/content/{path}` may answer with a different `Location`** when
  `keep-both` renamed the file or the server had to sanitize the name. The response
  body is authoritative.
- **`/ie/*` is a second, HTML-only surface** for old browsers (IE8 and
  friends): `GET /ie` (redirect to the first location), `GET|POST /ie/login`,
  `POST /ie/logout`, `GET /ie/browse?path=&page=`, `GET /ie/view?path=`,
  `GET /ie/download?path=`, `POST /ie/upload?path=`, `POST /ie/mkdir?path=`,
  `GET|POST /ie/rename?path=`, `GET|POST /ie/delete?path=`. It renders
  HTML instead of JSON, so it can only use GET and POST forms and it authenticates with
  the same session cookies; the logout form carries the session value in a `csrf` field
  instead of the `X-File-Lite-CSRF` header. It reuses the same internals (`authenticate`,
  `readDirEntries`, `serveFileContent`, `createDirectory`, `renameEntry`,
  `fileops.RemoveEntry`) and the same favourites key
  (`file_lite_stared_path`) as the app, but it deliberately does not follow the
  resource/verb rules above — it is a form-driven UI, not an API.
  A valid `?ticket=` is consumed server-side on `GET /ie`, `GET /ie/login` and the root
  `GET /` (so the login URL printed at startup works without JavaScript; a root request
  whose User-Agent contains `MSIE` or `Trident/` is sent on to `/ie` instead of the SPA).
  The app shell falls back on its own too: a browser that lacks the features the SPA needs,
  or a page that failed to load, is offered a link to `/ie` — with the query string intact,
  so a `?ticket=` survives — rather than being redirected, and `<noscript>` offers the same
  link when JavaScript is off.
  Ticket logins always issue a persistent cookie, because the ticket exists to sign
  another device in. `POST /ie/login` carries a `mode` field (`password` or `ticket`) so
  one form serves both, and the radio group is authoritative: with no `mode` the field
  that was filled in decides. A tiny inline script hides the field that is not selected
  (IE8 does not support `:checked`, which is why it is not done in CSS); with JavaScript
  off both fields stay visible and the radio alone decides.
  `POST /ie/upload?path=` takes one `files` field: the input carries `multiple`, which old
  browsers simply ignore, so the same form uploads many files at once or one at a time.
  Parts are read from a `multipart.Reader` and streamed straight into `PublishFile` (no
  temporary copy), the target directory comes from the query rather than a field so that
  reading fields cannot materialize the upload, and the `csrf` field must arrive before
  any file part — a file first is rejected instead of guessed. The answer is a 302 back to
  the directory with a one-line `notice`; files that already exist are skipped unless
  `?onConflict=overwrite` or `keep-both` is given, and a filename that is not valid UTF-8
  is decoded as GBK first, because IE sends filenames in the system code page.
  `POST /ie/mkdir`, `/ie/rename` and `/ie/delete` all take a `csrf` field and answer with
  the same kind of 302 + `notice`. Rename and delete render a confirmation page on `GET`
  (the per-row links in the list are GETs, so following one can never destroy anything),
  and delete refuses a location root — a drive, a mount point, or a syntactic root. The
  rename and delete rules are the ones the JSON API already uses; the delete itself is
  `fileops.RemoveEntry`, the same implementation the task queue calls, so a symlink or a
  hard link is removed without following it.
  Those same endpoints, plus `/ie/upload`, carry the `page` the caller was on (the links
  and form actions are rendered with it) and answer with a redirect back to that page; a
  `page` that no longer exists is a 302 to the last one that does, with the `notice` kept,
  rather than an empty listing.
  `GET /ie/view` serves a file inline (`serveFileContent` without the attachment header)
  and `GET /ie/download` serves it as an attachment; a directory is packed into
  `<name>.zip` by `downloadMulti`, the same implementation `GET /api/fs/downloads` uses.
  A row's file name links to the viewer with `target="_blank"`, so clicking opens the file
  in a new window instead of saving it, and every row — folders included — carries its own
  Download link in the actions column.
  A listing renders Up only when its parent still resolves — that is the same check the
  request itself would go through — so navigation can climb to the allowed root but is
  never offered a step outside it, and a listed location (a drive or a mount point) is
  not a stop on the way up. The sidebar marks the current location by comparing paths as
  locations (`fileops.SamePath`) rather than as strings, because a favourite is stored
  with the trailing slash a canonical browse path does not have.

## 16. Change policy

Adding, changing or removing an endpoint requires all of the following in one commit:

1. The handler and its route registration in `backend-go/routes`.
2. The route table and endpoint reference in this document.
3. The client wrapper in `frontend/src/api` and, when the shape is shared, the type in
   `frontend/src/types/server.ts`.
4. A Go test next to the handler for the status codes and the error `code`.
5. An entry in `CHANGELOG.md` when a user can perceive the change.

Since the two halves are always released together, "keep the old route for one
release" is never the answer: change both sides and delete what is gone.
