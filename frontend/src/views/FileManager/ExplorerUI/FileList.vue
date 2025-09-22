<script lang="ts" setup>
import {IEntry} from '@server/types/server'
import FileListItem from './FileListItem.vue'
import {useVModel} from '@vueuse/core'
import FileGridItem from './FileGridItem.vue'
import UploadQueue from '../UploadQueue.vue'
import {useCopyPaste} from './hooks/use-copy-paste'
import {ExplorerEvents, useExplorerBusOn} from '../utils/bus'
import {useLayoutSort} from './hooks/use-layout-sort'
import {useSelection} from './hooks/use-selection'
import {useFileActions} from './hooks/use-file-actions'
import {useTransfer} from './hooks/use-transfer'
import {bytesToSize} from '@/utils'
import ContextMenu, {MenuItem} from '@imengyu/vue3-context-menu'
import {contextMenuTheme} from '@/hooks/use-global-theme.ts'

const emit = defineEmits(['open', 'update:isLoading', 'refresh'])

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
const {basePath, files, selectFileMode, multiple} = toRefs(props)
const isLoading = useVModel(props, 'isLoading', emit)
useExplorerBusOn(ExplorerEvents.REFRESH, () => emit('refresh'))

// 布局和排序方式
const {isGridView, sortOptions, filteredFiles, showHidden, sortableListHeader} =
  useLayoutSort(files)

const allowMultipleSelection = computed(() => {
  if (selectFileMode.value === 'folder') {
    return false
  } else if (selectFileMode.value === 'file') {
    return multiple.value
  }
  return true
})
// 文件选择功能
const {
  selectedItems,
  selectedItemsSize,
  selectedItemsSet,
  explorerContentRef,
  toggleSelect,
  isAllSelected,
  toggleSelectAll,
  selectedPaths,
} = useSelection({filteredFiles, basePath, allowMultipleSelection, selectables: props.selectables})

