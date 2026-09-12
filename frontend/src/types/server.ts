export interface IEntry {
  name: string
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

export interface IDrive {
  label: string
  path: string
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

export type WsScope = 'settings' | 'text-sync' | 'tasks' | 'fs' | 'ws'

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
  requestId?: string
}

export interface TextSyncSyncMessage {
  scope: 'text-sync'
  type: 'sync'
  channel: TextSyncChannel
  text: string
}

export type TextSyncServerMessage = TextSyncSyncMessage | WsErrorMessage

export interface SettingsGetMessage {
  scope: 'settings'
  type: 'get'
  requestId: string
  key: string
}

export interface SettingsSetMessage {
  scope: 'settings'
  type: 'set'
  requestId: string
  key: string
  value: unknown
}

export interface SettingsDeleteMessage {
  scope: 'settings'
  type: 'delete'
  requestId: string
  key: string
}

export type SettingsClientMessage = SettingsGetMessage | SettingsSetMessage | SettingsDeleteMessage

export interface SettingsResponseMessage {
  scope: 'settings'
  type: 'response'
  requestId: string
  action: 'get' | 'set' | 'delete'
  key: string
  value: unknown | null
}

export interface SettingsSyncMessage {
  scope: 'settings'
  type: 'sync'
  key: string
  value: unknown | null
}

export type SettingsServerMessage = SettingsResponseMessage | SettingsSyncMessage | WsErrorMessage

/* ------------------------------------------------------------------ *
 * 异步文件操作任务（scope: "tasks"）
 * ------------------------------------------------------------------ */

export type TaskKind = 'copy' | 'move' | 'delete' | 'duplicate'

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
}

export interface TasksCreateMessage {
  scope: 'tasks'
  type: 'create'
  requestId: string
  task: TaskCreatePayload
}

export interface TasksCancelMessage {
  scope: 'tasks'
  type: 'cancel'
  taskId: string
}

export interface TasksDismissMessage {
  scope: 'tasks'
  type: 'dismiss'
  taskId: string
}

export interface TasksResolveMessage {
  scope: 'tasks'
  type: 'resolve'
  taskId: string
  policy?: ConflictPolicy
  applyToAll?: boolean
  items?: { relativePath: string, policy: ConflictPolicy }[]
}

export interface TasksListMessage {
  scope: 'tasks'
  type: 'list'
  requestId: string
}

/** 用失败 / 冲突的条目重新创建一个任务（路径由服务端从完整结果里取）。 */
export interface TasksRetryMessage {
  scope: 'tasks'
  type: 'retry'
  requestId: string
  taskId: string
}

export type TasksClientMessage
  = | TasksCreateMessage
    | TasksCancelMessage
    | TasksDismissMessage
    | TasksResolveMessage
    | TasksListMessage
    | TasksRetryMessage

export interface TasksResponseMessage {
  scope: 'tasks'
  type: 'response'
  requestId: string
  taskId: string
}

export interface TasksSnapshotMessage {
  scope: 'tasks'
  type: 'snapshot'
  tasks: TaskSnapshot[]
  requestId?: string
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
  = | TasksResponseMessage
    | TasksSnapshotMessage
    | TasksCreatedMessage
    | TasksUpdateMessage
    | TasksConflictMessage
    | TasksDoneMessage
    | TasksRemovedMessage
    | WsErrorMessage

/** 目录变化通知（scope: "fs"），用于取代跨实例的 moveRefresh 补丁。 */
export interface FsChangedMessage {
  scope: 'fs'
  type: 'changed'
  paths: string[]
}

export type FsServerMessage = FsChangedMessage | WsErrorMessage

export type SharedWsClientMessage = TextSyncClientMessage | SettingsClientMessage | TasksClientMessage
export type SharedWsServerMessage
  = | TextSyncServerMessage
    | SettingsServerMessage
    | TasksServerMessage
    | FsServerMessage
