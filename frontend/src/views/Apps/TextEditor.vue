<script lang="ts" setup="">
import type { MenuBarOptions } from '@canwdev/vgo-ui'
import type { LineEnding } from './text-editor-line-endings'
import { ContextMenuBar, useUnSavedChanges } from '@canwdev/vgo-ui'
import { useDebounceFn } from '@vueuse/core'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import { bytesToSize } from '@/utils'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { applyLineEnding, detectLineEnding } from './text-editor-line-endings'

const sdk = useFileLiteSdk()
const shortcutScope = injectShortcutScope()

// 5 MB
const SIZE_LIMIT = 5 * 1024 * 1024

/**
 * 选择器里的扩展名过滤。内置匹配（`regSupportedTextFormat`）决定双击时用谁打开，
 * 这里只用来把明显不是文本的文件灰掉，所以放宽一点。
 */
const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
  '.env',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.xml',
  '.svg',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sql',
  '.lrc',
  '.srt',
]

/** 编码名与行尾标记是技术名词，不进语言包。 */
const CHARSET_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'gb18030': 'GB18030',
  'big5': 'Big5',
  'shift_jis': 'Shift-JIS',
}

/** 状态栏是记事本式的技术标记，同样不走语言包。 */
const LINE_ENDING_LABELS: Record<LineEnding, string> = {
  crlf: 'Windows (CRLF)',
  lf: 'Unix (LF)',
  cr: 'Macintosh (CR)',
}

const absPath = ref('')
const filename = ref('')
/** The opened entry's size, captured with the launch so the limit check stays cheap. */
const fileSize = ref<number | null>(null)

const editRef = ref<HTMLTextAreaElement>()
const wrapRef = ref<HTMLElement>()
const editContent = ref('')
const isLoading = ref(false)
const { isChanged } = useUnSavedChanges()
watch(editContent, () => {
  isChanged.value = true
})

/** 服务端探测到的磁盘编码；空表示它不是文本文件，保存时按 UTF-8 写。 */
const fileCharset = ref('')
/** 文件原本的行尾；编辑器里一律是 LF，写回时按它还原。 */
const lineEnding = ref<LineEnding>('lf')
const totalLines = ref(1)
const cursorLine = ref(1)
const cursorColumn = ref(1)

const encodingLabel = computed(() => CHARSET_LABELS[fileCharset.value] ?? (fileCharset.value || '—'))
const lineEndingLabel = computed(() => LINE_ENDING_LABELS[lineEnding.value])
const cursorPositionLabel = computed(() => `Ln ${cursorLine.value}, Col ${cursorColumn.value}`)
const lineCountLabel = computed(() => `${totalLines.value} ${totalLines.value === 1 ? 'line' : 'lines'}`)

/** 状态栏内容。一次 O(n) 扫描，所以大文件上要防抖。 */
function refreshStatus() {
  const text = editContent.value
  const caret = Math.min(editRef.value?.selectionStart ?? 0, text.length)
  let lines = 1
  let cursor = 1
  let lineStart = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10)
      continue
    lines++
    if (i < caret) {
      cursor++
      lineStart = i + 1
    }
  }
  totalLines.value = lines
  cursorLine.value = cursor
  cursorColumn.value = caret - lineStart + 1
}

const scheduleStatus = useDebounceFn(refreshStatus, 80)
watch(editContent, () => scheduleStatus())

interface FileTooLarge {
  name: string
  size: number
}
const fileTooLarge = ref<FileTooLarge | null>(null)

async function focusEditor() {
  const tryFocus = () => {
    const el = editRef.value
    if (!el)
      return false
    el.focus({ preventScroll: true })
    return document.activeElement === el
  }

  for (const delay of [0, 50, 150, 300]) {
    if (delay)
      await new Promise(resolve => setTimeout(resolve, delay))
    await nextTick()
    if (tryFocus())
      return
  }
}

watch(editRef, (el) => {
  if (el) {
    void focusEditor()
    refreshStatus()
  }
})

async function confirmUnsavedChanges(message: string) {
  try {
    await window.$dialog.confirm(message, $t('file_lite_i18n.unsaved_changes'), {
      type: 'warning',
      // 问题是「放弃更改？」，按钮就应该是「放弃」而不是「继续」
      confirmButtonText: $t('file_lite_i18n.discard'),
      cancelButtonText: $t('file_lite_i18n.cancel'),
    })
    return true
  }
  catch {
    return false
  }
  finally {
    await focusEditor()
  }
}

/**
 * 窗口标题 = 文件名，未保存时前面加一个圆点（与插件里的编辑器一致）。
 * 菜单项不再需要 `*` 标记，标题本身就是「有没有改动」的指示。
 */
function applyTitle() {
  const name = filename.value || absPath.value || 'Text Editor'
  void sdk.setTitle(`${isChanged.value ? '● ' : ''}${name}`)
}