// 复制粘贴功能
const {enablePaste, handleCut, handleCopy, handlePaste} = useCopyPaste({
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
} = useTransfer({basePath, isLoading, selectedItems})

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

const getMenuOptions = () => {
  let contextMenuOptions: MenuItem[] = []
  if (selectedItems.value.length) {
    contextMenuOptions = ctxMenuOptions.value
  } else {
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

const updateMenuOptions = (item: IEntry | null, event: MouseEvent) => {
  handleShowCtxMenu(item, event, getMenuOptions)
}
const updateMenuOptions2 = (event: MouseEvent) => {
  const button = event.target?.closest('button') as HTMLElement
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    theme: contextMenuTheme.value,
    items: getMenuOptions(),
  })
}

const handleShortcutKey = (event) => {
  event.preventDefault()
  const key = event.key?.toLowerCase()
  const isCtrlOrMeta = event.ctrlKey || event.metaKey
  if (isCtrlOrMeta) {
    if (key === 'r') {
      emit('refresh')
    } else if (key === 'a') {
      toggleSelectAll()
    } else if (key === 'x') {
      handleCut()
    } else if (key === 'c') {
      handleCopy()
    } else if (key === 'v') {
      handlePaste()
    } else if (key === 'h') {
      showHidden.value = !showHidden.value
    } else if (key === 'm') {
      updateMenuOptions(null, event)
    }
  } else {
    if (key === 'delete') {
      confirmDelete()
    }
  }
}

defineExpose({
  selectedItems,
  basePath,
  handleShortcutKey,
  handleCreateFile,
})
</script>

<template>
  <div ref="dropZoneRef" :class="{isOverDropZone}" class="explorer-list-wrap" @contextmenu.prevent>
    <transition name="fade">
      <div v-if="isLoading" class="os-loading-container _absolute">Loading...</div>
    </transition>
    <div v-if="!contentOnly" class="explorer-actions vgo-panel">
      <div class="action-group">
        <button class="btn-action btn-no-style" @click="handleCreateFile()" title="Create Document">
          <span class="mdi mdi-file-document-plus-outline"></span>
        </button>
        <button class="btn-action btn-no-style" @click="handleCreateFolder()" title="Create Folder">
          <span class="mdi mdi-folder-plus-outline"></span>
        </button>

        <template v-if="!selectFileMode">
          <div class="split-line"></div>

          <button
            class="btn-action btn-no-style"
            @click="() => selectUploadFiles()"
            title="Upload Files..."
          >
            <span class="mdi mdi-file-upload-outline"></span>
          </button>
          <button
            class="btn-action btn-no-style"
            @click="() => selectUploadFolder()"
            title="Upload Folder..."
          >
            <span class="mdi mdi-folder-upload-outline"></span>
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            @click="handleDownload"
            title="Download"
          >
            <span class="mdi mdi-file-download-outline"></span>
          </button>

          <div class="split-line"></div>

          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            @click="handleCut"
            title="Cut (ctrl+x)"
          >
            <span class="mdi mdi-content-cut"></span>
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            @click="handleCopy"
            title="Copy (ctrl+c)"
          >
            <span class="mdi mdi-content-copy"></span>
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enablePaste"
            @click="handlePaste"
            title="Paste (ctrl+v)"
          >
            <span class="mdi mdi-content-paste"></span>
          </button>

          <button
            class="btn-action btn-no-style"
            :disabled="selectedItems.length !== 1"
            @click="handleRename"
            title="Rename"
          >
            <span class="mdi mdi-rename"></span>
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!enableAction"
            @click="confirmDelete"
            title="Delete (del)"
          >
            <span class="mdi mdi-delete-forever-outline"></span>
          </button>
        </template>
      </div>
      <div class="action-group">
        <button
          class="btn-action btn-no-style"
          @click="showHidden = !showHidden"
          title="Toggle hidden file visible (ctrl+h)"
        >
          <template v-if="showHidden">
            <span class="mdi mdi-eye-outline"></span>
          </template>
          <template v-else>
            <span class="mdi mdi-eye-off-outline"></span>
          </template>
        </button>

        <template v-if="!selectFileMode || (selectFileMode && multiple)">
          <button
            class="btn-action btn-no-style"
            @click="toggleSelectAll"
            title="Toggle Select All (ctrl+a)"
          >
            <span class="mdi mdi-check-all"></span>
          </button>
        </template>

        <button
          class="btn-action btn-no-style"
          @click="updateMenuOptions2($event)"
          title="Menu (ctrl+m)"
        >
          <span class="mdi mdi-dots-vertical"></span>
        </button>
      </div>
    </div>

    <div
      ref="explorerContentRef"
      class="explorer-content"
      @click="selectedItems = []"
      @contextmenu.prevent.stop="updateMenuOptions(null, $event)"
    >
      <div v-if="!(isGridView || gridView)" class="explorer-list-view">
        <div class="vgo-bg file-list-header file-list-row">
          <div class="list-col c-checkbox" @click.stop="toggleSelectAll">
            <input
              v-if="allowMultipleSelection"
              class="file-checkbox"
              type="checkbox"
              :checked="isAllSelected"
            />
          </div>
          <div
            v-for="item in sortableListHeader"
            :key="item.label"
            :class="[item.className, {active: item.active}]"
            class="list-col"
            @click.stop="item.onClick"
          >
            {{ item.label }}
            <span
              v-if="item.active"
              class="mdi"
              :class="[item.isDesc ? 'mdi-menu-down' : 'mdi-menu-up']"
            ></span>
          </div>
        </div>

        <div class="file-list-content">
          <FileListItem
            class="selectable"
            :item="item"
            v-for="item in filteredFiles"
            :key="item.name"
            :data-name="item.name"
            :active="selectedItemsSet.has(item)"
            :show-checkbox="allowMultipleSelection"
            @open="(i) => emit('open', i)"
            @select="toggleSelect"
            @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
          />
        </div>
      </div>
      <div v-else class="explorer-grid-view">
        <FileGridItem
          class="selectable"
          :item="item"
          v-for="item in filteredFiles"
          :key="item.name"
          :data-name="item.name"
          :active="selectedItemsSet.has(item)"
          :show-checkbox="allowMultipleSelection"
          @open="(i) => emit('open', i)"
          @select="toggleSelect"
          @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
        />
      </div>
    </div>
    <div v-if="!contentOnly" class="explorer-status-bar">
      <span>
        {{ filteredFiles.length }} Item(s)
        <template v-if="selectedItems.length">
          | {{ selectedItems.length }} item(s) selected | {{ bytesToSize(selectedItemsSize) }}
        </template>
      </span>

      <button
        @click="isGridView = !isGridView"
        class="btn-action btn-no-style"
        title="Toggle grid view"
      >
        <template v-if="isGridView">
          <span class="mdi mdi-view-grid-outline"></span>
        </template>
        <template v-else>
          <span class="mdi mdi-view-list-outline"></span>
        </template>
      </button>
    </div>

    <UploadQueue ref="uploadQueueRef" @allDone="emit('refresh')" auto-close />
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
      justify-content: center;
    }

    .action-group {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;

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
  }

  .explorer-list-view {
    width: fit-content;

    .file-list-header {
      font-weight: 500;
      text-transform: capitalize;
      border-left: 0;
      border-right: 0;
      position: sticky;
      top: 0;
      z-index: 1;

      .list-col {
        & + .list-col {
          border-left: 1px solid var(--vgo-color-border);
        }

        padding: 4px 5px !important;
        font-size: 14px;

        &:hover {
          background-color: var(--vgo-primary-opacity);
        }

        .mdi {
          transform: scale(1.5);
        }
      }
    }

    .file-list-content {
      margin-top: 2px;
    }

    :deep(.file-list-row) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;

      .list-col {
        padding: 0 5px;
        flex-shrink: 0;
        box-sizing: border-box;

        &.c-icon {
          padding-left: 10px;
          width: 50px;
        }

        &.c-filename {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 4px;
          width: 200px;
        }

        &.c-type {
          width: 100px;
        }

        &.c-ext {
          width: 50px;
        }

        &.c-size {
          width: 80px;
        }

        &.c-time {
          width: 140px;
        }

        &.c-actions {
          padding-right: 10px;
          display: flex;
          justify-content: flex-end;
          gap: 4px;
          width: 100px;
        }
      }
    }
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
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;

    .mdi {
      display: flex;
      transform: scale(1.2);
    }
  }
}
</style>
