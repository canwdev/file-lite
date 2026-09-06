<script lang="ts" setup>
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { FileFilterState } from './file-filter'
import type { IEntry } from '@/types/server'
import type { Column } from '@/views/FileManager/ExplorerUI/FileTable.vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useDebounceFn, useEventListener, useVModel, watchDebounced } from '@vueuse/core'
import { computed, h, inject, nextTick, ref, toRefs, watch } from 'vue'
import MdiMenuDown from '~icons/mdi/menu-down'
import MdiMenuUp from '~icons/mdi/menu-up'
import { menuThemeOptions } from '@/hooks/use-global-theme.ts'
import { shortcutScopeKey, useShortcut } from '@/hooks/use-shortcut'
import { localSettingsStore } from '@/store'
import { SortType } from '@/types/server'
import { bytesToSize, formatDate } from '@/utils'
import { resolveMenuIcons } from '@/utils/icons'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons.ts'
import FileTable from '@/views/FileManager/ExplorerUI/FileTable.vue'
import { getTooltip } from '@/views/FileManager/ExplorerUI/hooks/use-file-item.ts'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import TransferQueue from '../TransferQueue.vue'
import { ExplorerEvents, useExplorerBusOn } from '../utils/bus'
import { explorerStateMap, pathStateRef } from './explorer-state'
import { createDefaultFileFilter, isFileFilterActive } from './file-filter'
import FileGridItem from './FileGridItem.vue'
import { useCopyPaste } from './hooks/use-copy-paste'
import { getOpenActionMeta, useFileActions } from './hooks/use-file-actions'
import { useLayoutSort } from './hooks/use-layout-sort'
import { useSelection } from './hooks/use-selection'
import { useSystemClipboardPaste } from './hooks/use-system-clipboard-paste'
import { useTransfer } from './hooks/use-transfer'
import { useVirtualGrid, useVirtualList } from './hooks/use-virtual-files'

const props = withDefaults(
  defineProps<{
    files: IEntry[]
    isLoading: boolean
    basePath: string
    filter?: FileFilterState
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    // 是否让筛选条件同样作用于文件夹
    filterDirectories?: boolean
    contentOnly?: boolean
    gridView?: boolean
    // 设置 selectables 防止跨层级选择
    selectables?: string[]
  }>(),
  {
    selectables: () => ['.explorer-list-wrap .selectable'],
    filter: () => createDefaultFileFilter(),
    filterDirectories: false,
  },
)

const emit = defineEmits(['open', 'openPathInNewTab', 'update:isLoading', 'refresh', 'clearFilter'])

const { basePath, files, filter, filterDirectories, selectFileMode, multiple } = toRefs(props)
const shortcutScope = inject(shortcutScopeKey, 'fileManager')
const isLoading = useVModel(props, 'isLoading', emit) as unknown as Ref<boolean>
useExplorerBusOn(ExplorerEvents.REFRESH, () => emit('refresh'))

const sortMode = pathStateRef(basePath, 'sortMode', SortType.default)
const isGridView = computed({
  get: () => localSettingsStore.value.isGridView,
  set: (val: boolean) => { localSettingsStore.value.isGridView = val },
})
const iconSizeList = computed({
  get: () => localSettingsStore.value.iconSizeList,
  set: (val: number) => { localSettingsStore.value.iconSizeList = val },
})
const iconSizeGrid = computed({
  get: () => localSettingsStore.value.iconSizeGrid,
  set: (val: number) => { localSettingsStore.value.iconSizeGrid = val },
})
const showHidden = computed({
  get: () => localSettingsStore.value.showHidden,
  set: (val: boolean) => { localSettingsStore.value.showHidden = val },
})
const isGridMode = computed(() => isGridView.value || props.gridView)

const { sortOptions, sortedFiles } = useLayoutSort(files, sortMode, showHidden)

const filteredFiles = computed(() => {
  const filterValue = filter.value
  const search = filterValue.text.trim()
  if (!search)
    return sortedFiles.value

  if (!filterValue.regex) {
    const needle = filterValue.caseSensitive ? search : search.toLowerCase()
    return sortedFiles.value.filter((item) => {
      if (item.isDirectory && !filterDirectories.value)
        return true
      const name = filterValue.caseSensitive ? item.name : item.name.toLowerCase()
      return name.includes(needle)
    })
  }

  try {
    const reg = new RegExp(search, filterValue.caseSensitive ? '' : 'i')
    return sortedFiles.value.filter(item =>
      (item.isDirectory && !filterDirectories.value) || reg.test(item.name),
    )
  }
  catch {
    return []
  }
})

