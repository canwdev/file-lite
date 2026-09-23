<script setup lang="ts">
import type { ContextMenuInstance, MenuItem } from '@canwdev/vgo-ui'
import type { IEntry } from '@/types/server'
import { ContextMenu, useContextMenuTrigger } from '@canwdev/vgo-ui'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { resolveMenuIcons } from '@/utils/icons'
import { getBreadcrumbSegments, normalizeListingPath, normalizePath } from '../utils'
import { currentChildNameFor } from '../utils/volume-mounts'
import { driveIcon, driveList, loadDrives, pathRootIcon } from './drives'
import { acceptDirDrag, dropIntoDir, useDragEnabled } from './entry-drag'
import { applyFolderListSort, getSortedFolderEntries, readFolderRawList, wasFolderListingOk } from './folder-listing'

export type BreadcrumbSegment = ReturnType<typeof getBreadcrumbSegments>[number]

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  'navigate': [string, string | null]
  'openPathInNewTab': [string]
  'refresh': []
}>()

const editing = ref(false)
const editDraft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const breadcrumbScrollRef = ref<HTMLElement | null>(null)

/* ---------------------------------------------------------------------------
 * 面包屑是拖拽落点：拖到某一段 = 移动 / 复制（或上传系统文件）到该祖先目录。
 * 只有 crumb 本身是落点；「▼」下拉和它的子目录菜单（Teleport 到 body）都不是。
 * ------------------------------------------------------------------------- */
const dragEnabled = useDragEnabled()
const dragOverPath = ref<string | null>(null)

function onCrumbDragOver(seg: BreadcrumbSegment, event: DragEvent) {
  if (!dragEnabled.value) {
    return
  }
  if (!acceptDirDrag(seg.path, event)) {
    if (dragOverPath.value === seg.path) {
      dragOverPath.value = null
    }
    return
  }
  dragOverPath.value = seg.path
}

function onCrumbDragLeave(seg: BreadcrumbSegment, event: DragEvent) {
  if (dragOverPath.value !== seg.path) {
    return
  }
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as Node | null)?.contains(next)) {
    return
  }
  dragOverPath.value = null
}

function onCrumbDrop(seg: BreadcrumbSegment, event: DragEvent) {
  dragOverPath.value = null
  if (!dragEnabled.value) {
    return
  }
  dropIntoDir(seg.path, event)
}

function clearDragOver() {
  dragOverPath.value = null
}

const segments = computed(() => getBreadcrumbSegments(props.modelValue))

// 面包屑溢出折叠：内容放不下时不出现滚动条，自动只展示末尾最多 2 个 crumb
const hiddenPrefixCount = ref(0)
/** 测量阶段临时显示全部 crumb（同一帧内完成，不会闪烁） */
const measuring = ref(false)
let breadcrumbResizeObserver: ResizeObserver | null = null

/* ---------------------------------------------------------------------------
 * 最左侧固定一个当前根的图标；点击弹出 Storage（盘 / 挂载点）列表。
 * ------------------------------------------------------------------------- */
const rootSegment = computed(() => segments.value[0] ?? null)
const currentMount = computed(() => {
  const path = rootSegment.value ? normalizeListingPath(rootSegment.value.path) : ''
  return driveList.value.find(drive => normalizeListingPath(drive.path) === path) ?? null
})
const currentRootIcon = computed(() => pathRootIcon(rootSegment.value?.path ?? ''))
const currentRootLabel = computed(() => currentMount.value?.label || rootSegment.value?.name || 'Storage')

function buildStorageItems(): MenuItem[] {
  if (!driveList.value.length) {
    return [{ label: 'No locations available.', disabled: true }]
  }
  const currentRoot = rootSegment.value ? normalizeListingPath(rootSegment.value.path) : ''
  return driveList.value.map(drive => ({
    label: drive.label,
    icon: driveIcon(drive),
    customClass: normalizeListingPath(drive.path) === currentRoot ? 'is-active' : '',
    onClick: () => {
      if (normalizeListingPath(drive.path) === currentRoot) {
        return
      }
      emit('navigate', drive.path, null)
    },
  }))
}

const {
  setTriggerRef: setRootMenuTriggerRef,
  isOpen: rootMenuOpen,
  show: showRootMenu,
  close: closeRootMenu,
} = useContextMenuTrigger({
  ...baseContextMenuOptions,
  items: () => resolveMenuIcons(buildStorageItems()),
})

async function toggleRootMenu() {
  if (editing.value) {
    return
  }
  if (rootMenuOpen.value) {
    closeRootMenu()
    return
  }
  await loadDrives()
  showRootMenu()
}

