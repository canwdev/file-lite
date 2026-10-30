/**
 * The one host-facing API shared by plugins (iframe) and built-in apps
 * (in-process). This module is plain TypeScript: no Vue, no DOM, no imports
 * from the app shell, so both transports and the unit tests can use it.
 *
 * See backend-go/file-lite/sdk-unification/contract.md for the written contract.
 */

export const SDK_VERSION = 2

/** `postMessage` source tags. They are part of the wire contract. */
export const SDK_SOURCE_PLUGIN = 'file-lite-plugin'
export const SDK_SOURCE_HOST = 'file-lite-host'

/** Same value as `fsWebApi.getStreamUrl`; the iframe client builds it locally. */
export const STREAM_URL_PREFIX = '/api/fs/content/'

export const SDK_METHODS = [
  'list',
  'readFile',
  'readText',
  'writeFile',
  'url',
  'getLaunch',
  'updateLaunch',
  'exit',
  'setTitle',
  'selectItems',
  'revealItem',
] as const

export type SdkMethod
  = | 'list'
    | 'readFile'
    | 'readText'
    | 'writeFile'
    | 'url'
    | 'getLaunch'
    | 'updateLaunch'
    | 'exit'
    | 'setTitle'
    | 'selectItems'
    | 'revealItem'

/** What `writeFile` accepts: bytes, never a string (a string has no encoding). */
export type SdkBinary = ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob

export type SdkConflictPolicy = 'error' | 'overwrite' | 'keep-both' | 'skip'

export interface SdkEntry {
  name: string
  path: string
  ext: string
  isDirectory: boolean
  isLink?: boolean
  hidden?: boolean
  /** `null` for a directory. */
  size: number | null
  /** Timestamp in milliseconds. */
  lastModified: number
  birthtime?: number
}

export interface SdkLaunch {
  /** Full path of the opened target, `''` when there is none. */
  path: string
  /** Basename of `path`, `''` when there is none. */
  filename: string
  /** Parent directory used by `selectItems` / `revealItem`. */
  directory: string
  /** Listing of `directory` captured when the window opened. */
  entries: SdkEntry[]
}

/** Push payload for `onOpen`. `undefined` when the window has no file. */
export interface SdkOpenEvent {
  path: string
  filename: string
  directory: string
}

export interface SdkWriteOptions {
  /** Default `overwrite`: saving a document replaces it. */
  conflict?: SdkConflictPolicy
  /** Disk encoding to write back, from `readText().charset`. */
  charset?: string
  /** Upload progress in bytes. Apps only; never sent over `postMessage`. */
  onProgress?: (loaded: number) => void
}

export interface SdkWriteResult {
  /** Real path (a `keep-both` write may rename). */
  path: string
  /** Real file name. */
  name: string
}

export interface SdkTextFile {
  text: string
  /** Empty string when the server did not treat the file as text. */
  charset: string
}

/** Host capabilities the broker cannot implement by itself. */
export interface SdkHostContext {
  getLaunch: () => SdkLaunch | null
  setLaunch: (launch: SdkLaunch) => void
  close: () => void
  setTitle: (title: string) => void
  selectItems: (names: string[]) => void
  revealItem: (name: string) => void
}

/** The client object handed to built-in apps and exposed as `window.fileLiteSDK`. */
export interface FileLiteSdk {
  readonly version: typeof SDK_VERSION

  list: (path: string) => Promise<SdkEntry[]>
  readFile: (path: string) => Promise<ArrayBuffer>
  readText: (path: string) => Promise<SdkTextFile>
  writeFile: (path: string, data: SdkBinary, options?: SdkWriteOptions) => Promise<SdkWriteResult>
  url: (path: string) => string

  getLaunch: () => Promise<SdkLaunch | null>
  onOpen: (callback: (launch: SdkOpenEvent | undefined) => void) => void
  updateLaunch: (launch: Partial<SdkLaunch>) => Promise<void>
  setTitle: (title: string) => Promise<void>
  exit: () => Promise<void>
  selectItems: (names: string[]) => Promise<void>
  revealItem: (name: string) => Promise<void>
}

/** A flat plugin request, exactly as it travels over `postMessage`. */
export interface SdkRequest {
  source: typeof SDK_SOURCE_PLUGIN
  id: number
  method: string
  path?: string
  data?: ArrayBuffer
  options?: SdkWriteOptions
  launch?: Partial<SdkLaunch>
  title?: string
  names?: string[]
  name?: string
}

/** A host reply, exactly as it travels over `postMessage`. */
export interface SdkResponse {
  source: typeof SDK_SOURCE_HOST
  id: number
  data?: unknown
  error?: string
}

/** Host push, exactly as it travels over `postMessage`. */
export interface SdkOpenMessage {
  source: typeof SDK_SOURCE_HOST
  event: 'open'
  path?: string
  filename?: string
  /** Parent directory of `path`. */
  directory?: string
}
