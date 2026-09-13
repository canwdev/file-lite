<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { FileSelectResult } from './types'
import type { FsDirChange, IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useDebounceFn } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { clearLastOpenedMediaInDir, useLastOpenedMediaItem } from '@/hooks/use-last-opened-media'
import { shortcutScopeKey, useShortcut } from '@/hooks/use-shortcut'
import { localSettingsStore } from '@/store'
import { resolveMenuIcons } from '@/utils/icons'
import { OpenWithEnum } from '../Apps/apps'
import AddressBar from './ExplorerUI/AddressBar.vue'
import { createDefaultFileFilter } from './ExplorerUI/file-filter'
import FileList from './ExplorerUI/FileList.vue'
import FilterBar from './ExplorerUI/FilterBar.vue'
import { useFavourites } from './ExplorerUI/hooks/use-favourites'
import { useNavigation } from './ExplorerUI/hooks/use-navigation'
import { normalizeListingPath } from './utils'
import { ExplorerEvents, useExplorerBusOn } from './utils/bus'

const props = withDefaults(
  defineProps<{
    // 当前目录，由外壳持有
    path: string
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    // 只展示内容
    contentOnly?: boolean
    // 文件后缀过滤正则，如 "\\.(mp4|webm|mkv)$"
    fileFilterPattern?: string
    // 快捷键作用域，供主文件管理器和文件选择器隔离
    shortcutScope: string
    // 预留：多标签下只有活动标签响应，暂时只接收不使用
    active?: boolean
  }>(),
  {
    multiple: false,
    contentOnly: false,
    active: true,
  },
)
const emit = defineEmits<{
  'update:path': [string]
  'handleSelect': [FileSelectResult]
  'cancelSelect': []
  'openPathInNewTab': [string]
}>()
const { selectFileMode, multiple, shortcutScope } = toRefs(props)
// 选择器模式下禁用全部文件管理器快捷键
const shortcutsDisabled = computed(() => Boolean(selectFileMode.value))
// 选择器固定了 fileFilterPattern 时锁住过滤条，用户不能清除或改动
const filterLocked = computed(() => Boolean(selectFileMode.value && props.fileFilterPattern))
provide(shortcutScopeKey, shortcutScope.value)
const { isStared, toggleStar } = useFavourites()

/**
 * 路径由外壳持有，这里只做受控绑定。
 *
 * 受控 prop 要等父组件重渲染才会回传，而 `useNavigation` 在赋值后马上就会读它，
 * 所以本地留一份 `currentPath`：面板内部导航写入时同步生效并上报外壳；外壳从
 * 侧边栏 / 收藏 / `?navPath=` 改了 `path` 时，再通过下面的 watch 触发刷新。
 */
const currentPath = ref(props.path)
const basePath = computed({
  get: () => currentPath.value,
  set: (value: string) => {
    if (value === currentPath.value) {
      return
    }
    currentPath.value = value
    emit('update:path', value)
  },
})

const {
  isLoading,
  files,
  handleOpen,
  handleRefresh,
  applyEntryChange,
  basePathNormalized,
  handleOpenPath,
  navigationHistory,
  goBack,
  goForward,
  allowUp,
  goUp,
  highlightFolderName,
} = useNavigation({
  basePath,
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

// 外壳换了路径：本地同步后刷新；面板内部导航已经同步过，跳过，避免重复请求
watch(() => props.path, (path) => {
  if (path === currentPath.value) {
    return
  }
  currentPath.value = path
  void handleRefresh()
})

/**
 * 保活的面板：挂载时（活动标签）拉一次；之后每次被激活，
 * 没数据就拉一次，有数据只恢复滚动位置（隐藏期间尺寸为 0，虚拟列表需要重新量）。
 */
onMounted(() => {
  if (props.active && props.path) {
    void handleRefresh()
  }
})

watch(() => props.active, (active) => {
  if (!active) {
    return
  }
  if (!files.value.length) {
    void handleRefresh()
    return
  }
  void nextTick(() => fileListRef.value?.restoreViewport?.())
})

const addressBarPath = computed({
  get: () => basePath.value,
  set: (v: string) => {
    basePath.value = v
  },
})

const fileListRef = ref()
const hasFileList = computed(() => Boolean(fileListRef.value))
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
  handler: () => toggleStar(basePathNormalized.value),
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

defineExpose({
  isSelectAFolder,
  handleSelect,
  handleSelectFromMenu,
  hasFileList,
  // 外壳挂载时用它触发首次加载：受控的 path 挂载后才会变化
  handleRefresh,
  handleOpenPath,
})
</script>

<template>
  <div class="explorer-main">
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
              @open-path-in-new-tab="$emit('openPathInNewTab', $event)"
              @refresh="debounceHandleRefresh"
            />
            <button
              class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
              title="Toggle Star (alt+s)"
              @click="toggleStar(basePathNormalized)"
            >
              <MdiIcon :name="isStared(basePathNormalized) ? 'star' : 'star-outline'" />
            </button>
          </div>
          <div class="explorer-toolbar-filters">
            <FilterBar
              ref="filterBarRef"
              v-model="filterState"
              :locked="filterLocked"
              @clear="clearFilter"
            />
          </div>
        </div>
      </div>
    </div>
    <div class="explorer-content-wrap vgo-u-scrollbar">
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
          @open-path-in-new-tab="$emit('openPathInNewTab', $event)"
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
    </div>
  </div>
</template>

<style lang="scss" scoped>
.explorer-main {
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

  .explorer-content-wrap {
    flex: 1;
    overflow: auto;
    display: flex;
  }

  .explorer-file-panel {
    position: relative;
    flex: 1;
    height: 100%;
    min-width: 0;
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
}
</style>
