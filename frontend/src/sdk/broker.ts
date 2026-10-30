import type {
  SdkBinary,
  SdkEntry,
  SdkHostContext,
  SdkLaunch,
  SdkMethod,
  SdkTextFile,
  SdkWriteOptions,
  SdkWriteResult,
} from './contract'
import type { IEntry } from '@/types/server'
import type { FsTextFile, FsWriteOptions, FsWriteResult } from '@/utils/fs'
import { joinPath, normalizePath } from '../utils/path/form'

/** A flat request payload, shared by both transports. */
export interface SdkInvokePayload {
  path?: string
  /** `ArrayBuffer` over the wire, any binary `BlobPart` in process. */
  data?: BlobPart
  options?: SdkWriteOptions
  launch?: Partial<SdkLaunch>
  title?: string
  names?: string[]
  name?: string
}

export interface SdkBroker {
  invoke: (method: SdkMethod | string, payload: SdkInvokePayload) => Promise<unknown>
}

function isBinaryData(data: unknown): data is SdkBinary {
  return data instanceof ArrayBuffer
    || (ArrayBuffer.isView(data) && !(data.buffer instanceof SharedArrayBuffer))
    || data instanceof Blob
}

/** The slice of the file facade the SDK needs; tests pass a fake. */
export interface SdkFileApi {
  list: (path: string) => Promise<IEntry[]>
  readBlob: (path: string) => Promise<Blob>
  readTextFile: (path: string) => Promise<FsTextFile>
  writeFile: (dirPath: string, name: string, data: BlobPart, options?: FsWriteOptions) => Promise<FsWriteResult>
  url: (path: string) => string
}

export function dirOf(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  if (cut > 0) {
    return trimmed.slice(0, cut)
  }
  return trimmed || path
}

export function baseOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * A directory listing entry in SDK shape. The full path comes from the directory
 * plus the name (the same value `fs.list` returns in `entry.path`), so both
 * transports and the file manager agree on the identity of a row.
 */
export function toSdkEntry(directory: string, entry: IEntry): SdkEntry {
  return {
    name: entry.name,
    // The listing already carries the canonical path; only a caller-built entry
    // (the launch payload) has to be joined by hand.
    path: entry.path || normalizePath(joinPath(directory, entry.name)),
    ext: entry.ext,
    isDirectory: entry.isDirectory,
    ...(entry.isLink == null ? {} : { isLink: entry.isLink }),
    ...(entry.hidden == null ? {} : { hidden: entry.hidden }),
    size: entry.size,
    lastModified: entry.lastModified,
    ...(entry.birthtime == null ? {} : { birthtime: entry.birthtime }),
  }
}

function emptyLaunch(): SdkLaunch {
  return { path: '', filename: '', directory: '', entries: [] }
}

function mergeLaunch(current: SdkLaunch | null, patch: Partial<SdkLaunch> | undefined): SdkLaunch {
  const base = current ?? emptyLaunch()
  const next: SdkLaunch = {
    path: patch?.path ?? base.path,
    filename: patch?.filename ?? base.filename,
    directory: patch?.directory ?? base.directory,
    entries: patch?.entries ?? base.entries,
  }
  if (patch?.path != null && patch.filename == null) {
    next.filename = baseOf(next.path)
  }
  if (patch?.path != null && patch.directory == null) {
    next.directory = dirOf(next.path)
  }
  return next
}

/**
 * Method dispatch over `fs`, the window manager and the explorer bus. Both
 * transports call this; no transport-specific behaviour lives here.
 */
export function createSdkBroker(host: SdkHostContext, files: SdkFileApi): SdkBroker {
  async function list(path: string): Promise<SdkEntry[]> {
    const entries = await files.list(path)
    return entries.map(entry => toSdkEntry(path, entry))
  }

  async function readFile(path: string): Promise<ArrayBuffer> {
    const blob = await files.readBlob(path)
    return await blob.arrayBuffer()
  }

  async function readText(path: string): Promise<SdkTextFile> {
    return await files.readTextFile(path)
  }

  async function writeFile(
    path: string,
    data: unknown,
    options: SdkWriteOptions = {},
  ): Promise<SdkWriteResult> {
    // Both transports reject here, so a plugin and a built-in app cannot end up
    // with different ideas of what a valid write is. Writing nothing would
    // truncate the file, and a string would be stored as UTF-8 regardless of
    // `options.charset`.
    if (!path) {
      throw new TypeError('writeFile needs a path')
    }
    if (!isBinaryData(data)) {
      throw new TypeError('writeFile needs an ArrayBuffer, a typed array or a Blob')
    }
    const written = await files.writeFile(dirOf(path), baseOf(path), data, {
      // Saving a document overwrites it unless the caller asks for another policy.
      conflict: options.conflict ?? 'overwrite',
      charset: options.charset,
      onProgress: options.onProgress,
    })
    if (!written.ok) {
      throw new Error(written.reason ?? 'failed')
    }
    return {
      path: written.path ?? path,
      name: written.name ?? baseOf(path),
    }
  }

  function getLaunch(): SdkLaunch | null {
    return host.getLaunch()
  }

  async function updateLaunch(patch: Partial<SdkLaunch> | undefined): Promise<void> {
    host.setLaunch(mergeLaunch(host.getLaunch(), patch))
  }

  return {
    async invoke(method, payload) {
      const path = String(payload.path ?? '')
      switch (method) {
        case 'list':
          return await list(path)
        case 'readFile':
          return await readFile(path)
        case 'readText':
          return await readText(path)
        case 'writeFile':
          return await writeFile(path, payload.data, payload.options)
        case 'url':
          return files.url(path)
        case 'getLaunch':
          return getLaunch()
        case 'updateLaunch':
          await updateLaunch(payload.launch)
          return undefined
        case 'exit':
          host.close()
          return undefined
        case 'setTitle':
          host.setTitle(String(payload.title ?? ''))
          return undefined
        case 'selectItems':
          host.selectItems(Array.isArray(payload.names) ? payload.names.map(String) : [])
          return undefined
        case 'revealItem':
          host.revealItem(String(payload.name ?? ''))
          return undefined
        default:
          throw new Error('unknown method')
      }
    },
  }
}
