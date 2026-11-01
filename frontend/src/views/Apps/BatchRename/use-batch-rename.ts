import type {
  ExtensionScope,
  FileEntry,
  PreviewResult,
  RenameRule,
  RuleConfig,
  RuleType,
} from './engine/types'
import type { SdkEntry, SdkLaunchKind } from '@/sdk/contract'
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import { autoFixConflicts, computePreview } from './engine/rules'
import { getDefaultConfig } from './engine/types'

export interface RenameChange {
  fileId: string
  fromPath: string
  toPath: string
  fromName: string
  toName: string
  status: 'success' | 'failed'
  reason?: string
}

const RULE_TYPES: RuleType[] = [
  'findReplace',
  'template',
  'caseStyle',
  'removeCleanup',
]

let nextFileId = 1
let nextRuleId = 1

function baseNameOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

function dirnameOf(path: string) {
  const normalized = path.replace(/\/+$/, '')
  const cut = normalized.lastIndexOf('/')
  if (cut > 0)
    return normalized.slice(0, cut)
  return cut === 0 ? '/' : normalized || path
}

function joinPath(dir: string, name: string) {
  const parent = dir.replace(/\/+$/, '')
  const child = name.replace(/^\/+/, '')
  return parent ? `${parent}/${child}` : `/${child}`
}

function fromSdkEntry(entry: SdkEntry, relativePath?: string): FileEntry {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1) || entry.name
  return {
    id: String(nextFileId++),
    path: entry.path,
    name,
    baseName: baseNameOf(name),
    extension: extensionOf(name),
    selected: true,
    relativePath: relativePath ?? name,
    size: entry.size,
    modified: entry.lastModified,
  }
}

