<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { FileSelectResult } from './types'
import type { FsDirChange, IDrive, IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { provide } from 'vue'
import { fsWebApi } from '@/api/filesystem'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { clearLastOpenedMediaInDir, useLastOpenedMediaItem } from '@/hooks/use-last-opened-media'
import { shortcutScopeKey, useShortcut } from '@/hooks/use-shortcut'
import { localSettingsStore } from '@/store'
import { resolveMenuIcons } from '@/utils/icons'
import { OpenWithEnum } from '../Apps/apps'
import AddressBar from './ExplorerUI/AddressBar.vue'
import ConflictDialog from './ExplorerUI/ConflictDialog.vue'
import { acceptDirDrag, dragEnabledKey, dropIntoDir, isStarDrag, STAR_DRAG_MIME } from './ExplorerUI/entry-drag'
import { createDefaultFileFilter } from './ExplorerUI/file-filter'
import FileList from './ExplorerUI/FileList.vue'
import FilePropertiesWindow from './ExplorerUI/FilePropertiesWindow.vue'
import FilterBar from './ExplorerUI/FilterBar.vue'
import { useNavigation } from './ExplorerUI/hooks/use-navigation'
import TaskFailureDialog from './ExplorerUI/TaskFailureDialog.vue'
import FileSidebar from './FileSidebar.vue'
import { getLastDirName, normalizeListingPath } from './utils'
import { ExplorerEvents, useExplorerBusOn } from './utils/bus'

const props = withDefaults(
  defineProps<{
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    // 只展示内容
    contentOnly?: boolean
    // 文件后缀过滤正则，如 "\\.(mp4|webm|mkv)$"
    fileFilterPattern?: string
    // 快捷键作用域，供主文件管理器和文件选择器隔离
    shortcutScope?: string
  }>(),
  {
    multiple: false,
    contentOnly: false,
    shortcutScope: 'fileManager',
  },
)
const emit = defineEmits<{
  handleSelect: [val: FileSelectResult]
  cancelSelect: []
}>()
const { selectFileMode, multiple, shortcutScope } = toRefs(props)
// 选择器模式下禁用全部文件管理器快捷键
const shortcutsDisabled = computed(() => Boolean(selectFileMode.value))
// 选择器固定了 fileFilterPattern 时锁住过滤条，用户不能清除或改动
const filterLocked = computed(() => Boolean(selectFileMode.value && props.fileFilterPattern))
provide(shortcutScopeKey, shortcutScope.value)
// 选择器模式（FileSelector）只用来挑文件 / 文件夹，整个窗口禁用拖拽
const dragEnabled = computed(() => !selectFileMode.value)
provide(dragEnabledKey, dragEnabled)
const rootRef = ref()
const route = useRoute()
const router = useRouter()

const {
  isLoading,
  files,
  handleOpen,
  handleRefresh,
  applyEntryChange,
  basePathNormalized,
  starList,
  handleOpenPath,
  navigationHistory,
  goBack,
  goForward,
  allowUp,
  goUp,
  basePath,
  toggleStar,
  isStared,
  highlightFolderName,
} = useNavigation({
  getListFn: async ({ signal } = {}) => {
    const res = await fsWebApi.getList({
      path: basePath.value,
    }, {
      signal,
    })
    // console.log(res)

    return (res || [])
  },
})

const debounceHandleRefresh = useDebounceFn(() => {
  handleRefresh()
}, 100)

/** 文件操作完成后的条目级更新：直接改列表，不整目录重读。 */
function handleEntryChange(change: Pick<FsDirChange, 'added' | 'updated' | 'removed'>) {
  applyEntryChange(change)
}

const addressBarPath = computed({
  get: () => basePath.value,
  set: (v: string) => {
    basePath.value = v
  },
})

const fileSidebarRef = ref()
onMounted(async () => {
  if (fileSidebarRef.value) {
    await fileSidebarRef.value.loadDrives()
    const navPath = typeof route.query.navPath === 'string' ? route.query.navPath : ''
    if (navPath) {
      await handleOpenPath(navPath, true, true)
      router.replace({ query: { ...route.query, navPath: undefined } })
    }
    else if (basePath.value) {
      handleRefresh()
    }
    else {
      fileSidebarRef.value.openFirstDrive()
    }
  }
})
const fileListRef = ref()
const filterBarRef = ref<InstanceType<typeof FilterBar> | null>(null)
const filterState = ref(createDefaultFileFilter())
const filterDirectories = computed(() => !selectFileMode.value)
const lastOpenedMediaItem = useLastOpenedMediaItem(basePathNormalized, files)

function playLastOpenedMedia() {
  const item = lastOpenedMediaItem.value
  if (!item) {
    return
  }
  handleOpen({
    item,
    openWith: OpenWithEnum.MediaPlayer,
    list: fileListRef.value?.sortedFiles ?? files.value,
  })
}

function clearCurrentLastOpenedMedia() {
  clearLastOpenedMediaInDir(basePathNormalized.value)
}

function clearFilter() {
  // 选择器的过滤条件由 fileFilterPattern 决定，用户不能清除
  if (filterLocked.value) {
    return
  }
  filterState.value = {
    ...filterState.value,
    text: '',
  }
}

watch(basePathNormalized, () => {
  if (!props.fileFilterPattern) {
    clearFilter()
  }
})

watch(() => props.fileFilterPattern, (pattern) => {
  if (pattern) {
    filterState.value = {
      text: pattern,
      regex: true,
      caseSensitive: false,
    }
  }
}, {
  immediate: true,
})

watch(isLoading, async (loading) => {
  if (!loading && highlightFolderName.value) {
    await nextTick()
    const name = highlightFolderName.value
    highlightFolderName.value = null
    fileListRef.value?.selectByNames([name])
  }
})

async function runWithFileListAtPath(targetBasePath: string, action: (fileList: any) => void) {
  const normalizedTargetPath = normalizeListingPath(targetBasePath)
  if (normalizedTargetPath !== basePathNormalized.value) {
    await handleOpenPath(normalizedTargetPath)
    await nextTick()
  }
  if (!fileListRef.value) {
    return
  }
  action(fileListRef.value)
}

// Listen for SELECT_COLLECTED event from App windows
useExplorerBusOn(ExplorerEvents.SELECT_COLLECTED, async ({ basePath: targetBasePath, names }: { basePath: string, names: string[] }) => {
  await runWithFileListAtPath(targetBasePath, fileList => fileList.selectByNames(names))
})

useExplorerBusOn(ExplorerEvents.REVEAL_ITEM, async ({ basePath: targetBasePath, name }: { basePath: string, name: string }) => {
  await runWithFileListAtPath(targetBasePath, fileList => fileList.selectAndReveal(name))
})

const starredPathsList = computed(() => [...starList.value])
const currentPathForSidebar = computed(() => basePath.value)

function removeStarredPath(path: string) {
  starList.value = starList.value.filter(item => item !== path)
}

/* ------------------------------------------------------------------ *
 * 收藏夹：既是文件落点（拖文件 / 系统文件上去 → 移动、复制或上传到该目录），
 * 也是排序拖拽的源与落点（拖动收藏项本身 → 调整顺序）。
 * 两者靠 DataTransfer 的 MIME 区分，见 entry-drag.ts 的 isStarDrag。
 * ------------------------------------------------------------------ */
const starListRef = ref<HTMLElement | null>(null)
const starredDragOverPath = ref<string | null>(null)
/** 正在被拖动的收藏项路径 */
const starDragPath = ref<string | null>(null)
/** 插入位置：0..length，按指针在收藏项上半 / 下半计算 */
const starDropIndex = ref<number | null>(null)

/** 拖到自己紧邻的前后位置是无意义的，不显示插入线也不执行 */
const effectiveStarDropIndex = computed(() => {
  const at = starDropIndex.value
  if (at === null) {
    return null
  }
  const from = starDragPath.value ? starredPathsList.value.indexOf(starDragPath.value) : -1
  if (from === -1) {
    return at
  }
  return at === from || at === from + 1 ? null : at
})

function resetStarDrag() {
  starDragPath.value = null
  starDropIndex.value = null
}

function onStarDragStart(path: string, event: DragEvent) {
  if (!dragEnabled.value) {
    event.preventDefault()
    return
  }
  starDragPath.value = path
  event.dataTransfer?.setData(STAR_DRAG_MIME, path)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onStarDragOver(path: string, index: number, event: DragEvent) {
  if (!dragEnabled.value) {
    return
  }

  if (isStarDrag(event)) {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    starDropIndex.value = event.clientY > rect.top + rect.height / 2 ? index + 1 : index
    return
  }

  if (!acceptDirDrag(path, event)) {
    if (starredDragOverPath.value === path) {
      starredDragOverPath.value = null
    }
    return
  }
  starredDragOverPath.value = path
}

function onStarDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && starListRef.value?.contains(next)) {
    return
  }
  starredDragOverPath.value = null
  starDropIndex.value = null
}

