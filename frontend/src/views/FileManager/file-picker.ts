import type { SdkPickMode, SdkPickOptions, SdkPickResult } from '../../sdk/contract'
import type { FileSelectResult } from './types'
import { shallowRef } from 'vue'
import { toSdkEntry } from '../../sdk/broker'
import { normalizeListingPath } from '../../utils/path/form'

/**
 * The one file picker of the application.
 *
 * Every caller — a built-in app, a plugin through the SDK, a toolbar button —
 * goes through `openFilePicker`, and `FilePickerHost.vue` (mounted once by
 * `FileLite.vue`) renders it. One instance means one dialog, one shortcut scope,
 * and one place that maps the picker's result into the SDK shape.
 */
export interface FilePickerRequest {
  /** Increases on every request; the dialog resets its own inputs when it changes. */
  id: number
  mode: SdkPickMode
  title?: string
  extensions?: string[]
  defaultName?: string
  startPath: string
}

interface PendingPick {
  request: FilePickerRequest
  resolve: (result: SdkPickResult | null) => void
}

let pickSequence = 0

/** The request the host component is currently showing; `null` when closed. */
export const pendingPick = shallowRef<PendingPick | null>(null)

export function isPickerOpen(): boolean {
  return pendingPick.value !== null
}

/**
 * Ask the user for files, a folder or a save target.
 *
 * Resolves `null` when the dialog is cancelled, or when a newer request replaces
 * this one (a caller that asks twice cannot leave the first promise hanging).
 */
export function openFilePicker(
  options: SdkPickOptions = {},
  fallbackDirectory = '',
): Promise<SdkPickResult | null> {
  settlePending(null)
  pickSequence += 1
  const startPath = options.startPath || fallbackDirectory
  return new Promise((resolve) => {
    pendingPick.value = {
      request: {
        id: pickSequence,
        mode: options.mode ?? 'file',
        title: options.title,
        extensions: options.extensions,
        defaultName: options.defaultName,
        startPath: startPath ? normalizeListingPath(startPath) : '',
      },
      resolve,
    }
  })
}

/** Close the dialog; `result` is what the waiting caller receives. */
export function settlePending(result: SdkPickResult | null) {
  const pending = pendingPick.value
  pendingPick.value = null
  pending?.resolve(result)
}

/** The picker's own result in SDK shape. */
export function toPickResult(
  result: FileSelectResult,
  mode: SdkPickMode,
  directory: string,
): SdkPickResult {
  if (mode === 'save') {
    const name = (result.name ?? '').trim()
    return {
      items: [],
      directory,
      path: name ? `${directory.replace(/\/+$/, '')}/${name}` : '',
      name,
    }
  }
  if (mode === 'folder') {
    return { items: [], directory, path: directory, name: '' }
  }
  const items = (result.items ?? []).map(entry => toSdkEntry(directory, entry))
  const first = mode === 'file' ? items[0] : undefined
  return {
    items,
    directory,
    path: first?.path ?? '',
    name: first?.name ?? '',
  }
}