async function recomputeBreadcrumbFit() {
  const el = breadcrumbScrollRef.value
  if (!el || editing.value) {
    return
  }
  measuring.value = true
  await nextTick()
  const wouldOverflow = el.scrollWidth > el.clientWidth + 1
  measuring.value = false
  hiddenPrefixCount.value = wouldOverflow ? Math.max(0, segments.value.length - 2) : 0
  await nextTick()
}

watch(
  () => props.modelValue,
  () => {
    closeCrumbMenu()
    closeRootMenu()
    clearDragOver()
    recomputeBreadcrumbFit()
  },
  { flush: 'post' },
)

watch(editing, (isEditing: boolean) => {
  if (isEditing) {
    closeCrumbMenu()
    closeRootMenu()
  }
  else {
    recomputeBreadcrumbFit()
  }
})

function startEdit() {
  editDraft.value = props.modelValue
  editing.value = true
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function commitFromEdit(opts?: { refreshIfUnchanged?: boolean }) {
  if (!editing.value) {
    return
  }
  const next = normalizePath(editDraft.value.trim() || '/')
  editing.value = false
  if (normalizeListingPath(next) === normalizeListingPath(props.modelValue)) {
    if (opts?.refreshIfUnchanged) {
      emit('refresh')
    }
    return
  }
  // Emit navigate before v-model so the parent still sees the old path when
  // handleOpenPath compares; otherwise basePath updates first and refresh is skipped.
  emit('navigate', next, null)
  emit('update:modelValue', next)
}

function cancelEdit() {
  editing.value = false
}

function onCrumbClick(path: string) {
  if (editing.value) {
    return
  }
  if (normalizeListingPath(path) === normalizeListingPath(props.modelValue)) {
    return
  }
  // Highlight the folder name that's the direct child of the clicked parent path
  let highlightName: string | null = null
  const currentNormalized = normalizeListingPath(props.modelValue)
  const targetNormalized = normalizeListingPath(path)
  if (currentNormalized.startsWith(targetNormalized) && currentNormalized !== targetNormalized) {
    const remaining = currentNormalized.slice(targetNormalized.length)
    highlightName = remaining.split('/').filter(Boolean)[0] || null
  }
  emit('navigate', path, highlightName)
}

/**
 * 面包屑段中键 = 在新标签里打开该祖先目录。和磁盘项 / 收藏项同一套约定；
 * 中键点击（`auxclick`）不会触发左键的 `click`，也不会与 `▼` 下拉冲突——
 * 下拉有自己的按钮，中键落在它上面不会走到这里。
 */
function onCrumbAuxClick(path: string, event: MouseEvent) {
  if (event.button !== 1) {
    return
  }
  event.preventDefault()
  emit('openPathInNewTab', path)
}

function showCrumbMenu(path: string, event: MouseEvent) {
  const items: MenuItem[] = [
    {
      label: 'Open in new Tab',
      icon: 'mdi mdi-open-in-new',
      onClick: () => emit('openPathInNewTab', path),
    },
  ]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...baseContextMenuOptions,
    items: resolveMenuIcons(items),
  })
}

function onBreadcrumbBarClick(event: MouseEvent) {
  if (editing.value) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target?.closest('.address-bar__crumb, .address-bar__crumb-caret, .address-bar__root')) {
    return
  }
  startEdit()
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitFromEdit({ refreshIfUnchanged: true })
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function onInputBlur() {
  if (!editing.value) {
    return
  }
  commitFromEdit()
}

// ---------------------------------------------------------------------------
// 面包屑「▼」下拉：列出该段目录的子文件夹（按该目录自身排序规则），点击导航。
// 用 vgo-ui 的 ContextMenu 以按钮下拉的形式弹出。
// ---------------------------------------------------------------------------
const CRUMB_MENU_WIDTH = 220
const CRUMB_MENU_MAX_HEIGHT = 360
/** 展开菜单的 caret 会带上这个 class，让菜单的「点击外部关闭」放过触发它的那一下。 */
const CRUMB_MENU_TRIGGER_CLASS = 'address-bar__crumb-caret--menu'

/** 当前展开子目录菜单的面包屑段；null 表示没有打开。 */
const openCrumbPath = ref<string | null>(null)
let crumbMenuInstance: ContextMenuInstance | null = null

/**
 * 当前目录在 `seg` 的哪个子目录里（见 currentChildNameFor 的注释）。
 */
function currentChildName(seg: BreadcrumbSegment): string | null {
  return currentChildNameFor(seg.path, props.modelValue)
}

/** 读取某段的子文件夹；命中缓存时同步返回，避免已加载过的目录再次等待。 */
async function readCrumbSubDirs(path: string): Promise<{ dirs: IEntry[], error: boolean }> {
  if (wasFolderListingOk(path)) {
    return { dirs: getSortedFolderEntries(path).filter(item => item.isDirectory), error: false }
  }
  const raw = await readFolderRawList(path)
  return {
    dirs: applyFolderListSort(path, raw).filter(item => item.isDirectory),
    error: !wasFolderListingOk(path) && raw.length === 0,
  }
}