function onStarDrop(path: string, event: DragEvent) {
  if (!dragEnabled.value) {
    return
  }

  if (isStarDrag(event)) {
    event.preventDefault()
    event.stopPropagation()
    const from = starDragPath.value
    const insertAt = effectiveStarDropIndex.value
    resetStarDrag()
    if (from && insertAt !== null) {
      reorderStar(from, insertAt)
    }
    return
  }

  starredDragOverPath.value = null
  dropIntoDir(path, event)
}

/** 把收藏项移到 insertAt（未删除前的下标语义），越界会被夹住 */
function reorderStar(path: string, insertAt: number) {
  const next = [...starList.value]
  const from = next.indexOf(path)
  if (from === -1) {
    return
  }
  next.splice(from, 1)
  const target = Math.max(0, Math.min(from < insertAt ? insertAt - 1 : insertAt, next.length))
  next.splice(target, 0, path)
  starList.value = next
}

useEventListener(window, 'dragend', () => {
  starredDragOverPath.value = null
  resetStarDrag()
})

function openPathInNewTab(path: string) {
  const routeLocation = router.resolve({
    name: 'HomeView',
    query: {
      ...route.query,
      navPath: path,
    },
  })
  window.open(routeLocation.href, '_blank')
}

function showStarredPathMenu(path: string, event: MouseEvent) {
  const items: MenuItem[] = [
    {
      label: 'Open',
      icon: 'mdi mdi-folder-open-outline',
      onClick: () => handleOpenPath(path),
    },
    {
      label: 'Open in new Tab',
      icon: 'mdi mdi-open-in-new',
      onClick: () => openPathInNewTab(path),
    },
    {
      label: 'UnStar',
      icon: 'mdi mdi-star-off-outline',
      onClick: () => removeStarredPath(path),
    },
  ]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(items),
  })
}

