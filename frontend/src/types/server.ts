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

export type WsScope = 'settings' | 'text-sync' | 'ws'

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

export type SharedWsClientMessage = TextSyncClientMessage | SettingsClientMessage
export type SharedWsServerMessage = TextSyncServerMessage | SettingsServerMessage