const isFilterActive = computed(() => isFileFilterActive(filter.value))
const isDirectoryEmpty = computed(() => !isLoading.value && sortedFiles.value.length === 0)
const isFilterEmpty = computed(() =>
  !isLoading.value && isFilterActive.value && filteredFiles.value.length === 0 && sortedFiles.value.length > 0,
)
const emptyState = computed(() => {
  if (isDirectoryEmpty.value) {
    return {
      icon: 'mdi mdi-folder-open-outline',
      title: 'No files',
      description: 'This folder is empty.',
      showClear: false,
    }
  }

  if (isFilterEmpty.value) {
    return {
      icon: 'mdi mdi-filter-remove-outline',
      title: 'No matches',
      description: 'No files match the current filter.',
      showClear: true,
    }
  }

  return null
})

function toggleShowHiddenFiles() {
  showHidden.value = !showHidden.value
}
const tableColumns = computed(() => {
  return [
    {
      key: 'name',
      label: 'Name',
      width: 240,
      render: (item: IEntry) => {
        return h('div', { class: `title-wrapper ${item.hidden ? 'hidden' : ''}` }, [
          h(ThemedIcon, {
            iconClass: `mdi ${getFileIconClass(item)}`,
            item,
            absPath: `${basePath.value}/${item.name}`,
            iconSize: iconSizeList.value,
          }),
          h(
            'span',
            {
              class: `title-text vgo-u-text-overflow ${item.error ? 'error' : ''}`,
              onClick: (e) => {
                e.stopPropagation()
                emit('open', { item })
              },
            },
            item.name,
          ),
        ])
      },
      sortModes: [SortType.name, SortType.nameDesc],
    },
    {
      key: 'ext',
      label: 'Ext',
      width: 70,
      formatter: (item: IEntry) => (item.ext || '').replace(/^\./, ''),
      sortModes: [SortType.extension, SortType.extensionDesc],
    },
    {
      key: 'size',
      label: 'Size',
      width: 80,
      formatter: (item: IEntry) =>
        item.size === null ? '-' : bytesToSize(item.size),
      sortModes: [SortType.sizeDesc, SortType.size],
    },
    {
      key: 'lastModified',
      label: 'Last Modified',
      width: 140,
      formatter: (item: IEntry) => formatDate(item.lastModified),
      sortModes: [SortType.lastModifiedDesc, SortType.lastModified],
    },
    {
      key: 'birthtime',
      label: 'Created',
      width: 140,
      formatter: (item: IEntry) => formatDate(item.birthtime),
      sortModes: [SortType.birthTimeDesc, SortType.birthTime],
    },
  ].map((item) => {
    return {
      ...item,
      columnClick: () => {
        const idx = (item.sortModes || []).findIndex(
          (m: SortType) => m === sortMode.value,
        )
        const nextMode = idx + 1
        sortMode.value = item.sortModes[nextMode] || SortType.default
      },
      columnRightRender: () => {
        const idx = (item.sortModes || []).findIndex(
          (m: SortType) => m === sortMode.value,
        )
        const active = idx > -1
        const isDesc = /Desc$/i.test(sortMode.value)
        if (active) {
          return h(isDesc ? MdiMenuDown : MdiMenuUp, {
            style: 'line-height: 1; transform: scale(1.4)',
          })
        }
      },
    }
  }) as Column[]
})

const allowMultipleSelection = computed(() => {
  if (selectFileMode.value === 'folder') {
    return false
  }
  else if (selectFileMode.value === 'file') {
    return multiple.value
  }
  return true
})
// 文件选择功能
const {
  selectedItemsSet,
  selectedItemsSize,
  selectedItems,
  explorerContentRef,
  selectionBoxStyle,
  handleContentMouseDown,
  handleContentClick,
  handleContentClickCapture,
  toggleSelect,
  toggleSelectAll,
  selectByNames,
  selectedPaths,
} = useSelection({
  files: filteredFiles,
  basePath,
  isLoading,
  allowMultipleSelection,
  selectables: props.selectables,
  getItemsInSelectionRect,
})