async function jumpToHistory(index: number) {
  const hist = navigationHistory.value
  const item = hist?.history[index]
  if (!hist || !item?.path) {
    return
  }
  hist.currentIndex = index
  await handleOpenPath(item.path, false)
}

function showHistoryMenu(direction: 'back' | 'forward', event: MouseEvent) {
  const hist = navigationHistory.value
  if (!hist) {
    return
  }

  const stack = direction === 'back'
    ? hist.history.slice(0, hist.currentIndex).map((item, index) => ({ item, index })).reverse()
    : hist.history.slice(hist.currentIndex + 1).map((item, offset) => ({ item, index: hist.currentIndex + 1 + offset }))

  if (!stack.length) {
    return
  }

  const items: MenuItem[] = stack.map(({ item, index }) => ({
    label: item.path,
    icon: direction === 'back' ? 'mdi mdi-arrow-left' : 'mdi mdi-arrow-right',
    onClick: () => jumpToHistory(index),
  }))

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(items),
  })
}

// 启动App
function handleFileListOpen({ item, openWith }: { item: IEntry, openWith?: OpenWithEnum }) {
  if (selectFileMode.value === 'file' && !item.isDirectory) {
    // 多选时双击其中一项应返回全部已选文件，而不是只返回被双击的那个
    const picked = multiple.value ? selectedFilesForPick() : []
    const items = picked.length > 1 ? picked : [item]
    emit('handleSelect', { items, item: items[0], basePath: fileListRef.value.basePath })
    return
  }
  return handleOpen({
    item,
    openWith,
    list: localSettingsStore.value.openAppWithFilteredList
      ? fileListRef.value.filteredFiles
      : fileListRef.value.sortedFiles,
  })
}

