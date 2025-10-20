<script lang="ts" setup>
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IEntry } from '@server/types/server'
import type { Column } from '@/views/FileManager/ExplorerUI/FileTable.vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import { SortType } from '@server/types/server'
import { useDebounceFn, useEventListener, useVModel, watchDebounced } from '@vueuse/core'
import { contextMenuTheme } from '@/hooks/use-global-theme.ts'
import { bytesToSize, formatDate } from '@/utils'
import { getFileIconClass } from '@/views/FileManager/ExplorerUI/file-icons.ts'
import FileTable from '@/views/FileManager/ExplorerUI/FileTable.vue'
import { getTooltip } from '@/views/FileManager/ExplorerUI/hooks/use-file-item.ts'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import UploadQueue from '../UploadQueue.vue'
import { ExplorerEvents, useExplorerBusOn } from '../utils/bus'
import FileGridItem from './FileGridItem.vue'
import { useCopyPaste } from './hooks/use-copy-paste'
import { useFileActions } from './hooks/use-file-actions'
import { useLayoutSort } from './hooks/use-layout-sort'
import { useSelection } from './hooks/use-selection'
import { useTransfer } from './hooks/use-transfer'

const props = withDefaults(
  defineProps<{
    files: IEntry[]
    isLoading: boolean
    basePath: string
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    contentOnly?: boolean
    gridView?: boolean
    // 设置 selectables 防止跨层级选择
    selectables?: string[]
  }>(),
  {
    selectables: () => ['.explorer-list-wrap .selectable'],
  },
)

const emit = defineEmits(['open', 'update:isLoading', 'refresh'])

const { basePath, files, selectFileMode, multiple } = toRefs(props)
const isLoading = useVModel(props, 'isLoading', emit)
useExplorerBusOn(ExplorerEvents.REFRESH, () => emit('refresh'))

// 缓存路径状态
const stateMap = ref<{ [key: string]: { position?: number, sortMode?: SortType } }>({})

// 布局和排序方式
const sortMode = computed<SortType>({
  get: () => {
    return stateMap.value[basePath.value]?.sortMode || SortType.default
  },
  set: (val) => {
    if (!stateMap.value[basePath.value]) {
      stateMap.value[basePath.value] = { sortMode: val }
    }
    else {
      stateMap.value[basePath.value].sortMode = val
    }
  },
})
const { isGridView, sortOptions, sortedFiles, showHidden }
  = useLayoutSort(files, sortMode)

const iconSizeList = ref(16)
const iconSizeGrid = ref(48)
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
              class: `title-text text-overflow ${item.error ? 'error' : ''}`,
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
          return h('span', {
            class: `mdi ${isDesc ? 'mdi-menu-down' : 'mdi-menu-up'}`,
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
  toggleSelect,
  toggleSelectAll,
  selectedPaths,
} = useSelection({
  sortedFiles,
  basePath,
  allowMultipleSelection,
  selectables: props.selectables,
})

// 复制粘贴功能
const { enablePaste, handleCut, handleCopy, handlePaste } = useCopyPaste({
  selectedPaths,
  basePath,
  isLoading,
  emit,
})

// 上传下载功能
const {
  uploadQueueRef,
  dropZoneRef,
  isOverDropZone,
  selectUploadFiles,
  selectUploadFolder,
  handleDownload,
  confirmDownload,
} = useTransfer({ basePath, isLoading, selectedItems })

watch(isLoading, (val) => {
  if (!val) {
    dropZoneRef.value?.focus()
  }
})

// 文件操作功能
const {
  handleCreateFile,
  handleCreateFolder,
  handleRename,
  confirmDelete,
  ctxMenuOptions,
  handleShowCtxMenu,
  enableAction,
} = useFileActions({
  isLoading,
  selectedPaths,
  basePath,
  selectedItems,
  enablePaste,
  handlePaste,
  handleCut,
  handleCopy,
  selectedItemsSet,
  handleDownload,
  emit,
})

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

function updateMenuOptions(item: IEntry | null, event: MouseEvent) {
  handleShowCtxMenu(item, event, getMenuOptions)
}
function updateMenuOptions2(event: MouseEvent) {
  const button = event.target?.closest('button') as HTMLElement
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    theme: contextMenuTheme.value,
    items: getMenuOptions(),
  })
}