const listRowHeight = computed(() => Math.max(iconSizeList.value + 18, 37))
const gridItemWidth = computed(() => iconSizeGrid.value + 42)
const gridItemHeight = computed(() => iconSizeGrid.value + 62)
const virtualList = useVirtualList({
  items: filteredFiles,
  containerRef: explorerContentRef,
  itemHeight: listRowHeight,
  overscan: 12,
})
const virtualGrid = useVirtualGrid({
  items: filteredFiles,
  containerRef: explorerContentRef,
  itemHeight: gridItemHeight,
  itemWidth: gridItemWidth,
  gap: 4,
  padding: 10,
  overscan: 3,
})
const virtualGridStyle = computed(() => ({
  height: `${virtualGrid.totalHeight.value}px`,
}))
const virtualGridItemsStyle = computed(() => ({
  ...virtualGrid.gridStyle.value,
  transform: `translateY(${virtualGrid.offsetTop.value}px)`,
}))

function getItemsInSelectionRect(rect: {
  left: number
  top: number
  right: number
  bottom: number
}) {
  if (isGridMode.value) {
    return getGridItemsInSelectionRect(rect)
  }

  return getListItemsInSelectionRect(rect)
}

function getListItemsInSelectionRect(rect: {
  left: number
  top: number
  right: number
  bottom: number
}) {
  const contentEl = explorerContentRef.value
  const tableEl = contentEl?.querySelector('.explorer-list-view table')
  const headerHeight = contentEl?.querySelector('thead')?.getBoundingClientRect().height || listRowHeight.value
  const listBottom = headerHeight + filteredFiles.value.length * virtualList.itemHeight.value

  if (rect.top > listBottom || rect.bottom < headerHeight) {
    return []
  }

  if (contentEl && tableEl) {
    const contentRect = contentEl.getBoundingClientRect()
    const tableRect = tableEl.getBoundingClientRect()
    const tableLeft = tableRect.left - contentRect.left + contentEl.scrollLeft
    const tableRight = tableLeft + tableRect.width

    if (rect.left > tableRight || rect.right < tableLeft) {
      return []
    }
  }

  const startIndex = clampIndex(Math.floor((rect.top - headerHeight) / virtualList.itemHeight.value))
  const endIndex = clampIndex(Math.floor((rect.bottom - headerHeight) / virtualList.itemHeight.value))

  return filteredFiles.value.slice(startIndex, endIndex + 1)
}

function getGridItemsInSelectionRect(rect: {
  left: number
  top: number
  right: number
  bottom: number
}) {
  const padding = 10
  const gap = 4
  const itemWidth = virtualGrid.itemWidth.value
  const itemHeight = virtualGrid.itemHeight.value
  const cellWidth = itemWidth + gap
  const cellHeight = itemHeight + gap
  const columns = virtualGrid.columns.value
  const totalRows = Math.ceil(filteredFiles.value.length / columns)
  const startRow = Math.max(Math.floor((rect.top - padding) / cellHeight) - 1, 0)
  const endRow = Math.min(Math.floor((rect.bottom - padding) / cellHeight) + 1, totalRows - 1)
  const startColumn = Math.max(Math.floor((rect.left - padding) / cellWidth) - 1, 0)
  const endColumn = Math.min(Math.floor((rect.right - padding) / cellWidth) + 1, columns - 1)
  const items: IEntry[] = []

  for (let row = startRow; row <= endRow; row++) {
    for (let column = startColumn; column <= endColumn; column++) {
      const item = filteredFiles.value[row * columns + column]
      const itemRect = {
        left: padding + column * cellWidth,
        top: padding + row * cellHeight,
        right: padding + column * cellWidth + itemWidth,
        bottom: padding + row * cellHeight + itemHeight,
      }
      if (item && rectsIntersect(rect, itemRect)) {
        items.push(item)
      }
    }
  }

  return items
}

function clampIndex(index: number) {
  return Math.min(Math.max(index, 0), Math.max(filteredFiles.value.length - 1, 0))
}