watch([filename, absPath, isChanged], applyTitle)

// 切换文件时旧请求可能后返回；用一个递增的请求号让旧结果作废，避免覆盖新文件。
let openRequest = 0

async function openFile() {
  const request = ++openRequest

  fileTooLarge.value = null
  fileCharset.value = ''
  lineEnding.value = 'lf'
  totalLines.value = 1
  cursorLine.value = 1
  cursorColumn.value = 1
  try {
    isLoading.value = true
    editContent.value = ''

    if (!absPath.value) {
      return
    }

    if (fileSize.value != null && fileSize.value > SIZE_LIMIT) {
      fileTooLarge.value = { name: filename.value, size: fileSize.value }
      return
    }

    const { text, charset } = await sdk.readText(absPath.value)
    if (request !== openRequest) {
      return
    }
    editContent.value = text
    fileCharset.value = charset
    lineEnding.value = detectLineEnding(text)
    refreshStatus()
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    if (request === openRequest) {
      console.error('open file failed', error)
    }
  }
  finally {
    // 已被更新的请求取代时不要回写 loading / 抢焦点
    if (request === openRequest) {
      isLoading.value = false
    }
  }
}

/**
 * 换一个打开的文件。
 *
 * 窗口的 launch 跟着走：标题、dock、以及「关掉窗口再点同一个文件」都由宿主按
 * launch 决定。`entries` 重新列一次，大小上限与同目录信息才不是旧的。
 */
async function useFile(path: string, name: string, directory: string) {
  absPath.value = path
  filename.value = name
  const entries = await sdk.list(directory).catch(() => [])
  fileSize.value = entries.find(entry => entry.path === path)?.size ?? null
  void sdk.updateLaunch({ path, filename: name, directory, entries })
  openFile()
}

/** `D:/a/b.txt` → `D:/a/`（listing 形态，末尾带斜杠）。 */
function directoryOf(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1) || '/'
}

/** Open…：从 file-lite 里挑一个文本文件。 */
async function openViaPicker() {
  if (isChanged.value) {
    const confirmed = await confirmUnsavedChanges($t('file_lite_i18n.changes_not_saved_continue_to_ex'))
    if (!confirmed) {
      return
    }
  }
  const picked = await sdk.pick({
    mode: 'file',
    title: $t('file_lite_i18n.open') + ELLIPSIS,
    extensions: TEXT_EXTENSIONS,
  })
  const item = picked?.items[0]
  if (!item) {
    return
  }
  await useFile(item.path, item.name, picked.directory || directoryOf(item.path))
}

sdk.onOpen(async (launch) => {
  if (!launch) {
    absPath.value = ''
    filename.value = ''
    fileSize.value = null
    openFile()
    return
  }
  const current = await sdk.getLaunch()
  const entry = current?.entries.find(item => item.path === launch.path)
  absPath.value = launch.path
  filename.value = launch.filename
  fileSize.value = entry?.size ?? null
  openFile()
})

onBeforeUnmount(() => {
  openRequest++
})

const isSaving = ref(false)

/** 把当前内容写回 `path`（行尾与编码按打开时的原样还原）。 */
async function writeTo(path: string) {
  // 保存就是覆盖目标文件，所以显式 overwrite；SDK 负责分派与只读守卫。
  const content = applyLineEnding(editContent.value, lineEnding.value)
  await sdk.writeFile(path, new Blob([content], { type: 'text/plain' }), {
    conflict: 'overwrite',
    ...(fileCharset.value ? { charset: fileCharset.value } : {}),
  })
}

/** Save As…：挑选目录和文件名，写完把窗口切到新文件。 */
async function saveAsViaPicker() {
  if (isSaving.value) {
    return
  }
  const picked = await sdk.pick({
    mode: 'save',
    title: $t('file_lite_i18n.save_as') + ELLIPSIS,
    defaultName: filename.value || 'untitled.txt',
    extensions: TEXT_EXTENSIONS,
  })
  if (!picked?.path) {
    return
  }
  try {
    isSaving.value = true
    await writeTo(picked.path)
    setTimeout(() => {
      isChanged.value = false
    })
    // 另存之后这个窗口就编辑新文件
    await useFile(picked.path, picked.name, picked.directory || directoryOf(picked.path))
  }
  catch (error) {
    window.$message?.warning(error instanceof Error ? error.message : $t('file_lite_i18n.this_location_is_read_only'))
  }
  finally {
    isSaving.value = false
  }
}

async function handleSaveFile() {
  if (isSaving.value) {
    return
  }
  try {
    isSaving.value = true

    if (!absPath.value) {
      throw new Error('absPath not exist!')
    }

    await writeTo(absPath.value)
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : $t('file_lite_i18n.this_location_is_read_only')
    window.$message?.warning(reason)
  }
  finally {
    isSaving.value = false
  }
}