export function useBatchRename() {
  const sdk = useFileLiteSdk()
  const files = ref<FileEntry[]>([])
  const rules = ref<RenameRule[]>([])
  const extensionScope = ref<ExtensionScope>('name')
  const isBusy = ref(false)
  const notice = ref('')
  const executionLog = ref<RenameChange[]>([])
  const undoStack = ref<RenameChange[][]>([])
  const redoStack = ref<RenameChange[][]>([])
  const newRuleType = ref<RuleType | ''>('')
  const exportFormat = ref<'csv' | 'json' | 'sh' | 'cmd'>('csv')

  const preview = computed(() => computePreview(files.value, rules.value, extensionScope.value))
  const changed = computed(() => preview.value.filter(row => row.hasChange))
  const conflicts = computed(() => preview.value.filter(row => row.conflict))
  const selectedCount = computed(() => files.value.filter(file => file.selected).length)

  function resetFiles(entries: FileEntry[]) {
    const seen = new Set<string>()
    files.value = entries.filter((entry) => {
      if (seen.has(entry.path))
        return false
      seen.add(entry.path)
      return true
    })
    executionLog.value = []
    undoStack.value = []
    redoStack.value = []
  }

  async function addSelection(selection: SdkEntry[], kind: SdkLaunchKind) {
    if (!selection.length)
      return
    const collected: FileEntry[] = []
    for (const entry of selection) {
      if (!entry.isDirectory) {
        collected.push(fromSdkEntry(entry))
        continue
      }
      const listed = await sdk.list(entry.path, { recursive: true })
      const prefix = entry.path.replace(/\/+$/, '')
      for (const child of listed) {
        if (!child.isDirectory)
          collected.push(fromSdkEntry(child, child.path.startsWith(`${prefix}/`) ? child.path.slice(prefix.length + 1) : child.name))
      }
    }
    // A multi-file launch from Open With has no selection array; kind 'file' is
    // handled by the remote launch path below. Keep the argument for clarity.
    void kind
    resetFiles(collected)
    notice.value = collected.length ? '' : $t('file_lite_i18n.batch_rename_no_files')
  }

  async function importFiles() {
    try {
      const result = await sdk.pick({ mode: 'files' })
      if (!result)
        return
      resetFiles(result.items.filter(item => !item.isDirectory).map(item => fromSdkEntry(item)))
    }
    catch (error) {
      notice.value = $t('file_lite_i18n.batch_rename_failed', [error instanceof Error ? error.message : String(error)])
    }
  }

  async function importFolder() {
    try {
      const result = await sdk.pick({ mode: 'folder' })
      if (!result)
        return
      const listed = await sdk.list(result.path, { recursive: true })
      const base = result.path.replace(/\/+$/, '')
      resetFiles(listed
        .filter(item => !item.isDirectory)
        .map(item => fromSdkEntry(item, item.path.startsWith(base) ? item.path.slice(base.length + 1) : item.name)))
    }
    catch (error) {
      notice.value = $t('file_lite_i18n.batch_rename_failed', [error instanceof Error ? error.message : String(error)])
    }
  }

  function clearFiles() {
    files.value = []
    executionLog.value = []
    undoStack.value = []
    redoStack.value = []
    notice.value = ''
  }

  function toggleFile(id: string) {
    const file = files.value.find(item => item.id === id)
    if (file)
      file.selected = !file.selected
  }

  function toggleAll(selected: boolean) {
    for (const file of files.value)
      file.selected = selected
  }

  function addRule() {
    const type = newRuleType.value
    if (!type || !RULE_TYPES.includes(type))
      return
    rules.value.push({
      id: String(nextRuleId++),
      enabled: true,
      ruleConfig: getDefaultConfig(type) as RuleConfig,
    })
    newRuleType.value = ''
  }

  function removeRule(id: string) {
    rules.value = rules.value.filter(rule => rule.id !== id)
  }

  function moveRule(id: string, direction: -1 | 1) {
    const index = rules.value.findIndex(rule => rule.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= rules.value.length)
      return
    const next = [...rules.value]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    rules.value = next
  }

  function autoFix() {
    const fixed = autoFixConflicts(preview.value, extensionScope.value)
    const byId = new Map(fixed.map(row => [row.fileId, row]))
    // Keep the preview stable: the engine's fixed rows are applied by a
    // lightweight override map when executing and rendering.
    // The component renders rows from `preview`; store the override here.
    previewOverride.value = byId
  }

  const previewOverride = ref<Map<string, PreviewResult> | null>(null)
  const displayPreview = computed(() => {
    const override = previewOverride.value
    if (!override)
      return preview.value
    return preview.value.map(row => override.get(row.fileId) ?? row)
  })
  const displayChanged = computed(() => displayPreview.value.filter(row => row.hasChange))
  const displayConflicts = computed(() => displayPreview.value.filter(row => row.conflict))

  function resetOverride() {
    previewOverride.value = null
  }

  watch([files, rules, extensionScope], () => {
    previewOverride.value = null
  }, { deep: true })

  async function execute() {
    if (isBusy.value || !displayChanged.value.length)
      return
    if (displayConflicts.value.length) {
      notice.value = $t('file_lite_i18n.batch_rename_resolve_conflicts')
      return
    }
    isBusy.value = true
    notice.value = ''
    const affected = displayChanged.value
    const byId = new Map(files.value.map(file => [file.id, file]))
    const targets = affected.map((row) => {
      const file = byId.get(row.fileId)
      return file ? joinPath(dirnameOf(file.path), row.newName) : ''
    }).filter(Boolean)
    let existing: string[] = []
    try {
      existing = await sdk.exists(targets)
    }
    catch (error) {
      notice.value = $t('file_lite_i18n.batch_rename_failed', [error instanceof Error ? error.message : String(error)])
      isBusy.value = false
      return
    }
    if (existing.length) {
      notice.value = $t('file_lite_i18n.batch_rename_destination_exists', [existing.slice(0, 3).join(', ') + (existing.length > 3 ? '…' : '')])
      isBusy.value = false
      return
    }

    const batch: RenameChange[] = []
    for (const row of affected) {
      const file = byId.get(row.fileId)
      if (!file)
        continue
      const fromPath = file.path
      const toPath = joinPath(dirnameOf(fromPath), row.newName)
      try {
        const result = await sdk.rename(fromPath, row.newName)
        file.path = result.path
        file.name = result.name
        file.baseName = baseNameOf(result.name)
        file.extension = extensionOf(result.name)
        file.relativePath = result.name
        batch.push({
          fileId: file.id,
          fromPath,
          toPath: result.path,
          fromName: row.original,
          toName: row.newName,
          status: 'success',
        })
      }
      catch (error) {
        batch.push({
          fileId: file.id,
          fromPath,
          toPath,
          fromName: row.original,
          toName: row.newName,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    executionLog.value = batch
    const successes = batch.filter(item => item.status === 'success')
    if (successes.length) {
      undoStack.value = [...undoStack.value, successes]
      redoStack.value = []
    }
    const failures = batch.length - successes.length
    if (failures)
      notice.value = $t('file_lite_i18n.batch_rename_failed_count', [failures])
    isBusy.value = false
  }

  async function undo() {
    if (isBusy.value || !undoStack.value.length)
      return
    const batch = undoStack.value[undoStack.value.length - 1]
    isBusy.value = true
    const redo: RenameChange[] = []
    for (const change of [...batch].reverse()) {
      try {
        const result = await sdk.rename(change.toPath, change.fromName)
        const file = files.value.find(item => item.id === change.fileId)
        if (file) {
          file.path = result.path
          file.name = result.name
          file.baseName = baseNameOf(result.name)
          file.extension = extensionOf(result.name)
          file.relativePath = result.name
        }
        redo.push({ ...change, fromPath: result.path, toPath: change.toPath, status: 'success' })
      }
      catch {
        // Keep the batch in the undo stack so a retry can finish it.
      }
    }
    if (redo.length) {
      undoStack.value = undoStack.value.slice(0, -1)
      redoStack.value = [...redoStack.value, redo]
    }
    isBusy.value = false
  }

  async function redo() {
    if (isBusy.value || !redoStack.value.length)
      return
    const batch = redoStack.value[redoStack.value.length - 1]
    isBusy.value = true
    const undoBatch: RenameChange[] = []
    for (const change of batch) {
      try {
        const result = await sdk.rename(change.fromPath, change.toName)
        const file = files.value.find(item => item.id === change.fileId)
        if (file) {
          file.path = result.path
          file.name = result.name
          file.baseName = baseNameOf(result.name)
          file.extension = extensionOf(result.name)
          file.relativePath = result.name
        }
        undoBatch.push({ ...change, toPath: result.path, status: 'success' })
      }
      catch {
        // Leave the batch available for a retry.
      }
    }
    if (undoBatch.length) {
      redoStack.value = redoStack.value.slice(0, -1)
      undoStack.value = [...undoStack.value, undoBatch]
    }
    isBusy.value = false
  }

  function exportText() {
    const affected = displayChanged.value
    if (exportFormat.value === 'json') {
      return JSON.stringify(affected.map(row => ({
        oldName: row.original,
        newName: row.newName,
        conflict: row.conflict,
      })), null, 2)
    }
    if (exportFormat.value === 'csv') {
      const esc = (value: string) => `"${value.replaceAll('"', '""')}"`
      return [
        'oldName,newName',
        ...affected.map(row => `${esc(row.original)},${esc(row.newName)}`),
      ].join('\n')
    }
    if (exportFormat.value === 'cmd') {
      return [
        '@echo off',
        ...affected.map(row => `ren "${row.original.replaceAll('"', '""')}" "${row.newName.replaceAll('"', '""')}"`),
      ].join('\r\n')
    }
    return affected
      .map(row => `mv "${row.original.replaceAll('"', '\\"')}" "${row.newName.replaceAll('"', '\\"')}"`)
      .join('\n')
  }

  async function exportPlan() {
    const text = exportText()
    if (!text)
      return
    const ext = exportFormat.value === 'json' ? '.json' : exportFormat.value === 'csv' ? '.csv' : exportFormat.value === 'cmd' ? '.cmd' : '.sh'
    const target = await sdk.pick({
      mode: 'save',
      defaultName: `rename-plan${ext}`,
      extensions: [ext],
    })
    if (!target?.path)
      return
    await sdk.writeFile(target.path, new Blob([text], {
      type: exportFormat.value === 'json' ? 'application/json' : 'text/plain',
    }), { conflict: 'overwrite' })
  }

  onMounted(async () => {
    await sdk.setTitle($t('file_lite_i18n.batch_rename_title')).catch(() => {})
    sdk.onOpen((event) => {
      if (event?.selection?.length) {
        void addSelection(event.selection, event.kind).catch((error) => {
          notice.value = $t('file_lite_i18n.batch_rename_failed', [error instanceof Error ? error.message : String(error)])
        })
      }
    })
  })

  return {
    files,
    rules,
    extensionScope,
    isBusy,
    notice,
    executionLog,
    undoStack,
    redoStack,
    newRuleType,
    exportFormat,
    preview,
    displayPreview,
    changed,
    displayChanged,
    displayConflicts,
    conflicts,
    selectedCount,
    RULE_TYPES,
    importFiles,
    importFolder,
    clearFiles,
    toggleFile,
    toggleAll,
    addRule,
    removeRule,
    moveRule,
    autoFix,
    resetOverride,
    execute,
    undo,
    redo,
    exportPlan,
  }
}

export { RULE_TYPES }