function rectsIntersect(
  a: { left: number, top: number, right: number, bottom: number },
  b: { left: number, top: number, right: number, bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

// 复制粘贴功能
const { enablePaste, handleCut, handleCopy, handlePaste, currentCutNames } = useCopyPaste({
  selectedPaths,
  basePath,
  isLoading,
  emit,
})

const { handlePasteFromClipboard } = useSystemClipboardPaste({
  basePath,
  entries: files,
  isLoading,
  emit,
})

// 上传下载功能
const {
  transferQueueRef,
  dropZoneRef,
  isOverDropZone,
  selectUploadFiles,
  selectUploadFolder,
  handleDownload,
  confirmDownload,
  downloadToFolder,
} = useTransfer({ basePath, isLoading, selectedItems })

function handleTransferAllDone(items: Array<{ type?: 'upload' | 'download', status?: 'success' | 'failed' | 'pending' | 'transferring' }>) {
  // 只有存在成功上传时目录内容才可能变化、需要刷新；全部失败/取消则无需刷新
  const hasUploadSuccess = items.some(item => (item.type ?? 'upload') === 'upload' && item.status === 'success')
  if (hasUploadSuccess) {
    emit('refresh')
  }
}

watch(isLoading, (val) => {
  if (!val) {
    focusFileList()
  }
})

async function focusFileList() {
  await nextTick()
  dropZoneRef.value?.focus()
}

// 新建后待选中的文件名（等列表刷新出来再 selectAndReveal）
const pendingRevealName = ref<string | null>(null)

// 文件操作功能
const {
  handleOpen,
  handleCreateFile,
  handleCreateFolder,
  handleRename: renameSelected,
  confirmDelete,
  ctxMenuOptions,
  handleShowCtxMenu,
  enableAction,
} = useFileActions({
  isLoading,
  selectedPaths,
  basePath,
  selectedItems,
  entries: files,
  enablePaste,
  handlePaste,
  handlePasteFromClipboard,
  handleCut,
  handleCopy,
  selectedItemsSet,
  handleDownload,
  downloadToFolder,
  emit,
  onEntryCreated: (name) => {
    pendingRevealName.value = name
  },
})

watch(files, () => {
  const name = pendingRevealName.value
  if (!name || !files.value.some(item => item.name === name))
    return
  pendingRevealName.value = null
  nextTick(() => selectAndReveal(name))
})

const openActionMeta = computed(() => {
  return selectedItems.value.length === 1 ? getOpenActionMeta(selectedItems.value[0]) : null
})

async function handleRename() {
  await renameSelected()
  focusFileList()
}

function getMenuOptions() {
  let contextMenuOptions: MenuItem[] = []
  if (selectedItems.value.length) {
    contextMenuOptions = ctxMenuOptions.value
  }
  else {
    contextMenuOptions = [
      {
        label: 'Create File',
        icon: 'mdi mdi-file-document-plus-outline',
        onClick() {
          handleCreateFile()
        },
      },
      {
        label: 'Create Folder',
        icon: 'mdi mdi-folder-plus-outline',
        onClick() {
          handleCreateFolder()
        },
        divided: true,
      },
      {
        label: 'Upload Files...',
        icon: 'mdi mdi-file-upload-outline',
        onClick() {
          selectUploadFiles()
        },
      },
      {
        label: 'Upload Folder...',
        icon: 'mdi mdi-folder-upload-outline',
        onClick() {
          selectUploadFolder()
        },
        divided: true,
      },
      {
        label: 'Sort',
        icon: 'mdi mdi-sort-alphabetical-variant',
        children: sortOptions.value,
        divided: true,
      },
      ...ctxMenuOptions.value,
    ]
  }
  return contextMenuOptions
}

function updateMenuOptions(item: IEntry | null, event: MouseEvent | KeyboardEvent) {
  handleShowCtxMenu(item, event, getMenuOptions)
}
function updateMenuOptions2(event: MouseEvent) {
  const button = (event.target as HTMLElement)?.closest('button') as HTMLElement
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    ...menuThemeOptions,
    items: resolveMenuIcons(getMenuOptions()),
  })
}

function selectKeyboardItem(index: number) {
  const items = filteredFiles.value
  if (!items.length) {
    return
  }

  const nextIndex = Math.min(Math.max(index, 0), items.length - 1)
  const nextItem = items[nextIndex]
  if (!nextItem) {
    return
  }

  selectByNames([nextItem.name])
  nextTick(() => scrollToItemIndex(nextIndex))
}

