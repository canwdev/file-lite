export interface IEntry {
  name: string
  /**
   * canonical 形态的完整路径（正斜杠），由服务端给出。
   *
   * 递归平铺列表里 `name` 是 basename，相对被列出目录的路径在 `relativePath`；
   * 需要落到文件系统的路径一律用这个字段，不要再把目录和 name 拼起来。
   */
  path: string
  /** 仅递归平铺列表有值：相对被列出目录的路径。 */
  relativePath?: string
  ext: string
  isDirectory: boolean
  /** 是否为链接：符号链接 / Windows 目录链接（junction）/ 硬链接 */
  isLink?: boolean
  hidden: boolean
  lastModified: number
  birthtime: number
  size: number | null
  error: string | null
}

/** 侧边栏里的一个可导航位置。 */
export type DriveKind = 'volume' | 'network' | 'home' | 'locked' | 'optical'

export interface IDrive {
  label: string
  path: string
  /** 缺省视为 volume（老后端不带这个字段）。 */
  kind?: DriveKind
  /** 操作系统报的文件系统名（ext4、NTFS、9p、iso9660）。Home 与读不到时没有。 */
  fileSystem?: string
  free?: number
  total?: number
}

export enum SortType {
  default = 'default',
  name = 'name',
  nameDesc = 'nameDesc',
  size = 'size',
  sizeDesc = 'sizeDesc',
  extension = 'extension',
  extensionDesc = 'extensionDesc',
  lastModified = 'lastModified',
  lastModifiedDesc = 'lastModifiedDesc',
  birthTime = 'birthTime',
  birthTimeDesc = 'birthTimeDesc',
}

export const TEXT_SYNC_CHANNELS = ['CH1', 'CH2', 'CH3'] as const
export type TextSyncChannel = (typeof TEXT_SYNC_CHANNELS)[number]

export type WsScope = 'settings' | 'text-sync' | 'tasks' | 'fs' | 'properties' | 'ws'

export interface TextSyncJoinMessage {
  scope: 'text-sync'
  type: 'join'
  channel: TextSyncChannel
}

export interface TextSyncUpdateMessage {
  scope: 'text-sync'
  type: 'update'
  channel: TextSyncChannel
  text?: string
}

export type TextSyncClientMessage = TextSyncJoinMessage | TextSyncUpdateMessage

export interface WsErrorMessage {
  scope: WsScope
  type: 'error'
  message: string
}

export interface TextSyncSyncMessage {
  scope: 'text-sync'
  type: 'sync'
  channel: TextSyncChannel
  text: string
}

export type TextSyncServerMessage = TextSyncSyncMessage | WsErrorMessage

export interface SettingsSyncMessage {
  scope: 'settings'
  type: 'sync'
  key: string
  value: unknown | null
}

export type SettingsServerMessage = SettingsSyncMessage | WsErrorMessage

/* ------------------------------------------------------------------ *
 * 异步文件操作任务（scope: "tasks"）
 * ------------------------------------------------------------------ */

export type TaskKind = 'copy' | 'move' | 'delete' | 'duplicate' | 'compress' | 'extract'

export type TaskState
  = | 'queued'
    | 'scanning'
    | 'awaiting-conflict'
    | 'running'
    | 'succeeded'
    | 'partial'
    | 'failed'
    | 'cancelled'

export type ConflictPolicy = 'ask' | 'overwrite' | 'skip' | 'keep-both'

export type TaskItemStatus
  = | 'copied'
    | 'moved'
    | 'deleted'
    | 'replaced'
    | 'skipped'
    | 'renamed'
    | 'failed'
    | 'conflict'

export interface TaskProgress {
  itemsTotal: number
  itemsDone: number
  bytesTotal: number
  bytesDone: number
  /** Set when 7-Zip has not emitted a percentage yet. */
  indeterminate?: boolean
  currentPath?: string
}

export interface TaskStats {
  succeeded: number
  skipped: number
  renamed: number
  failed: number
  conflict: number
}