/** 子文件夹菜单项；当前目录那一条保持高亮，空 / 失败时给一条禁用的提示。 */
function buildCrumbSubDirItems(seg: BreadcrumbSegment, dirs: IEntry[], error: boolean): MenuItem[] {
  if (!dirs.length) {
    return [{ label: error ? 'Failed to load subfolders.' : 'No subfolders.', disabled: true }]
  }
  const current = currentChildName(seg)
  return dirs.map(dir => ({
    label: dir.name,
    icon: 'mdi mdi-folder',
    customClass: dir.name === current ? 'is-active' : '',
    onClick: () => {
      onCrumbClick(`${seg.path}${dir.name}/`)
    },
  }))
}

function closeCrumbMenu() {
  crumbMenuInstance?.closeMenu()
  crumbMenuInstance = null
  openCrumbPath.value = null
}

/** 点 caret：同一段再点关闭，否则读取子目录后贴在 caret 下方弹出。 */
async function toggleCrumbMenu(seg: BreadcrumbSegment, event: MouseEvent) {
  if (editing.value) {
    return
  }
  const anchor = event.currentTarget as HTMLElement
  if (openCrumbPath.value === seg.path) {
    closeCrumbMenu()
    return
  }
  closeCrumbMenu()
  openCrumbPath.value = seg.path

  const { dirs, error } = await readCrumbSubDirs(seg.path)
  // 读取期间用户点了别处或别的段
  if (openCrumbPath.value !== seg.path) {
    return
  }

  const currentIndex = dirs.findIndex(dir => dir.name === currentChildName(seg))
  const rect = anchor.getBoundingClientRect()
  crumbMenuInstance = ContextMenu.showContextMenu({
    x: rect.left,
    y: rect.bottom + 4,
    minWidth: CRUMB_MENU_WIDTH,
    maxHeight: CRUMB_MENU_MAX_HEIGHT,
    ...baseContextMenuOptions,
    ignoreClickClassName: CRUMB_MENU_TRIGGER_CLASS,
    items: resolveMenuIcons(buildCrumbSubDirItems(seg, dirs, error)),
    onClose: () => {
      anchor.classList.remove(CRUMB_MENU_TRIGGER_CLASS)
      crumbMenuInstance = null
      openCrumbPath.value = null
    },
  })
  anchor.classList.add(CRUMB_MENU_TRIGGER_CLASS)

  // 等菜单项挂载后把当前目录滚进可视区（瞬时，不做平滑滚动）
  if (currentIndex >= 0) {
    void nextTick(() => {
      const currentItem = crumbMenuInstance?.getMenuRef()?.getChildItem(currentIndex)?.getElement()
      currentItem?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    })
  }
}

/** 窗口尺寸变化时收起下拉（菜单本身不跟随重排）。 */
function onWindowResize() {
  closeCrumbMenu()
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('dragend', clearDragOver)

  const el = breadcrumbScrollRef.value
  if (el) {
    breadcrumbResizeObserver = new ResizeObserver(() => {
      recomputeBreadcrumbFit()
    })
    breadcrumbResizeObserver.observe(el)
  }
  recomputeBreadcrumbFit()
})

onBeforeUnmount(() => {
  breadcrumbResizeObserver?.disconnect()
  breadcrumbResizeObserver = null
  closeCrumbMenu()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('dragend', clearDragOver)
})

defineExpose({
  focus() {
    startEdit()
  },
})
</script>