function moveKeyboardSelection(offset: number) {
  const items = filteredFiles.value
  if (!items.length) {
    return
  }

  const currentName = selectedItems.value[0]?.name
  const currentIndex = currentName
    ? items.findIndex(item => item.name === currentName)
    : -1
  const fallbackIndex = offset > 0 ? -1 : items.length
  selectKeyboardItem((currentIndex === -1 ? fallbackIndex : currentIndex) + offset)
}

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+r', 'meta+r'],
  handler: () => emit('refresh'),
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+a', 'meta+a'],
  handler: toggleSelectAll,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+x', 'meta+x'],
  handler: handleCut,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+c', 'meta+c'],
  handler: handleCopy,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+v', 'meta+v'],
  handler: handlePaste,
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+h', 'meta+h'],
  handler: () => {
    showHidden.value = !showHidden.value
  },
})

useShortcut({
  scope: shortcutScope,
  combo: ['ctrl+m', 'meta+m'],
  handler: event => updateMenuOptions(null, event),
})

useShortcut({
  scope: shortcutScope,
  combo: 'delete',
  handler: confirmDelete,
})

useShortcut({
  scope: shortcutScope,
  combo: 'f2',
  handler: handleRename,
})

useShortcut({
  scope: shortcutScope,
  combo: 'f3',
  handler: handleOpen,
})

useShortcut({
  scope: shortcutScope,
  combo: 'enter',
  handler: handleOpen,
})

useShortcut({
  scope: shortcutScope,
  combo: 'f7',
  handler: handleCreateFolder,
})

useShortcut({
  scope: shortcutScope,
  combo: 'arrowup',
  handler: () => moveKeyboardSelection(-1),
})

useShortcut({
  scope: shortcutScope,
  combo: 'arrowdown',
  handler: () => moveKeyboardSelection(1),
})

useShortcut({
  scope: shortcutScope,
  combo: 'home',
  handler: () => selectKeyboardItem(0),
})

useShortcut({
  scope: shortcutScope,
  combo: 'end',
  handler: () => selectKeyboardItem(filteredFiles.value.length - 1),
})

// 缓存滚动位置
function getSetScrollPosition(action: 'get' | 'set', value = 0) {
  const el = explorerContentRef.value
  if (!el) {
    return 0
  }
  if (action === 'get') {
    return el.scrollTop
  }
  else if (action === 'set') {
    el.scrollTop = value
  }
}

function scrollToItemIndex(index: number) {
  const el = explorerContentRef.value
  if (!el || index < 0) {
    return
  }

  const targetTop = isGridMode.value
    ? 10 + Math.floor(index / virtualGrid.columns.value) * virtualGrid.rowHeight.value
    : index * virtualList.itemHeight.value
  const itemHeight = isGridMode.value ? virtualGrid.rowHeight.value : virtualList.itemHeight.value
  const scrollTop = Math.max(targetTop - (el.clientHeight - itemHeight) / 2, 0)

  el.scrollTop = scrollTop
  virtualList.refresh()
  virtualGrid.refresh()
}

function selectAndReveal(name: string) {
  const index = filteredFiles.value.findIndex(item => item.name === name)
  if (index === -1) {
    return
  }

  selectByNames([name])
  nextTick(() => scrollToItemIndex(index))
}

watchDebounced(files, () => {
  if (explorerStateMap.value[basePath.value]) {
    const position = explorerStateMap.value[basePath.value]?.position || 0
    nextTick(() => {
      virtualList.refresh()
      virtualGrid.refresh()
      getSetScrollPosition('set', position)
      virtualList.refresh()
      virtualGrid.refresh()
      // console.log('restore', basePath.value, position)
    })
  }
}, { debounce: 100, maxWait: 1000 })
const debounceHandleScroll = useDebounceFn(() => {
  const position = getSetScrollPosition('get')
  if (!explorerStateMap.value[basePath.value]) {
    explorerStateMap.value[basePath.value] = { position }
  }
  else {
    explorerStateMap.value[basePath.value].position = position
  }

  // console.log('save', basePath.value, position)
}, 500)
useEventListener(() => explorerContentRef.value, 'scroll', debounceHandleScroll)

defineExpose({
  selectedItems,
  selectByNames,
  selectAndReveal,
  basePath,
  handleCreateFile,
  sortedFiles,
  filteredFiles,
  files,
})
</script>

