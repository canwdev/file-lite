<script lang="ts" setup="">
import type { MenuBarOptions } from '@canwdev/vgo-ui'
import type { LineEnding } from './text-editor-line-endings'
import type { AppParams } from '@/views/Apps/apps.ts'
import { ContextMenuBar, useUnSavedChanges } from '@canwdev/vgo-ui'
import { useDebounceFn } from '@vueuse/core'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'
import { bytesToSize } from '@/utils'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { fs } from '@/utils/fs'
import { applyLineEnding, detectLineEnding } from './text-editor-line-endings'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)

const emit = defineEmits(['exit', 'setTitle'])
const shortcutScope = injectShortcutScope()

// 5 MB
const SIZE_LIMIT = 5 * 1024 * 1024

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

const { appParams } = toRefs(props)
const absPath = computed(() => {
  return appParams.value?.absPath
})

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
      confirmButtonText: $t('file_lite_i18n.continue'),
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

function isAbortError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { name, code } = error as { name?: string, code?: string }
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED'
}

// 切换文件时旧请求可能后返回，用 AbortController 让它在途取消，避免旧内容覆盖新文件
let openController: AbortController | null = null

async function openFile() {
  openController?.abort()
  const controller = new AbortController()
  openController = controller

  fileTooLarge.value = null
  fileCharset.value = ''
  lineEnding.value = 'lf'
  totalLines.value = 1
  cursorLine.value = 1
  cursorColumn.value = 1
  try {
    isLoading.value = true
    emit('setTitle', absPath.value)
    editContent.value = ''

    if (!absPath.value) {
      return
    }

    const { item } = props.appParams
    if (item.size != null && item.size > SIZE_LIMIT) {
      fileTooLarge.value = { name: item.name, size: item.size }
      return
    }

    // 走门面读取文本（连同它在磁盘上的编码）
    const { text, charset } = await fs.readTextFile(absPath.value, { signal: controller.signal })
    if (controller.signal.aborted) {
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
    if (!isAbortError(error)) {
      console.error('open file failed', error)
    }
  }
  finally {
    // 已被更新的请求取代时不要回写 loading / 抢焦点
    if (openController === controller) {
      openController = null
      isLoading.value = false
    }
  }
}

watch(
  () => props.appParams,
  () => {
    openFile()
  },
)

onMounted(() => {
  openFile()
})

onBeforeUnmount(() => {
  openController?.abort()
})

/** 某个路径的父目录 */
function dirOf(path: string) {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : path
}

const isSaving = ref(false)
async function handleSaveFile() {
  if (isSaving.value) {
    return
  }
  try {
    isSaving.value = true

    if (!absPath.value) {
      throw new Error('absPath not exist!')
    }

    const idx = absPath.value.lastIndexOf('/') + 1
    const filename = absPath.value.slice(idx)
    // 保存就是覆盖打开的这个文件，所以显式 overwrite；门面负责分派与只读守卫。
    // 行尾与编码都按打开时的原样写回，编辑不会悄悄改变这个文件。
    const content = applyLineEnding(editContent.value, lineEnding.value)
    const written = await fs.writeText(dirOf(absPath.value), filename, content, {
      conflict: 'overwrite',
      ...(fileCharset.value ? { charset: fileCharset.value } : {}),
    })
    if (!written.ok) {
      window.$message?.warning(written.reason ?? $t('file_lite_i18n.this_location_is_read_only'))
      return
    }
    setTimeout(() => {
      isChanged.value = false
    })
  }
  catch (error) {
    console.error('save file failed', error)
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
        label: `${$t('file_lite_i18n.save')}${isChanged.value ? '*' : ''}`,
        onClick() {
          handleSaveFile()
        },
      },
      {
        label: $t('file_lite_i18n.refresh'),
        onClick: async () => {
          if (isChanged.value) {
            const confirmed = await confirmUnsavedChanges($t('file_lite_i18n.changes_not_saved_continue_to_re'))
            if (!confirmed) {
              return
            }
          }
          openFile()
        },
      },
      {
        label: $t('file_lite_i18n.exit'),
        onClick: () => emit('exit'),
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
      <a class="vgo-button" :href="fs.url(absPath!)" target="_blank" rel="noopener">
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
