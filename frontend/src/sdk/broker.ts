import type {
  SdkBinary,
  SdkEntry,
  SdkHostContext,
  SdkLaunch,
  SdkListOptions,
  SdkMethod,
  SdkMkdirOptions,
  SdkPickMode,
  SdkPickOptions,
  SdkRenameResult,
  SdkTextFile,
  SdkWriteOptions,
  SdkWriteResult,
} from './contract'
import type { IEntry } from '@/types/server'
import type { FsRenameResult, FsTextFile, FsWriteOptions, FsWriteResult } from '@/utils/fs'
import { joinPath, normalizePath } from '../utils/path/form'

/** A flat request payload, shared by both transports. */
export interface SdkInvokePayload {
  path?: string
  paths?: string[]
  /** `ArrayBuffer` over the wire, any binary `BlobPart` in process. */
  data?: BlobPart
  options?: SdkWriteOptions | SdkListOptions | SdkMkdirOptions
  launch?: Partial<SdkLaunch>
  title?: string
  names?: string[]
  name?: string
  pick?: SdkPickOptions
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
  list: (path: string, options?: SdkListOptions) => Promise<IEntry[]>
  readBlob: (path: string) => Promise<Blob>
  readTextFile: (path: string) => Promise<FsTextFile>
  writeFile: (dirPath: string, name: string, data: BlobPart, options?: FsWriteOptions) => Promise<FsWriteResult>
  rename: (fromPath: string, toPath: string) => Promise<FsRenameResult>
  existingPaths: (paths: string[]) => Promise<string[]>
  stat: (path: string) => Promise<IEntry>
  mkdir: (path: string, options?: SdkMkdirOptions) => Promise<void>
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

/** Parent directory, including `/` for a file at the filesystem root. */
function parentOf(path: string) {
  const normalized = path.replace(/\/+$/, '')
  const cut = normalized.lastIndexOf('/')
  if (cut > 0)
    return normalized.slice(0, cut)
  return cut === 0 ? '/' : normalized || path
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
  return { path: '', filename: '', directory: '', entries: [], kind: null, selection: [] }
}

function mergeLaunch(current: SdkLaunch | null, patch: Partial<SdkLaunch> | undefined): SdkLaunch {
  const base = current ?? emptyLaunch()
  const next: SdkLaunch = {
    path: patch?.path ?? base.path,
    filename: patch?.filename ?? base.filename,
    directory: patch?.directory ?? base.directory,
    entries: patch?.entries ?? base.entries,
    kind: patch?.kind ?? base.kind,
    selection: patch?.selection ?? base.selection,
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
  async function list(path: string, options: SdkListOptions = {}): Promise<SdkEntry[]> {
    const entries = await files.list(path, options)
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

  function rename(path: string, newName: string): Promise<SdkRenameResult> {
    if (!path) {
      throw new TypeError('rename needs a path')
    }
    const name = newName.trim()
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      throw new TypeError('rename needs a valid name')
    }
    const target = normalizePath(joinPath(parentOf(path), name))
    return files.rename(path, target).then((result) => {
      return { path: result.path, name: result.name }
    })
  }

  async function stat(path: string): Promise<SdkEntry> {
    if (!path) {
      throw new TypeError('stat needs a path')
    }
    return toSdkEntry(dirOf(path), await files.stat(path))
  }

  async function mkdir(path: string, options: SdkMkdirOptions = {}): Promise<void> {
    if (!path) {
      throw new TypeError('mkdir needs a path')
    }
    await files.mkdir(path, options)
  }

  async function exists(paths: string[]): Promise<string[]> {
    return await files.existingPaths(paths)
  }

  const PICK_MODES: readonly SdkPickMode[] = ['file', 'files', 'folder', 'save']

  async function pick(options: SdkPickOptions | undefined) {
    const mode = options?.mode ?? 'file'
    if (!PICK_MODES.includes(mode)) {
      throw new TypeError(`unknown pick mode: ${String(mode)}`)
    }
    return await host.pick({ ...options, mode })
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
          return await list(path, payload.options as SdkListOptions | undefined)
        case 'readFile':
          return await readFile(path)
        case 'readText':
          return await readText(path)
        case 'writeFile':
          return await writeFile(path, payload.data, payload.options as SdkWriteOptions | undefined)
        case 'rename':
          return await rename(path, String(payload.name ?? ''))
        case 'exists':
          return await exists(Array.isArray(payload.paths) ? payload.paths.map(String) : [])
        case 'stat':
          return await stat(path)
        case 'mkdir':
          return await mkdir(path, payload.options as SdkMkdirOptions | undefined)
        case 'pick':
          return await pick(payload.pick)
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
