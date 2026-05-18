export interface IEntry {
  name: string
  ext: string
  isDirectory: boolean
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

export interface TextSyncClientMessage {
  type: 'join'
    | 'update'
  channel: TextSyncChannel
  text?: string
}

export interface TextSyncErrorMessage {
  type: 'error'
  message: string
}

export interface TextSyncSyncMessage {
  type: 'sync'
  channel: TextSyncChannel
  text: string
}

export type TextSyncServerMessage = TextSyncSyncMessage | TextSyncErrorMessage