async function confirmDismiss() {
  if (!isChanged.value)
    return true
  // prevent esc close the confirm dialog
  await new Promise(resolve => setTimeout(resolve, 100))
  return confirmUnsavedChanges($t('file_lite_i18n.changes_not_saved_continue_to_ex'))
}

defineExpose({ confirmDismiss })

const menuOptions = computed((): MenuBarOptions => {
  return {
    ...baseContextMenuOptions,
    items: [
      {
        // 全部动作收进「文件」二级菜单，菜单栏上只占一格
        label: $t('file_lite_i18n.file'),
        children: [
          {
            label: $t('file_lite_i18n.open') + ELLIPSIS,
            onClick() {
              void openViaPicker()
            },
          },
          {
            label: $t('file_lite_i18n.save'),
            onClick() {
              handleSaveFile()
            },
          },
          {
            label: $t('file_lite_i18n.save_as') + ELLIPSIS,
            onClick() {
              void saveAsViaPicker()
            },
            divided: true,
          },
          {
            label: $t('file_lite_i18n.exit'),
            onClick: () => sdk.exit(),
          },
        ],
      },
      {
        // 重新读盘是窗口级动作，放在根菜单上少点一层
        label: $t('file_lite_i18n.refresh'),
        onClick: async () => {
          if (isChanged.value) {
            const confirmed = await confirmUnsavedChanges($t('file_lite_i18n.changes_not_saved_continue_to_ex'))
            if (!confirmed) {
              return
            }
          }
          openFile()
        },
      },
    ],
  }
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+s', 'meta+s'],
  description: 'Save',
  handler: handleSaveFile,
  allowInInput: true,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+o', 'meta+o'],
  description: 'Open',
  handler: () => void openViaPicker(),
  allowInInput: true,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+shift+s', 'meta+shift+s'],
  description: 'Save As',
  handler: () => void saveAsViaPicker(),
  allowInInput: true,
})
</script>

<template>
  <div
    ref="wrapRef"
    v-loading="isSaving || isLoading"
    class="text-editor-wrap"
    tabindex="0"
  >
    <ContextMenuBar :options="menuOptions" />
    <div v-if="isLoading" class="loading-wrapper">
      Loading...
    </div>
    <div v-else-if="fileTooLarge" class="vgo-empty too-large-state">
      <span class="vgo-empty__icon too-large-icon">
        <i-mdi-file-alert-outline />
      </span>
      <p class="vgo-empty__title">
        {{ $t('file_lite_i18n.file_too_large_to_edit') }}
      </p>
      <p class="vgo-empty__desc">
        <strong>{{ fileTooLarge.name }}</strong>
        is {{ bytesToSize(fileTooLarge.size) }} {{ $t('file_lite_i18n.limit_is') }} {{ bytesToSize(SIZE_LIMIT) }}
      </p>
      <a class="vgo-button" :href="sdk.url(absPath)" target="_blank" rel="noopener">
        <i-mdi-open-in-new /> {{ $t('file_lite_i18n.open_in_browser') }} </a>
    </div>
    <template v-else>
      <textarea
        ref="editRef"
        v-model="editContent"
        class="vgo-input vgo-u-font-code text-editor-textarea"
        @input="scheduleStatus"
        @keyup="scheduleStatus"
        @click="scheduleStatus"
        @select="scheduleStatus"
      />
      <div class="text-editor-status-bar vgo-panel vgo-panel--flat">
        <div class="vgo-u-flex-wrap-center">
          <span>{{ cursorPositionLabel }}</span>
          <span>{{ lineCountLabel }}</span>
        </div>
        <div class="vgo-u-flex-wrap-center">
          <span>{{ lineEndingLabel }}</span>
          <span>{{ encodingLabel }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
  .text-editor-wrap {
  height: 100%;
  width: 100%;
  min-height: 200px;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  padding: 2px;

  &:focus {
    outline: none;
  }

  .vgo-context-menu-bar {
    padding: var(--vgo-space-1) 0;
    flex: unset;
  }

  .text-editor-textarea {
    width: 100%;
    flex: 1;
    resize: none;
  }

  // 记事本式状态栏：行尾与编码跟着文件走，保存时不改它们
  .text-editor-status-bar {
    border-top: 1px solid var(--vgo-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--vgo-space-1) var(--vgo-space-4);
    padding: var(--vgo-space-1) var(--vgo-space-2);
    font-size: var(--vgo-font-sm);
    flex: unset;
  }

  .loading-wrapper {
    width: 100%;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .too-large-state {
    flex: 1;

    p {
      margin: 0;
    }

    .too-large-icon {
      color: var(--vgo-warning);
      opacity: 1;
    }

    .vgo-button {
      text-decoration: none;
    }
  }
}
</style>