function selectedFilesForPick(): IEntry[] {
  return (fileListRef.value?.selectedItems ?? []).filter((i: IEntry) => !i.isDirectory)
}

/**
 * 选择器右键菜单的 Select：文件模式返回已选文件，文件夹模式返回选中的文件夹
 * （没有选中条目时就是当前目录，与底部 Select Folder 一致）。
 */
function handleSelectFromMenu() {
  if (!fileListRef.value) {
    return
  }
  const basePath = fileListRef.value.basePath
  if (selectFileMode.value === 'folder') {
    const folder = (fileListRef.value.selectedItems ?? []).find((i: IEntry) => i.isDirectory)
    if (folder) {
      emit('handleSelect', { items: [folder], item: folder, basePath })
    }
    else {
      emit('handleSelect', { basePath })
    }
    return
  }
  const files = selectedFilesForPick()
  if (!files.length) {
    return
  }
  emit('handleSelect', { items: files, item: files[0], basePath })
}

// 是否选中了一个文件夹
const isSelectAFolder = computed(() => {
  const items = fileListRef.value.selectedItems
  if (items.length !== 1) {
    return false
  }
  return items[0].isDirectory
})
// 处理选择操作
function handleSelect() {
  let items = fileListRef.value.selectedItems
  // 打开文件夹
  if (isSelectAFolder.value) {
    handleOpen({ item: items[0], list: fileListRef.value.files })
    return
  }
  if (selectFileMode.value === 'folder') {
    emit('handleSelect', { basePath: fileListRef.value.basePath })
  }
  if (!items.length) {
    return
  }
  if (selectFileMode.value === 'file') {
    items = items.filter((i: IEntry) => !i.isDirectory)
    if (!items.length) {
      return
    }
    emit('handleSelect', { items, item: items[0], basePath: fileListRef.value.basePath })
  }
}

const addressBarRef = ref<InstanceType<typeof AddressBar> | null>(null)

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+a',
  handler: () => addressBarRef.value?.focus(),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+f',
  handler: () => filterBarRef.value?.focus(),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+d',
  handler: toggleStar,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+arrowup',
  handler: goUp,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+arrowleft',
  handler: goBack,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'alt+arrowright',
  handler: goForward,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope.value,
  combo: 'backspace',
  handler: goUp,
})
</script>