export interface TaskSnapshot {
  id: string
  kind: TaskKind
  state: TaskState
  fromPaths: string[]
  toPath?: string
  isMove: boolean
  progress: TaskProgress
  stats: TaskStats
  error?: string
  canCancel: boolean
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export type ConflictKind = 'file-vs-file' | 'file-vs-dir' | 'dir-vs-file'

export interface TaskConflictItem {
  relativePath: string
  kind: ConflictKind
  sourceIsDirectory: boolean
  destIsDirectory: boolean
  sourceSize?: number
  destSize?: number
  sourceMtime?: number
  destMtime?: number
}

export interface TaskItemResult {
  fromPath: string
  toPath?: string
  status: TaskItemStatus
  message?: string
}

export interface TaskCreatePayload {
  kind: TaskKind
  fromPaths: string[]
  toPath?: string
  onConflict?: ConflictPolicy
  /** Compress type id, for example `zip` or `7z`. */
  format?: string
  /** Optional archive password. It is not stored on the task snapshot. */
  password?: string
  /** Extract each archive into a subfolder named after it. */
  intoFolder?: boolean
}

export interface TasksSnapshotMessage {
  scope: 'tasks'
  type: 'snapshot'
  tasks: TaskSnapshot[]
}

/** 新任务登记：所有客户端都会收到，用来把任务加进列表。 */
export interface TasksCreatedMessage {
  scope: 'tasks'
  type: 'created'
  task: TaskSnapshot
}

export interface TasksUpdateMessage {
  scope: 'tasks'
  type: 'update'
  taskId: string
  patch: Partial<Pick<TaskSnapshot, 'state' | 'progress' | 'stats' | 'canCancel'>>
}

export interface TasksConflictMessage {
  scope: 'tasks'
  type: 'conflict'
  taskId: string
  destPath: string
  isMove: boolean
  totalCount: number
  truncated: boolean
  conflicts: TaskConflictItem[]
}

export interface TasksDoneMessage {
  scope: 'tasks'
  type: 'done'
  taskId: string
  state: TaskState
  stats: TaskStats
  results: TaskItemResult[]
  resultsTruncated: boolean
  error?: string
}

export interface TasksRemovedMessage {
  scope: 'tasks'
  type: 'removed'
  taskId: string
}

export type TasksServerMessage
  = | TasksSnapshotMessage
    | TasksCreatedMessage
    | TasksUpdateMessage
    | TasksConflictMessage
    | TasksDoneMessage
    | TasksRemovedMessage
    | WsErrorMessage

/** 目录里发生的条目级变化，客户端据此原地改列表而不整目录刷新。 */
export interface FsDirChange {
  dir: string
  /** 新增 / 改名后的条目（按名字 upsert） */
  added?: IEntry[]
  /** 覆盖已有条目，size / mtime 变了（同样按名字 upsert） */
  updated?: IEntry[]
  /** 被删除的名字 */
  removed?: string[]
}

/** 目录变化通知（scope: "fs"），用于取代跨实例的 moveRefresh 补丁。 */
export interface FsChangedMessage {
  scope: 'fs'
  type: 'changed'
  paths: string[]
  /** 有它就能原地打补丁；没有则退回整目录刷新 */
  changes?: FsDirChange[]
}

export type FsServerMessage = FsChangedMessage | WsErrorMessage

/**
 * 目录大小测量（scope: "measurements"）。
 *
 * 命令走 HTTP（`POST /api/fs/measurements`），`progress` 是目录的即时信息
 * （名字 / 时间，大小还没算出来），`result` 是终态：文件在建的时候就已经是 result，
 * 目录由服务端后台递归统计完再推。
 */
export interface MeasurementsMessage {
  scope: 'measurements'
  type: 'progress' | 'result'
  id: string
  path: string
  name: string
  ext: string
  isDirectory: boolean
  isLink: boolean
  size: number
  fileCount: number | null
  folderCount: number | null
  lastModified: number
  birthtime: number
  complete: boolean
}

export type MeasurementsServerMessage = MeasurementsMessage | WsErrorMessage

export type SharedWsClientMessage
  = | TextSyncClientMessage
export type SharedWsServerMessage
  = | TextSyncServerMessage
    | SettingsServerMessage
    | TasksServerMessage
    | FsServerMessage
    | MeasurementsServerMessage