<template>
  <div
    ref="dropZoneRef"
    :class="{ isOverDropZone }"
    class="explorer-list-wrap"
    tabindex="-1"
    @contextmenu.prevent
  >
    <transition name="fade">
      <div v-if="isLoading" class="os-loading-container _absolute">
        <div class="vgo-panel">
          Loading...
        </div>
      </div>
    </transition>
    <div v-if="!contentOnly" class="explorer-actions vgo-panel vgo-panel--flat">
      <div class="action-group">
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          title="Create Document"
          @click="handleCreateFile()"
        >
          <i-mdi-file-document-plus-outline />
        </button>
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          title="Create Folder"
          @click="handleCreateFolder()"
        >
          <i-mdi-folder-plus-outline />
        </button>

        <template v-if="!selectFileMode">
          <div class="split-line" />

          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Upload Files..."
            @click="() => selectUploadFiles()"
          >
            <i-mdi-file-upload-outline />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Upload Folder..."
            @click="() => selectUploadFolder()"
          >
            <i-mdi-folder-upload-outline />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Download"
            @click="confirmDownload"
          >
            <i-mdi-download />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Download to Folder..."
            @click="downloadToFolder"
          >
            <i-mdi-folder-download-outline />
          </button>

          <div class="split-line" />

          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :disabled="!enableAction"
            title="Cut (ctrl+x)"
            @click="handleCut"
          >
            <i-mdi-content-cut />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :disabled="!enableAction"
            title="Copy (ctrl+c)"
            @click="handleCopy"
          >
            <i-mdi-content-copy />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :disabled="!enablePaste"
            title="Paste (ctrl+v)"
            @click="handlePaste"
          >
            <i-mdi-content-paste />
          </button>

          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :disabled="selectedItems.length !== 1"
            title="Rename"
            @click="handleRename"
          >
            <i-mdi-rename />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :disabled="!enableAction"
            title="Delete (del)"
            @click="confirmDelete"
          >
            <i-mdi-delete-forever-outline />
          </button>
        </template>
      </div>
      <div class="action-group">
        <button
          v-if="openActionMeta"
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          :title="`${openActionMeta.label} (F3)`"
          @click="handleOpen"
        >
          <MdiIcon :name="openActionMeta.icon" />
        </button>

        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          title="Toggle hidden file visible (ctrl+h)"
          @click="toggleShowHiddenFiles"
        >
          <template v-if="showHidden">
            <i-mdi-eye-outline />
          </template>
          <template v-else>
            <i-mdi-eye-off-outline />
          </template>
        </button>

        <template v-if="!selectFileMode || (selectFileMode && multiple)">
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Toggle Select All (ctrl+a)"
            @click="toggleSelectAll"
          >
            <i-mdi-check-all />
          </button>
        </template>

        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          title="Menu (ctrl+m)"
          @click="updateMenuOptions2($event)"
        >
          <i-mdi-dots-vertical />
        </button>
      </div>
    </div>

    <div
      ref="explorerContentRef"
      class="explorer-content"
      @click.capture="handleContentClickCapture"
      @click="handleContentClick"
      @mousedown="handleContentMouseDown"
      @contextmenu.prevent.stop="updateMenuOptions(null, $event)"
    >
      <div
        v-if="selectionBoxStyle"
        class="explorer-selection-box"
        :style="selectionBoxStyle"
      />
      <div v-if="emptyState" class="vgo-empty explorer-empty-state">
        <MdiIcon class="vgo-empty__icon" :name="emptyState.icon" />
        <div class="vgo-empty__title">
          {{ emptyState.title }}
        </div>
        <div class="vgo-empty__desc">
          {{ emptyState.description }}
        </div>
        <button
          v-if="emptyState.showClear"
          class="vgo-button"
          @click.stop="emit('clearFilter')"
        >
          <i-mdi-filter-remove-outline />
          Clear filter
        </button>
      </div>
      <div v-else-if="!isGridMode" class="explorer-list-view">
        <FileTable
          v-model:selected-rows="selectedItemsSet"
          :columns="tableColumns"
          :data="filteredFiles"
          :virtual-rows="virtualList.visibleItems.value"
          :virtual-before-height="virtualList.beforeHeight.value"
          :virtual-after-height="virtualList.afterHeight.value"
          :virtual-row-height="virtualList.itemHeight.value"
          :get-tooltip="(row) => getTooltip(row)"
          :cut-names="currentCutNames"
          :custom-toggle="toggleSelect"
          :row-contextmenu="updateMenuOptions"
          @open="(row) => emit('open', { item: row })"
        />
      </div>
      <div v-else class="explorer-grid-view" :style="virtualGridStyle">
        <div class="explorer-grid-items" :style="virtualGridItemsStyle">
          <FileGridItem
            v-for="{ item } in virtualGrid.visibleItems.value"
            :key="item.name"
            class="selectable"
            :item="item"
            :base-path="basePath"
            :data-name="item.name"
            :active="selectedItemsSet.has(item)"
            :is-cut="currentCutNames.has(item.name)"
            :show-checkbox="allowMultipleSelection"
            :icon-size="iconSizeGrid"
            @open="(i) => emit('open', i)"
            @select="toggleSelect"
            @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
          />
        </div>
      </div>
    </div>
    <div v-if="!contentOnly" class="explorer-status-bar vgo-panel vgo-panel--flat">
      <div>
        {{ filteredFiles.length }} Item(s)
        <template v-if="selectedItems.length">
          | {{ selectedItems.length }} item(s) selected |
          {{ bytesToSize(selectedItemsSize) }}
        </template>
      </div>

      <div class="vgo-u-flex-wrap-center">
        <el-slider v-if="!isGridView" v-model="iconSizeList" :min="16" :max="128" :step="2" size="small" :show-tooltip="false" />
        <el-slider v-else v-model="iconSizeGrid" :min="48" :max="512" :step="8" size="small" :show-tooltip="false" />
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
          title="Toggle grid view"
          @click="isGridView = !isGridView"
        >
          <template v-if="isGridView">
            <i-mdi-view-grid-outline />
          </template>
          <template v-else>
            <i-mdi-view-list-outline />
          </template>
        </button>
      </div>
    </div>

    <TransferQueue ref="transferQueueRef" auto-close @all-done="handleTransferAllDone" />
  </div>