function handleShortcutKey(event) {
  const key = event.key?.toLowerCase()
  const isCtrlOrMeta = event.ctrlKey || event.metaKey
  if (isCtrlOrMeta && !event.shiftKey) {
    if (key === 'r') {
      event.preventDefault()
      emit('refresh')
    }
    else if (key === 'a') {
      event.preventDefault()
      toggleSelectAll()
    }
    else if (key === 'x') {
      event.preventDefault()
      handleCut()
    }
    else if (key === 'c') {
      event.preventDefault()
      handleCopy()
    }
    else if (key === 'v') {
      event.preventDefault()
      handlePaste()
    }
    else if (key === 'h') {
      event.preventDefault()
      showHidden.value = !showHidden.value
    }
    else if (key === 'm') {
      event.preventDefault()
      updateMenuOptions(null, event)
    }
  }
  else {
    if (key === 'delete') {
      event.preventDefault()
      confirmDelete()
    }
  }
}

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

watchDebounced(files, () => {
  if (stateMap.value[basePath.value]) {
    const position = stateMap.value[basePath.value]?.position || 0
    getSetScrollPosition('set', position)
    // console.log('restore', basePath.value, position)
  }
}, { debounce: 100, maxWait: 1000 })
const debounceHandleScroll = useDebounceFn(() => {
  const position = getSetScrollPosition('get')
  if (!stateMap.value[basePath.value]) {
    stateMap.value[basePath.value] = { position }
  }
  else {
    stateMap.value[basePath.value].position = position
  }

  // console.log('save', basePath.value, position)
}, 500)
useEventListener(explorerContentRef, 'scroll', debounceHandleScroll)

defineExpose({
  selectedItems,
  basePath,
  handleShortcutKey,
  handleCreateFile,
  sortedFiles,
})
</script>

<template>
  <div
    ref="dropZoneRef"
    :class="{ isOverDropZone }"
    class="explorer-list-wrap"
    @contextmenu.prevent
  >
    <transition name="fade">
      <div v-if="isLoading" class="os-loading-container _absolute">
        <div class="vgo-panel">
          Loading...
        </div>
      </div>
    </transition>
    <div v-if="!contentOnly" class="explorer-actions vgo-panel">
      <div class="action-group">
        <button
          class="btn-action btn-no-style"
          title="Create Document"
          @click="handleCreateFile()"
        >
          <span class="mdi mdi-file-document-plus-outline" />
        </button>
        <button
          class="btn-action btn-no-style"
          title="Create Folder"
          @click="handleCreateFolder()"
        >
          <span class="mdi mdi-folder-plus-outline" />
        </button>

        <template v-if="!selectFileMode">
          <div class="split-line" />

          <button
            class="btn-action btn-no-style"
            title="Upload Files..."
            @click="() => selectUploadFiles()"
          >
            <span class="mdi mdi-file-upload-outline" />
          </button>
          <button
            class="btn-action btn-no-style"
            title="Upload Folder..."
            @click="() => selectUploadFolder()"
          >
            <span class="mdi mdi-folder-upload-outline" />
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            title="Download"
            @click="confirmDownload"
          >
            <span class="mdi mdi-download" />
          </button>

          <div class="split-line" />

          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            title="Cut (ctrl+x)"
            @click="handleCut"
          >
            <span class="mdi mdi-content-cut" />
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            title="Copy (ctrl+c)"
            @click="handleCopy"
          >
            <span class="mdi mdi-content-copy" />
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enablePaste"
            title="Paste (ctrl+v)"
            @click="handlePaste"
          >
            <span class="mdi mdi-content-paste" />
          </button>

          <button
            class="btn-action btn-no-style"
            :disabled="selectedItems.length !== 1"
            title="Rename"
            @click="handleRename"
          >
            <span class="mdi mdi-rename" />
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            title="Delete (del)"
            @click="confirmDelete"
          >
            <span class="mdi mdi-delete-forever-outline" />
          </button>
        </template>
      </div>
      <div class="action-group">
        <button
          class="btn-action btn-no-style"
          title="Toggle hidden file visible (ctrl+h)"
          @click="showHidden = !showHidden"
        >
          <template v-if="showHidden">
            <span class="mdi mdi-eye-outline" />
          </template>
          <template v-else>
            <span class="mdi mdi-eye-off-outline" />
          </template>
        </button>

        <template v-if="!selectFileMode || (selectFileMode && multiple)">
          <button
            class="btn-action btn-no-style"
            title="Toggle Select All (ctrl+a)"
            @click="toggleSelectAll"
          >
            <span class="mdi mdi-check-all" />
          </button>
        </template>

        <button
          class="btn-action btn-no-style"
          title="Menu (ctrl+m)"
          @click="updateMenuOptions2($event)"
        >
          <span class="mdi mdi-dots-vertical" />
        </button>
      </div>
    </div>

    <div
      ref="explorerContentRef"
      class="explorer-content"
      @click="selectedItemsSet.clear()"
      @contextmenu.prevent.stop="updateMenuOptions(null, $event)"
    >
      <div v-if="!(isGridView || gridView)" class="explorer-list-view">
        <FileTable
          v-model:selected-rows="selectedItemsSet"
          :columns="tableColumns"
          :data="sortedFiles"
          :get-tooltip="(row) => getTooltip(row)"
          :custom-toggle="toggleSelect"
          :row-contextmenu="updateMenuOptions"
          @open="(row) => emit('open', { item: row })"
        />
      </div>
      <div v-else class="explorer-grid-view">
        <FileGridItem
          v-for="item in sortedFiles"
          :key="item.name"
          class="selectable"
          :item="item"
          :base-path="basePath"
          :data-name="item.name"
          :active="selectedItemsSet.has(item)"
          :show-checkbox="allowMultipleSelection"
          :icon-size="iconSizeGrid"
          @open="(i) => emit('open', i)"
          @select="toggleSelect"
          @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
        />
      </div>
    </div>
    <div v-if="!contentOnly" class="explorer-status-bar">
      <div>
        {{ sortedFiles.length }} Item(s)
        <template v-if="selectedItems.length">
          | {{ selectedItems.length }} item(s) selected |
          {{ bytesToSize(selectedItemsSize) }}
        </template>
      </div>

      <div class="flex-row-center-gap">
        <el-slider v-if="!isGridView" v-model="iconSizeList" :min="16" :max="128" :step="2" size="small" :show-tooltip="false" />
        <el-slider v-else v-model="iconSizeGrid" :min="48" :max="512" :step="8" size="small" :show-tooltip="false" />
        <button
          class="btn-action btn-no-style"
          title="Toggle grid view"
          @click="isGridView = !isGridView"
        >
          <template v-if="isGridView">
            <span class="mdi mdi-view-grid-outline" />
          </template>
          <template v-else>
            <span class="mdi mdi-view-list-outline" />
          </template>
        </button>
      </div>
    </div>

    <UploadQueue ref="uploadQueueRef" auto-close @all-done="emit('refresh')" />
  </div>
