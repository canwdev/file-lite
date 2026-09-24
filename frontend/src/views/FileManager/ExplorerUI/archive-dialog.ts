import type { ArchiveCompressFormat } from '@/store/capabilities'
import { ElCheckbox, ElInput, ElOption, ElRadio, ElRadioGroup, ElSelect } from 'element-plus'
import { h, reactive } from 'vue'
import { serverCapabilities } from '@/store/capabilities'
import { createTask } from '@/store/tasks'
import { focusNameField } from '@/views/FileManager/ExplorerUI/input-prompt.ts'

export interface CompressPromptResult {
  /** Destination file name, including the format extension. Empty when `separate` is set. */
  name: string
  format: string
  ext: string
  password: string
  /** One archive per selected item, named `prefix` + that item's stem + extension. */
  separate: boolean
  /** Optional text prepended to each item name when `separate` is set. */
  prefix: string
}

export interface ExtractPromptResult {
  password: string
  intoFolder: boolean
}

function archiveNameError(name: string, optional = false) {
  const trimmed = name.trim()
  if (!trimmed)
    return optional ? '' : 'Archive name is required'
  if (trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed))
    return 'Invalid archive name'
  if (trimmed.startsWith('.fl-part-'))
    return 'Invalid archive name'
  return ''
}

export function entryBaseName(name: string) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  return slash < 0 ? name : name.slice(slash + 1)
}

export function matchesExtractExtension(name: string, extensions: string[]) {
  const lower = entryBaseName(name).toLowerCase()
  const sorted = [...extensions].sort((a, b) => b.length - a.length)
  return sorted.some(ext => ext && lower.endsWith(ext.toLowerCase()))
}

/** Drop the longest probed archive extension, otherwise the last suffix. */
export function archiveStem(name: string, extensions: string[]) {
  const base = entryBaseName(name)
  const lower = base.toLowerCase()
  const sorted = [...extensions].sort((a, b) => b.length - a.length)
  const ext = sorted.find(item => item && lower.endsWith(item.toLowerCase()) && item.length < base.length)
  if (ext)
    return base.slice(0, base.length - ext.length)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Suggested archive name without the format extension. */
export function defaultArchiveStem(names: string[], directoryName: string) {
  if (names.length === 1)
    return archiveStem(names[0], [])
  const dir = directoryName.trim()
  const prefix = dir && !archiveNameError(dir) ? dir : 'Archive'
  return `${prefix}-${archiveStamp()}`
}

export function withFormatExt(name: string, ext: string) {
  const suffix = ext.startsWith('.') ? ext : `.${ext}`
  const trimmed = name.trim()
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase()))
    return trimmed
  return trimmed + suffix
}

/** `prefix` + the item stem + the format extension. */
export function separateArchiveName(prefix: string, entryName: string, ext: string) {
  return withFormatExt(`${prefix.trim()}${archiveStem(entryName, [])}`, ext)
}

function archiveStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`
}

function compressFormats(): ArchiveCompressFormat[] {
  const formats = serverCapabilities.value.archiveCompressFormats
  if (formats.length)
    return formats
  return [{ id: 'zip', ext: '.zip', label: 'ZIP', password: true }]
}

function field(label: string, node: ReturnType<typeof h>) {
  return h('label', {
    style: 'display: flex; flex-direction: column; gap: var(--vgo-space-1);',
  }, [label, node])
}

/**
 * Compress dialog: archive name, type, and an optional password.
 * The name field shows the stem only; the format extension is appended on confirm.
 * Cancel rejects, matching the other file prompts.
 */
export function showCompressDialog(defaultName: string): Promise<CompressPromptResult> {
  const formats = compressFormats()
  const initial = formats[0]
  const form = reactive({
    name: defaultName,
    prefix: '',
    separate: false,
    format: initial?.id || 'zip',
    password: '',
  })
  const current = () => formats.find(format => format.id === form.format) ?? initial

  function scheduleNameFocus(vnode: { el?: unknown }) {
    const root = vnode.el
    if (!(root instanceof HTMLElement))
      return
    const input = root.querySelector('input')
    if (input instanceof HTMLInputElement)
      focusNameField(input, 'all')
  }

  const message = () => {
    const format = current()
    const nodes = [
      h(ElCheckbox, {
        'modelValue': form.separate,
        'onUpdate:modelValue': (value: string | number | boolean) => { form.separate = Boolean(value) },
      }, () => 'Compress separately'),
      field(form.separate ? 'Prefix (optional)' : 'Archive name', h(ElInput, {
        'onVnodeMounted': scheduleNameFocus,
        'modelValue': form.separate ? form.prefix : form.name,
        'onUpdate:modelValue': (value: string) => {
          if (form.separate)
            form.prefix = value
          else
            form.name = value
        },
      })),
      field('Archive type', h(ElSelect, {
        'modelValue': form.format,
        'style': 'width: 100%;',
        'onUpdate:modelValue': (value: string) => {
          form.format = value
          const next = formats.find(item => item.id === value)
          if (next && !next.password)
            form.password = ''
        },
      }, () => formats.map(item => h(ElOption, {
        key: item.id,
        label: item.label,
        value: item.id,
      })))),
    ]
    if (!format || format.password) {
      nodes.push(field('Password (optional)', h(ElInput, {
        'modelValue': form.password,
        'type': 'password',
        'showPassword': true,
        'onUpdate:modelValue': (value: string) => { form.password = value },
      })))
    }
    return h('div', {
      style: 'display: flex; flex-direction: column; gap: var(--vgo-space-3);',
    }, nodes)
  }

  return window.$dialog.confirm(message, 'Compress', {
    // Default autofocus targets the confirm button, which hides the name field.
    autofocus: false,
    confirmButtonText: 'Compress',
    cancelButtonText: 'Cancel',
    beforeClose: (action: string, _instance: unknown, done: () => void) => {
      if (action === 'confirm') {
        const error = archiveNameError(form.separate ? form.prefix : form.name, form.separate)
        if (error) {
          window.$message?.error(error)
          return
        }
      }
      done()
    },
  }).then(() => {
    const format = current()
    const ext = format?.ext || '.zip'
    const separate = form.separate
    return {
      name: separate ? '' : withFormatExt(form.name, ext),
      format: format?.id || 'zip',
      ext,
      password: format?.password ? form.password : '',
      separate,
      prefix: separate ? form.prefix.trim() : '',
    }
  })
}

/** Extract dialog: destination plus an optional password. */
export function showExtractDialog(folderLabel: string): Promise<ExtractPromptResult> {
  const form = reactive({ password: '', intoFolder: false })
  const message = () => h('div', {
    style: 'display: flex; flex-direction: column; gap: var(--vgo-space-3);width: 100%;',
  }, [
    h(ElRadioGroup, {
      'modelValue': form.intoFolder ? 'folder' : 'here',
      'style': 'display: flex; flex-direction: column; align-items: flex-start; gap: var(--vgo-space-2); overflow: hidden;',
      'onUpdate:modelValue': (value: string | number | boolean | undefined) => { form.intoFolder = value === 'folder' },
    }, () => [
      h(ElRadio, { value: 'here' }, () => 'Extract here'),
      h(ElRadio, { value: 'folder' }, () => folderLabel),
    ]),
    field('Password (optional)', h(ElInput, {
      'modelValue': form.password,
      'type': 'password',
      'showPassword': true,
      'onUpdate:modelValue': (value: string) => { form.password = value },
    })),
  ])

  return window.$dialog.confirm(message, 'Extract', {
    confirmButtonText: 'Extract',
    cancelButtonText: 'Cancel',
  }).then(() => ({
    password: form.password,
    intoFolder: form.intoFolder,
  }))
}

export function extractFolderLabel(names: string[]) {
  const extensions = serverCapabilities.value.archiveExtractExtensions
  if (names.length === 1)
    return `Extract to "./${archiveStem(names[0], extensions)}"`
  return 'Extract each archive into its own folder'
}

export async function startArchiveExtract(
  paths: string[],
  names: string[],
  basePath: string,
  setBusy?: (busy: boolean) => void,
) {
  const choice = await showExtractDialog(extractFolderLabel(names))
  setBusy?.(true)
  try {
    await createTask({
      kind: 'extract',
      fromPaths: paths,
      toPath: basePath,
      intoFolder: choice.intoFolder || undefined,
      password: choice.password || undefined,
      onConflict: 'ask',
    })
  }
  finally {
    setBusy?.(false)
  }
}