<template>
  <div ref="rootRef" class="explorer-wrap" tabindex="0" :data-shortcut-scope="shortcutScope">
    <div v-if="!contentOnly" class="explorer-header vgo-panel vgo-panel--flat">
      <div class="explorer-toolbar">
        <div class="explorer-toolbar-stack">
          <div class="explorer-toolbar-path">
            <div class="explorer-toolbar-nav">
              <button
                :disabled="!navigationHistory?.canBack"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
                title="Back (alt+left)"
                @click="goBack"
                @contextmenu.prevent.stop="showHistoryMenu('back', $event)"
              >
                <i-mdi-arrow-left />
              </button>
              <button
                :disabled="!navigationHistory?.canForward"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
                title="Forward (alt+right)"
                @click="goForward"
                @contextmenu.prevent.stop="showHistoryMenu('forward', $event)"
              >
                <i-mdi-arrow-right />
              </button>
              <button
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
                :disabled="!allowUp"
                title="Up (alt+up)"
                @click="goUp"
              >
                <i-mdi-arrow-up />
              </button>
              <button
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
                title="Refresh (ctrl+r)"
                @click="debounceHandleRefresh"
              >
                <i-mdi-refresh />
              </button>
            </div>
            <AddressBar
              ref="addressBarRef"
              v-model="addressBarPath"
              @navigate="(path: string, highlightName: string | null) => { highlightFolderName = highlightName; handleOpenPath(path) }"
              @open-path-in-new-tab="openPathInNewTab"
              @refresh="debounceHandleRefresh"
            />
            <button
              class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
              title="Toggle Star (alt+s)"
              @click="toggleStar"
            >
              <MdiIcon :name="isStared ? 'star' : 'star-outline'" />
            </button>
          </div>
          <div class="explorer-toolbar-filters">
            <FilterBar
              ref="filterBarRef"
              v-model="filterState"
              :locked="filterLocked"
              @clear="clearFilter"
            />

            <slot name="headerRight" />
          </div>
        </div>
      </div>
    </div>
    <div class="explorer-content-wrap vgo-u-scrollbar">
      <el-splitter lazy>
        <el-splitter-panel size="130px" collapsible>
          <FileSidebar
            v-if="!contentOnly"
            ref="fileSidebarRef"
            :current-path="currentPathForSidebar"
            @open-drive="(i: IDrive) => handleOpenPath(i.path)"
            @open-path-in-new-tab="openPathInNewTab"
          >
            <div v-if="starredPathsList.length" ref="starListRef" class="star-list">
              <button
                v-for="(path, index) in starredPathsList"
                :key="path"
                class="vgo-u-button-reset vgo-list-item star-item"
                :class="{
                  'is-drop-target': starredDragOverPath === path,
                  'is-drag-source': starDragPath === path,
                  'is-drop-before': effectiveStarDropIndex === index,
                  'is-drop-after': effectiveStarDropIndex === index + 1 && index === starredPathsList.length - 1,
                }"
                :draggable="dragEnabled"
                :title="path"
                @click="handleOpenPath(path)"
                @contextmenu.prevent.stop="showStarredPathMenu(path, $event)"
                @dragstart="onStarDragStart(path, $event)"
                @dragover="onStarDragOver(path, index, $event)"
                @dragleave="onStarDragLeave($event)"
                @drop="onStarDrop(path, $event)"
              >
                <i-mdi-star class="vgo-u-icon-md" />
                <span class="vgo-u-text-overflow">{{ getLastDirName(path) }}</span>
              </button>
            </div>
          </FileSidebar>
        </el-splitter-panel>
        <el-splitter-panel>
          <div class="explorer-file-panel">
            <FileList
              ref="fileListRef"
              v-model:is-loading="isLoading"
              :files="files"
              :filter="filterState"
              :filter-directories="filterDirectories"
              :base-path="basePathNormalized"
              :select-file-mode="selectFileMode"
              :multiple="multiple"
              :content-only="contentOnly"
              @open="handleFileListOpen"
              @select="handleSelectFromMenu"
              @open-path-in-new-tab="openPathInNewTab"
              @clear-filter="clearFilter"
              @refresh="debounceHandleRefresh"
              @patch="handleEntryChange"
            />
            <Transition name="last-media-fab">
              <div v-if="lastOpenedMediaItem && !selectFileMode" class="last-media-fab-wrapper">
                <button
                  class="vgo-button vgo-button--primary vgo-button--round vgo-button--lg"
                  :title="`Play ${lastOpenedMediaItem.name}`"
                  @click="playLastOpenedMedia"
                >
                  <i-mdi-play />
                </button>
                <button
                  class="vgo-button vgo-button--round vgo-button--sm fab-close"
                  title="Clear remembered media"
                  @click.stop="clearCurrentLastOpenedMedia"
                >
                  <i-mdi-close />
                </button>
              </div>
            </Transition>
          </div>
        </el-splitter-panel>
      </el-splitter>
    </div>

    <ConflictDialog />
    <TaskFailureDialog />
    <FilePropertiesWindow />

    <!-- 文件选择器 -->
    <div v-if="selectFileMode && fileListRef" class="vgo-u-surface explorer-bottom-wrap">
      <button class="vgo-button vgo-button--primary" @click="handleSelect">
        {{ selectFileMode === 'file' || isSelectAFolder ? 'Open' : 'Select Folder' }}
      </button>
      <button class="vgo-button" @click="$emit('cancelSelect')">
        Cancel
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.explorer-wrap {
  min-width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  outline: none;

  .explorer-header {
    padding: var(--vgo-space-1) var(--vgo-space-1);
    border-bottom: 1px solid var(--vgo-border);

    .explorer-toolbar {
      display: flex;
      align-items: center;
      min-width: 0;
      width: 100%;

      &-nav {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: var(--vgo-space-1);
      }

      &-stack {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        flex: 1;
        width: 100%;
        min-width: 0;
        gap: var(--vgo-space-1);
        font-size: var(--vgo-font-md);

        @media screen and (max-width: $mq_mobile_width) {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: var(--vgo-space-1);
        }
      }

      &-path {
        display: flex;
        align-items: center;
        min-width: 0;
        overflow: hidden;
        gap: var(--vgo-space-1);

        @media screen and (max-width: $mq_mobile_width) {
          width: 100%;
        }
      }

      &-filters {
        display: flex;
        align-items: center;
        justify-self: end;
        min-width: 0;
        gap: var(--vgo-space-1);

        @media screen and (max-width: $mq_mobile_width) {
          width: 100%;
        }
      }
    }
  }

  .star-list {
    .star-item {
      position: relative;
      width: 100%;
      min-height: var(--vgo-control-sm);
      font-size: var(--vgo-font-sm);
      padding-inline: var(--vgo-space-2);

      &.is-drop-target {
        background-color: var(--vgo-primary-opacity);
        outline: 2px dashed var(--vgo-primary);
        outline-offset: -2px;
      }

      // 拖动排序：被拖走的那条淡出，落点用一条 2px 的插入线表示
      &.is-drag-source {
        opacity: 0.5;
      }

      &.is-drop-before::before,
      &.is-drop-after::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--vgo-primary);
      }

      &.is-drop-before::before {
        top: -1px;
      }

      &.is-drop-after::after {
        bottom: -1px;
      }
    }
  }

  .explorer-content-wrap {
    flex: 1;
    overflow: auto;
    display: flex;
  }

  .explorer-file-panel {
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .last-media-fab-wrapper {
    position: absolute;
    right: var(--vgo-space-4);
    bottom: 48px;
    z-index: var(--vgo-z-sticky);

    .fab-close {
      position: absolute;
      top: calc(var(--vgo-space-2) * -1);
      right: calc(var(--vgo-space-2) * -1);
    }
  }

  .last-media-fab-enter-active,
  .last-media-fab-leave-active {
    transition:
      opacity var(--vgo-duration-base) ease,
      transform var(--vgo-duration-base) ease;
  }

  .last-media-fab-enter-from,
  .last-media-fab-leave-to {
    opacity: 0;
    transform: scale(0.6);
  }

  .explorer-bottom-wrap {
    padding: var(--vgo-space-1);
    display: flex;
    justify-content: flex-end;
    gap: var(--vgo-space-1);
  }
}
</style>