</template>

<style lang="scss" scoped>
.explorer-list-wrap {
  height: 100%;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &:focus {
    outline: none;
  }

  &.isOverDropZone {
    outline: 2px dashed var(--vgo-primary);
    outline-offset: -3px;
  }

  .explorer-actions {
    padding: var(--vgo-space-1) var(--vgo-space-1);
    display: flex;
    gap: var(--vgo-space-1);
    flex-wrap: wrap;
    justify-content: space-between;
    border-bottom: 1px solid var(--vgo-border);

    @media screen and (max-width: $mq_mobile_width) {
      justify-content: flex-end;
    }

    .action-group {
      display: flex;
      gap: var(--vgo-space-1);
      flex-wrap: wrap;

      .split-line {
        border-right: 1px solid var(--vgo-border);
        margin-inline: 2px;
      }
    }
  }

  .explorer-content {
    padding: 0 2px;
    flex: 1;
    overflow: auto;
    user-select: none;
    position: relative;
  }

  .explorer-selection-box {
    position: absolute;
    z-index: var(--vgo-z-overlay);
    pointer-events: none;
    border: 1px solid var(--vgo-primary);
    background-color: var(--vgo-primary-opacity);
  }

  .explorer-empty-state {
    min-height: 100%;
  }

  .explorer-list-view {
    width: fit-content;
  }

  .explorer-grid-view {
    position: relative;
    min-width: 100%;
  }

  .explorer-grid-items {
    position: absolute;
    top: 0;
    left: 10px;
    display: grid;
    align-items: start;
    justify-content: start;
    will-change: transform;
  }

  .explorer-status-bar {
    border-top: 1px solid var(--vgo-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--vgo-space-1) var(--vgo-space-4);
    padding: var(--vgo-space-1) var(--vgo-space-1) var(--vgo-space-1) var(--vgo-space-2);
    font-size: var(--vgo-font-sm);

    @media screen and (max-width: $mq_mobile_width) {
      justify-content: flex-end;
    }

    .el-slider {
      width: 100px;
    }
  }

  :deep(.title-wrapper) {
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    &.hidden {
      opacity: 0.6;
    }
    .themed-icon {
      width: fit-content;
      font-size: var(--vgo-icon-sm);
    }
    .title-text {
      cursor: pointer;
      &:hover {
        text-decoration: underline;
      }
      &.error {
        color: var(--vgo-danger);
      }
    }
  }

  :deep(.vgo-list-item) {
    cursor: default;
  }
}
</style>