<template>
  <div
    class="address-bar vgo-input"
    :class="{ 'is-editing': editing }"
    :title="editing ? '' : 'Address bar — click empty area to edit (Alt+A)'"
  >
    <input
      v-show="editing"
      ref="inputRef"
      v-model="editDraft"
      type="text"
      class="address-bar__input vgo-input"
      placeholder="Path"
      @keydown="onInputKeydown"
      @blur="onInputBlur"
    >
    <div
      v-show="!editing"
      ref="breadcrumbScrollRef"
      class="address-bar__breadcrumb"
      :class="{ 'has-overflow': hiddenPrefixCount > 0 && !measuring }"
      role="navigation"
      aria-label="Path"
      @click="onBreadcrumbBarClick"
    >
      <template v-if="segments.length">
        <button
          :ref="setRootMenuTriggerRef"
          type="button"
          class="address-bar__root vgo-u-button-reset"
          :class="{ 'is-open': rootMenuOpen }"
          :title="currentRootLabel"
          :aria-label="currentRootLabel"
          aria-haspopup="menu"
          @click.stop.prevent="toggleRootMenu"
        >
          <MdiIcon :name="currentRootIcon" />
        </button>
        <template v-for="(seg, index) in segments" :key="seg.path">
          <span
            v-show="index >= hiddenPrefixCount || measuring"
            class="address-bar__crumb-wrap"
          >
            <button
              type="button"
              class="address-bar__crumb vgo-u-button-reset"
              :class="{ 'is-drop-target': dragOverPath === seg.path }"
              :title="seg.path"
              @click.stop="onCrumbClick(seg.path)"
              @auxclick.stop="onCrumbAuxClick(seg.path, $event)"
              @contextmenu.prevent.stop="showCrumbMenu(seg.path, $event)"
              @dragover="onCrumbDragOver(seg, $event)"
              @dragleave="onCrumbDragLeave(seg, $event)"
              @drop="onCrumbDrop(seg, $event)"
            >
              <span class="address-bar__crumb-text vgo-u-text-overflow">{{ seg.name }}</span>
            </button>
            <button
              v-if="index < segments.length - 1"
              type="button"
              class="address-bar__crumb-caret vgo-u-button-reset"
              :class="{ 'is-open': openCrumbPath === seg.path }"
              :title="`${seg.name} subfolders`"
              :aria-label="`${seg.name} subfolders`"
              :aria-expanded="openCrumbPath === seg.path"
              aria-haspopup="menu"
              @click.stop.prevent="toggleCrumbMenu(seg, $event)"
              @contextmenu.prevent.stop="showCrumbMenu(seg.path, $event)"
            >
              <MdiIcon :name="openCrumbPath === seg.path ? 'chevron-down' : 'chevron-right'" />
            </button>
          </span>
        </template>
      </template>
      <button
        v-else
        type="button"
        class="address-bar__crumb address-bar__crumb--placeholder vgo-u-button-reset"
        @click.stop="startEdit"
      >
        Path
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.address-bar {
  flex: 1;
  min-width: 100px;
  height: var(--vgo-control-md);
  display: flex;
  align-items: stretch;
  transition: border-color var(--vgo-duration-fast) ease;
  padding: 0;
  overflow: hidden;

  &.is-editing {
    border: 1px solid var(--vgo-primary);
    outline: none;
  }
}

.address-bar__input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: none !important;
  border-radius: var(--vgo-radius);
  line-height: 1;
  padding: 0 var(--vgo-space-2);
  height: 100%;
  font-size: var(--vgo-font-md);
  background: transparent;
  outline: none;
  box-shadow: none !important;
}

.address-bar__breadcrumb {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;

  @include when-panel-narrow {
    min-width: 120px;
  }
  padding: 0 var(--vgo-space-1);
  gap: 0;
  font-size: var(--vgo-font-md);
  cursor: text;

  // 溢出折叠时允许保留的末尾 crumb 收缩省略，而不是被裁掉
  &.has-overflow {
    .address-bar__crumb-wrap {
      flex-shrink: 1;
      min-width: 0;
    }

    .address-bar__crumb {
      flex-shrink: 1;
      min-width: 0;
    }
  }
}

// 最左侧：当前根（Storage / 挂载点）图标，点开 Storage 列表
.address-bar__root {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--vgo-icon-md);
  height: var(--vgo-icon-md);
  margin-inline-end: 2px;
  border-radius: var(--vgo-radius);
  color: var(--vgo-text-secondary);
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--vgo-hover);
    color: var(--vgo-text);
  }

  &:focus-visible {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  &.is-open {
    color: var(--vgo-primary);
    background-color: var(--vgo-primary-opacity);
  }

  > svg {
    font-size: var(--vgo-icon-sm);
    line-height: 1;
  }
}

.address-bar__crumb-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.address-bar__crumb {
  flex-shrink: 0;
  max-width: 200px;
  padding: var(--vgo-space-1);
  margin: 0;
  border-radius: var(--vgo-radius);
  line-height: 1.3;
  cursor: pointer;
  text-align: left;

  &:hover,
  &:focus-visible {
    background: var(--vgo-primary-opacity);
  }

  &:focus-visible {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  &.is-drop-target {
    background-color: var(--vgo-primary-opacity);
    outline: 2px dashed var(--vgo-primary);
    outline-offset: -2px;
  }
}

.address-bar__crumb--placeholder {
  max-width: none;
  color: var(--vgo-text-placeholder);
}

.address-bar__crumb-text {
  display: block;
  line-height: 1.3;
}

.address-bar__crumb-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--vgo-icon-md);
  height: var(--vgo-icon-md);
  margin: 0 2px;
  border-radius: var(--vgo-radius);
  color: var(--vgo-text-secondary);
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--vgo-hover);
    color: var(--vgo-text);
  }

  &:focus-visible {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  &.is-open {
    color: var(--vgo-primary);
    background-color: var(--vgo-primary-opacity);
  }

  > svg {
    font-size: var(--vgo-icon-sm);
    line-height: 1;
  }
}
</style>
