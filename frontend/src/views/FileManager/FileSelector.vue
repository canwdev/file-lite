<script lang="ts" setup="">
import type { SdkPickMode } from '@/sdk/contract'
import type { FileSelectResult } from '@/views/FileManager/types'
import { ModalWindow } from '@canwdev/vgo-ui'
import FileManager from '@/views/FileManager/FileManager.vue'

/**
 * The file/folder/save picker dialog.
 *
 * It is driven by `file-picker.ts` (`openFilePicker`) and rendered once by
 * `FilePickerHost.vue`; every caller — built-in app, plugin through the SDK,
 * toolbar button — ends up here, so there is one dialog and one shortcut scope.
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** `file` / `files` / `folder` / `save`; see `SdkPickMode`. */
    mode?: SdkPickMode
    /** Extensions including the dot, e.g. `['.txt', '.md']`. File modes only. */
    extensions?: string[]
    /** Suggested file name in `save` mode. */
    defaultName?: string
    /** Window title; defaults to an action name. */
    title?: string
    /** Folder to start at; the picker remembers the last folder otherwise. */
    startPath?: string
    /** Changes on every open; the file manager resets per-dialog inputs (save name). */
    requestId?: number
    width?: string
    height?: string
    /** Remember the window's position and size under this id. */
    wid?: string
  }>(),
  {
    mode: 'file',
    defaultName: '',
    title: '',
    startPath: '',
    width: 'min(900px, 92vw)',
    height: 'min(640px, 88vh)',
  },
)

const emit = defineEmits<{
  select: [result: FileSelectResult]
  cancel: []
}>()

const { visible, mode, extensions, defaultName, startPath, title, width, height, wid } = toRefs(props)

/** The picker speaks `file` / `folder` / `save`; multi-select is its own flag. */
const selectFileMode = computed<'file' | 'folder' | 'save'>(() => {
  if (mode.value === 'folder') {
    return 'folder'
  }
  return mode.value === 'save' ? 'save' : 'file'
})
const multiple = computed(() => mode.value === 'files')

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `['.txt', '.md']` → `\.(txt|md)$`, the shape `FileManager` already filters with. */
const fileFilterPattern = computed(() => {
  const list = (extensions.value ?? []).map(ext => escapeRegExp(ext.replace(/^\./, '')))
  return list.length ? `\\.(${list.join('|')})$` : ''
})

const actionLabel = computed(() => {
  if (mode.value === 'folder') {
    return $t('file_lite_i18n.select') + ELLIPSIS
  }
  if (mode.value === 'save') {
    return $t('file_lite_i18n.save_as') + ELLIPSIS
  }
  return $t('file_lite_i18n.open') + ELLIPSIS
})
const windowTitle = computed(() => title.value || actionLabel.value)

const windowInit = computed(() => ({
  width: width.value,
  height: height.value,
}))

// 第一次打开后才挂载 FileManager，之后保持挂载：窗口再开关不会重建列表 / 重拉驱动器
const hasMounted = ref(false)
watch(visible, (isVisible) => {
  if (isVisible) {
    hasMounted.value = true
  }
}, { immediate: true })

/**
 * The dialog reports exactly one outcome, whichever way it was closed: a
 * selection, or a cancel (Cancel button, X, mask click, Esc). The host clears
 * the request, which is what hides the window.
 */
let settled = false
watch(visible, (isVisible) => {
  if (isVisible) {
    settled = false
  }
}, { immediate: true })

function settle(result?: FileSelectResult) {
  if (settled) {
    return
  }
  settled = true
  if (result) {
    emit('select', result)
  }
  else {
    emit('cancel')
  }
}

/** ModalWindow closed itself (X / mask / Esc): that is a cancel. */
function handleVisibleChange(isVisible: boolean) {
  if (!isVisible) {
    settle()
  }
}
</script>

<template>
  <ModalWindow
    :visible="visible"
    :title="windowTitle"
    :wid="wid"
    :init-win-options="windowInit"
    @update:visible="handleVisibleChange"
  >
    <!-- 抵消 ModalWindow 内容区 padding，让 FileManager 铺满 -->
    <div class="file-selector__pane">
      <FileManager
        v-if="hasMounted"
        :select-file-mode="selectFileMode"
        :multiple="multiple"
        :file-filter-pattern="fileFilterPattern"
        :select-default-name="defaultName"
        :initial-path="startPath"
        :request-id="requestId"
        shortcut-scope="fileSelector"
        @cancel-select="settle()"
        @handle-select="settle($event)"
      />
    </div>
  </ModalWindow>
</template>

<style lang="scss" scoped>
.file-selector__pane {
  margin: calc(var(--vgo-space-4) * -1);
  height: calc(100% + var(--vgo-space-4) * 2);
  min-height: 0;
}
</style>
