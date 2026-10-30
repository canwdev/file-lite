import type { AppParams } from './apps'
import type { SdkEntry, SdkLaunch, SdkOpenEvent } from '@/sdk/contract'
import type { IEntry } from '@/types/server'
import { baseOf, dirOf, toSdkEntry } from '@/sdk/broker'
import { getFileExt } from './apps'

/** The window launch state in SDK shape, derived from the legacy app params. */
export function launchFromParams(params: AppParams | undefined): SdkLaunch {
  const path = params?.absPath ?? ''
  const directory = params?.basePath || (path ? dirOf(path) : '')
  return {
    path,
    filename: path ? (params?.item?.name || baseOf(path)) : '',
    directory,
    entries: (params?.list ?? []).map(entry => toSdkEntry(directory, entry)),
  }
}

export function openEventFromParams(params: AppParams | undefined): SdkOpenEvent | undefined {
  const path = params?.absPath
  if (!path) {
    return undefined
  }
  return {
    path,
    filename: params?.item?.name || baseOf(path),
    directory: params?.basePath || dirOf(path),
  }
}

/** The SDK entry in the file manager's own shape (Properties and the gallery need it). */
export function sdkEntryToIEntry(entry: SdkEntry): IEntry {
  return {
    name: entry.name,
    path: entry.path,
    ext: entry.ext,
    isDirectory: entry.isDirectory,
    isLink: entry.isLink,
    hidden: entry.hidden ?? false,
    lastModified: entry.lastModified,
    birthtime: entry.birthtime ?? 0,
    size: entry.size,
    error: null,
  }
}

function syntheticEntry(launch: SdkLaunch): IEntry {
  return {
    name: launch.filename || baseOf(launch.path),
    path: launch.path,
    ext: getFileExt(launch.filename),
    isDirectory: false,
    hidden: false,
    lastModified: 0,
    birthtime: 0,
    size: null,
    error: null,
  }
}

/**
 * Write an SDK launch back into the legacy window data. This is the transitional
 * bridge used while built-in apps still receive `appParams`; it disappears with
 * them.
 */
export function paramsFromLaunch(launch: SdkLaunch, previous: AppParams): AppParams {
  const list = launch.entries.map(sdkEntryToIEntry)
  const item = launch.path
    ? (list.find(entry => entry.path === launch.path) ?? syntheticEntry(launch))
    : previous.item
  return {
    absPath: launch.path,
    item,
    basePath: launch.directory,
    list,
  }
}