</template>

<style lang="scss" scoped>
.explorer-list-wrap {
  height: 100%;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &.isOverDropZone {
    outline: 2px dashed var(--vgo-primary);
    outline-offset: -3px;
  }

  .explorer-actions {
    padding: 4px;
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: space-between;
    border: none;
    box-shadow: none;
    border-radius: 0;
    border-bottom: 1px solid var(--vgo-color-border);

    @media screen and (max-width: $mq_mobile_width) {
      justify-content: flex-end;
    }

    .action-group {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      @media screen and (max-width: $mq_mobile_width) {
        justify-content: flex-end;
      }

      .split-line {
        border-right: 1px solid var(--vgo-color-border);
        margin-left: 2px;
        margin-right: 2px;
      }

      .btn-action {
        display: inline-flex;
        position: relative;
        font-size: 20px;
        border: none;
        padding: 2px 4px;
        border-radius: 4px;

        .icon-small-abs {
          font-size: 12px;
          position: absolute;
          left: 50%;
          top: 60%;
          transform: translate(-50%, -50%) scale(0.6);
        }

        &:hover,
        &:focus {
          background-color: var(--vgo-primary-opacity);
        }

        &:disabled {
          background-color: transparent;
        }
      }

      .action-button-wrap {
        display: inline-flex;
        position: relative;
        z-index: 10;

        .quick-options {
          position: absolute;
          top: 100%;
          right: 0;
          left: unset;
          transform: unset;
          width: 200px;
        }
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

  .explorer-list-view {
    width: fit-content;
  }

  .explorer-grid-view {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 10px;
    flex-wrap: wrap;
    gap: 4px;
  }

  .explorer-status-bar {
    border-top: 1px solid var(--vgo-color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 4px 8px;
    font-size: 12px;

    @media screen and (max-width: $mq_mobile_width) {
      justify-content: flex-end;
    }

    .mdi {
      display: flex;
      transform: scale(1.2);
    }

    .el-slider {
      width: 100px;
    }
  }

  :deep(.title-wrapper) {
    display: flex;
    align-items: center;
    gap: 4px;
    &.hidden {
      opacity: 0.6;
    }
    .themed-icon {
      width: fit-content;
      font-size: 16px;
    }
    .title-text {
      cursor: pointer;
      &:hover {
        text-decoration: underline;
      }
      &.error {
        color: #f44336;
      }
    }
  }
}
</style>
