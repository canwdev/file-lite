<script lang="ts" setup>
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { GroupField } from '../utils/group'
import type { ExplorerPaneView } from './explorer-tabs-store'
import type { FileFilterState } from './file-filter'
import type { IEntry } from '@/types/server'
import type { Column, FileTableVirtualRow } from '@/views/FileManager/ExplorerUI/FileTable.vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useDebounceFn, useEventListener, useVModel, watchDebounced } from '@vueuse/core'
import { computed, h, inject, nextTick, onBeforeUnmount, ref, toRefs, watch } from 'vue'
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
import { normalizeListingPath, normalizePath } from '../utils'
import { ExplorerEvents, useExplorerBusOn } from '../utils/bus'
import { GROUP_HEADER_HEIGHT, groupEntries } from '../utils/group'
import { composeSortMode, parseSortMode } from '../utils/sort'
import { acceptDirDrag, beginEntryDrag, dragSession, dropIntoDir, endEntryDrag, isExternalFileDrag, isInternalDrag, useDragEnabled } from './entry-drag'
import { explorerStateMap, pathStateRef } from './explorer-state'
import { createDefaultFileFilter, isFileFilterActive } from './file-filter'
import { getEntryTypeLabel } from './file-type'
import FileGridItem from './FileGridItem.vue'
import FileGroupHeader from './FileGroupHeader.vue'
import { useCopyPaste } from './hooks/use-copy-paste'
import { getOpenActionMeta, useFileActions } from './hooks/use-file-actions'
import { useLayoutGroup, useLayoutSort } from './hooks/use-layout-sort'
import { useSelection } from './hooks/use-selection'
import { useSystemClipboardPaste } from './hooks/use-system-clipboard-paste'
import { useTransfer } from './hooks/use-transfer'
import { useVirtualBlocks, useVirtualGrid, useVirtualList } from './hooks/use-virtual-files'

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
    /**
     * 本列表所在面板是不是当前聚焦的面板。
     * 拆分视图下两个面板都在加载，只有聚焦的那个可以在加载完成后把 DOM 焦点抢进列表，
     * 否则后台面板一加载完就会把活动面板抢走。
     */
    focused?: boolean
    /** 面板自己的视图偏好（list/grid、图标大小）；不传则用全局设置 */
    view?: ExplorerPaneView
    /**
     * 上一次列目录失败的原因；非空时列表区显示错误空状态而不是「This folder is empty」。
     *
     * 与 toast 是互补的：toast 说完就消失，而这里会一直留着，用户回头还能看到
     * 到底为什么这个目录打不开。
     */
    loadError?: string
    // 设置 selectables 防止跨层级选择
    selectables?: string[]
  }>(),
  {
    focused: true,
    selectables: () => ['.explorer-list-wrap .selectable'],
    filter: () => createDefaultFileFilter(),
    filterDirectories: false,
    loadError: '',
  },
)

const emit = defineEmits(['open', 'select', 'openPathInNewTab', 'openPath', 'update:isLoading', 'update:view', 'refresh', 'clearFilter'])

const { basePath, files, filter, filterDirectories, selectFileMode, multiple } = toRefs(props)
const shortcutScope = inject(shortcutScopeKey, 'fileManager')
// 选择器模式下禁用全部文件管理器快捷键（Esc 关闭选择器由 FileSelector 负责）
const shortcutsDisabled = computed(() => Boolean(selectFileMode.value))
const isLoading = useVModel(props, 'isLoading', emit) as unknown as Ref<boolean>
useExplorerBusOn(ExplorerEvents.REFRESH, () => emit('refresh'))

const sortMode = pathStateRef(basePath, 'sortMode', SortType.default)
const groupField = pathStateRef(basePath, 'groupField', 'none' as GroupField)
const groupDesc = pathStateRef(basePath, 'groupDesc', false)
const isGrouping = computed(() => groupField.value !== 'none')

function clearCollapsedGroups() {
  const path = basePath.value
  if (explorerStateMap.value[path])
    explorerStateMap.value[path].collapsedGroups = []
}

/**
 * 视图偏好（list/grid、图标大小）属于**面板**：拆分视图里两个面板各看各的，
 * 改一个不会带着另一个一起变。面板还没设置过时回落到全局设置。
 *
 * 状态由外壳持有（挂在标签 store 的面板上，跟着标签一起持久化），这里只按值收发：
 * 外壳没有接线（选择器窗口）时也不会丢，它会把这一份写回全局设置。
 */
const paneView = computed<ExplorerPaneView>(() => props.view ?? {
  grid: localSettingsStore.value.isGridView,
  iconSizeList: localSettingsStore.value.iconSizeList,
  iconSizeGrid: localSettingsStore.value.iconSizeGrid,
})

function updatePaneView(patch: Partial<ExplorerPaneView>) {
  emit('update:view', { ...paneView.value, ...patch })
}

const isGridView = computed({
  get: () => paneView.value.grid,
  set: (val: boolean) => updatePaneView({ grid: val }),
})
const isBranchView = computed({
  get: () => Boolean(paneView.value.branch) && !selectFileMode.value,
  set: (val: boolean) => {
    if (selectFileMode.value)
      return
    updatePaneView({ branch: val })
  },
})
const iconSizeList = computed({
  get: () => paneView.value.iconSizeList,
  set: (val: number) => updatePaneView({ iconSizeList: val }),
})
const iconSizeGrid = computed({
  get: () => paneView.value.iconSizeGrid,
  set: (val: number) => updatePaneView({ iconSizeGrid: val }),
})
const showHidden = computed({
  get: () => localSettingsStore.value.showHidden,
  set: (val: boolean) => { localSettingsStore.value.showHidden = val },
})
const isGridMode = computed(() => isGridView.value || props.gridView)

const { sortOptions, sortedFiles } = useLayoutSort(files, sortMode, showHidden)
const { groupOptions } = useLayoutGroup(groupField, groupDesc, clearCollapsedGroups)

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

const collapsedGroupSet = computed(() => new Set(explorerStateMap.value[basePath.value]?.collapsedGroups ?? []))
const groupedFiles = computed(() => {
  if (!isGrouping.value)
    return null
  return groupEntries(filteredFiles.value, groupField.value as Exclude<GroupField, 'none'>, groupDesc.value, {
    typeLabel: getEntryTypeLabel,
  })
})
const keyboardFiles = computed(() => {
  if (!groupedFiles.value)
    return filteredFiles.value
  return groupedFiles.value.flatMap(g => collapsedGroupSet.value.has(g.id) ? [] : g.items)
})

const isFilterActive = computed(() => isFileFilterActive(filter.value))
const isDirectoryEmpty = computed(() => !isLoading.value && sortedFiles.value.length === 0)
const isFilterEmpty = computed(() =>
  !isLoading.value && isFilterActive.value && filteredFiles.value.length === 0 && sortedFiles.value.length > 0,
)
const emptyState = computed(() => {
  // 加载失败优先于「空目录」：列失败时 files 会被清空，不特判就会显示
  // 「This folder is empty」——那是在骗用户，目录里到底有什么我们并不知道。
  //
  // 但只在**没有内容可展示**时才顶掉列表：同目录刷新失败会保留旧列表
  // （见 use-navigation 的 sameDir 分支），那份内容仍然有效，不该被错误卡片盖住。
  if (props.loadError && (!props.files.length || isBranchView.value)) {
    return {
      icon: 'alert-circle-outline',
      title: isBranchView.value ? 'Can\'t flatten this folder' : 'Can\'t open this folder',
      description: props.loadError,
      showClear: false,
      showRetry: true,
    }
  }

  if (isDirectoryEmpty.value) {
    return {
      icon: 'folder-open-outline',
      title: 'No files',
      description: isBranchView.value
        ? 'No files in this folder or its subfolders.'
        : 'This folder is empty.',
      showClear: false,
      showRetry: false,
    }
  }

  if (isFilterEmpty.value) {
    return {
      icon: 'filter-remove-outline',
      title: 'No matches',
      description: 'No files match the current filter.',
      showClear: true,
      showRetry: false,
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
      sortField: 'name' as const,
    },
    {
      key: 'ext',
      label: 'Ext',
      width: 70,
      formatter: (item: IEntry) => (item.ext || '').replace(/^\./, ''),
      sortField: 'extension' as const,
    },
    {
      key: 'size',
      label: 'Size',
      width: 80,
      formatter: (item: IEntry) =>
        item.size === null ? '-' : bytesToSize(item.size),
      sortField: 'size' as const,
      preferDesc: true,
    },
    {
      key: 'lastModified',
      label: 'Last Modified',
      width: 140,
      formatter: (item: IEntry) => formatDate(item.lastModified),
      sortField: 'lastModified' as const,
      preferDesc: true,
    },
    {
      key: 'birthtime',
      label: 'Created',
      width: 140,
      formatter: (item: IEntry) => formatDate(item.birthtime),
      sortField: 'birthTime' as const,
      preferDesc: true,
    },
  ].map((item) => {
    return {
      ...item,
      columnClick: () => {
        const current = parseSortMode(sortMode.value)
        if (current.field === item.sortField) {
          sortMode.value = composeSortMode(item.sortField, !current.desc)
          return
        }
        sortMode.value = composeSortMode(item.sortField, Boolean(item.preferDesc))
      },
      columnRightRender: () => {
        const current = parseSortMode(sortMode.value)
        if (current.field !== item.sortField)
          return
        return h(current.desc ? MdiMenuDown : MdiMenuUp, {
          style: 'line-height: 1; transform: scale(1.4)',
        })
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
/**
 * 网格和列表用同一套定位方式：**文档流 + 撑高的占位块**，而不是
 * `position: absolute` + `translateY`。
 *
 * 用 transform 抬整个容器时，跨行的瞬间容器内所有条目都上移一行、而
 * transform 又下移一行，两者相加才等于原地不动。这要求合成层在同一帧里
 * 拿到新 raster，主线程一忙（串流、大批缩略图解码）就可能先按旧 raster
 * 画新 transform —— 整屏内容跳动一行再弹回来。列表一直用占位块，没有这个
 * 问题；这里改成和列表一样，让每个条目在文档流里就处在正确位置。
 */
const virtualGridSpacerStyle = computed(() => ({
  height: `${virtualGrid.beforeHeight.value}px`,
}))
const virtualGridItemsStyle = computed(() => virtualGrid.gridStyle.value)

type ListGroupBlock
  = | { kind: 'header', id: string, label: string, collapsed: boolean }
    | { kind: 'file', item: IEntry, index: number }

type GridGroupBlock
  = | { kind: 'header', id: string, label: string, collapsed: boolean }
    | { kind: 'row', items: IEntry[] }

const listGroupBlocks = computed(() => {
  const groups = groupedFiles.value
  if (!groups)
    return []
  const rowH = listRowHeight.value
  const collapsed = collapsedGroupSet.value
  const blocks: { key: string, height: number, data: ListGroupBlock }[] = []
  for (const group of groups) {
    const isCollapsed = collapsed.has(group.id)
    blocks.push({
      key: `h:${group.id}`,
      height: GROUP_HEADER_HEIGHT,
      data: { kind: 'header', id: group.id, label: group.label, collapsed: isCollapsed },
    })
    if (isCollapsed)
      continue
    group.items.forEach((item, index) => {
      blocks.push({
        key: `f:${item.name}`,
        height: rowH,
        data: { kind: 'file', item, index },
      })
    })
  }
  return blocks
})

const gridGroupBlocks = computed(() => {
  const groups = groupedFiles.value
  if (!groups)
    return []
  const cols = virtualGrid.columns.value
  const rowH = virtualGrid.rowHeight.value
  const collapsed = collapsedGroupSet.value
  const blocks: { key: string, height: number, data: GridGroupBlock }[] = []
  for (const group of groups) {
    const isCollapsed = collapsed.has(group.id)
    blocks.push({
      key: `h:${group.id}`,
      height: GROUP_HEADER_HEIGHT,
      data: { kind: 'header', id: group.id, label: group.label, collapsed: isCollapsed },
    })
    if (isCollapsed)
      continue
    for (let i = 0; i < group.items.length; i += cols) {
      const items = group.items.slice(i, i + cols)
      blocks.push({
        key: `r:${group.id}:${i}`,
        height: rowH,
        data: { kind: 'row', items },
      })
    }
  }
  return blocks
})

const groupedListVirtual = useVirtualBlocks({
  blocks: listGroupBlocks,
  containerRef: explorerContentRef,
  overscan: 12,
})
const groupedGridVirtual = useVirtualBlocks({
  blocks: gridGroupBlocks,
  containerRef: explorerContentRef,
  overscan: 4,
})

const tableVirtualRows = computed((): FileTableVirtualRow[] => {
  if (!isGrouping.value)
    return virtualList.visibleItems.value as FileTableVirtualRow[]
  return groupedListVirtual.visibleBlocks.value.map((block) => {
    if (block.data.kind === 'header') {
      return {
        kind: 'header',
        id: block.data.id,
        label: block.data.label,
        collapsed: block.data.collapsed,
        height: block.height,
      }
    }
    return {
      kind: 'file',
      item: block.data.item,
      index: block.data.index,
      height: block.height,
    }
  })
})
const tableBeforeHeight = computed(() =>
  isGrouping.value ? groupedListVirtual.beforeHeight.value : virtualList.beforeHeight.value,
)
const tableAfterHeight = computed(() =>
  isGrouping.value ? groupedListVirtual.afterHeight.value : virtualList.afterHeight.value,
)
const groupedGridStyle = computed(() => ({
  height: `${groupedGridVirtual.totalHeight.value}px`,
}))
const groupedGridSpacerStyle = computed(() => ({
  height: `${groupedGridVirtual.beforeHeight.value}px`,
}))

const groupStickyTop = ref(0)
const stickySlotWidth = ref(0)
let stickyMetricsObserver: ResizeObserver | undefined

function updateGroupStickyMetrics() {
  const el = explorerContentRef.value
  stickySlotWidth.value = el?.clientWidth ?? 0
  if (!el || !isGrouping.value || isGridMode.value || emptyState.value) {
    groupStickyTop.value = 0
    return
  }
  const thead = el.querySelector('.explorer-list-view thead')
  groupStickyTop.value = thead instanceof HTMLElement ? thead.offsetHeight : 0
}

function bindStickyMetricsObserver() {
  stickyMetricsObserver?.disconnect()
  const el = explorerContentRef.value
  if (!el) {
    stickyMetricsObserver = undefined
    return
  }
  stickyMetricsObserver = new ResizeObserver(() => updateGroupStickyMetrics())
  stickyMetricsObserver.observe(el)
}

watch(
  [isGrouping, isGridMode, emptyState],
  () => {
    nextTick(() => {
      bindStickyMetricsObserver()
      updateGroupStickyMetrics()
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => stickyMetricsObserver?.disconnect())

const stickyGroupSlotStyle = computed(() => ({
  top: `${groupStickyTop.value}px`,
  width: stickySlotWidth.value ? `${stickySlotWidth.value}px` : '100%',
}))

const stickyGroup = computed(() => {
  if (!isGrouping.value)
    return null
  const virtual = isGridMode.value ? groupedGridVirtual : groupedListVirtual
  const y = virtual.scrollTop.value
  let current: { id: string, label: string, collapsed: boolean } | null = null
  for (const block of virtual.positioned.value) {
    if (block.data.kind !== 'header')
      continue
    if (block.top <= y)
      current = block.data
    else
      break
  }
  return current
})

function toggleGroup(id: string) {
  const path = basePath.value
  const current = explorerStateMap.value[path] ?? {}
  const next = new Set(current.collapsedGroups ?? [])
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  explorerStateMap.value[path] = { ...current, collapsedGroups: [...next] }
}

function setAllGroupsCollapsed(collapsed: boolean) {
  const path = basePath.value
  const current = explorerStateMap.value[path] ?? {}
  explorerStateMap.value[path] = {
    ...current,
    collapsedGroups: collapsed ? (groupedFiles.value ?? []).map(group => group.id) : [],
  }
}

function selectGroup(id: string) {
  const group = groupedFiles.value?.find(item => item.id === id)
  if (!group?.items.length)
    return
  if (!allowMultipleSelection.value) {
    selectByNames([group.items[0].name])
    return
  }
  const allSelected = group.items.every(item => selectedItemsSet.value.has(item))
  selectByNames(allSelected ? [] : group.items.map(item => item.name))
}

function expandGroupForName(name: string) {
  const groups = groupedFiles.value
  if (!groups)
    return
  const group = groups.find(g => g.items.some(item => item.name === name))
  if (group && collapsedGroupSet.value.has(group.id))
    toggleGroup(group.id)
}

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

  if (contentEl && tableEl) {
    const contentRect = contentEl.getBoundingClientRect()
    const tableRect = tableEl.getBoundingClientRect()
    const tableLeft = tableRect.left - contentRect.left + contentEl.scrollLeft
    const tableRight = tableLeft + tableRect.width

    if (rect.left > tableRight || rect.right < tableLeft) {
      return []
    }
  }

  if (isGrouping.value) {
    const top = rect.top - headerHeight
    const bottom = rect.bottom - headerHeight
    const items: IEntry[] = []
    for (const block of groupedListVirtual.positioned.value) {
      if (block.data.kind !== 'file')
        continue
      if (block.top + block.height < top || block.top > bottom)
        continue
      items.push(block.data.item)
    }
    return items
  }

  const listBottom = headerHeight + filteredFiles.value.length * virtualList.itemHeight.value

  if (rect.top > listBottom || rect.bottom < headerHeight) {
    return []
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

  if (isGrouping.value) {
    const items: IEntry[] = []
    for (const block of groupedGridVirtual.positioned.value) {
      if (block.data.kind !== 'row')
        continue
      if (block.top + block.height < rect.top || block.top > rect.bottom)
        continue
      block.data.items.forEach((item, column) => {
        const itemRect = {
          left: padding + column * cellWidth,
          top: block.top,
          right: padding + column * cellWidth + itemWidth,
          bottom: block.top + itemHeight,
        }
        if (rectsIntersect(rect, itemRect))
          items.push(item)
      })
    }
    return items
  }

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
})

const { handlePasteFromClipboard } = useSystemClipboardPaste({
  basePath,
  entries: files,
  isLoading,
})

/* ------------------------------------------------------------------ *
 * 拖拽
 * 源：列表里的行 / 网格项（拖整个选择）。
 * 落点：当前目录里的文件夹行；系统拖入的文件也落在这里（上传到该文件夹）。
 * 面包屑 / 收藏夹 / 磁盘根不在这个组件里，见 entry-drag.ts。
 * ------------------------------------------------------------------ */
const dragEnabled = useDragEnabled()
const dropTargetName = ref<string | null>(null)

function findEntry(name: string | undefined) {
  if (!name) {
    return null
  }
  return filteredFiles.value.find(item => item.name === name) ?? null
}

/** 指针下的文件夹行（只有目录才是合法落点） */
function hoveredDropRow(event: DragEvent) {
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('.selectable[data-name]')
  const name = el?.dataset.name
  if (!name) {
    return null
  }
  const item = findEntry(name)
  if (!item?.isDirectory) {
    return null
  }
  return { name, dir: normalizePath(`${basePath.value}/${name}`) }
}

function onRowDragStart(event: DragEvent) {
  if (!dragEnabled.value) {
    event.preventDefault()
    return
  }
  const target = event.target as HTMLElement | null
  if (!target || target.closest('.checkbox-col, .checkbox')) {
    event.preventDefault()
    return
  }
  const item = findEntry(target.closest<HTMLElement>('.selectable[data-name]')?.dataset.name)
  if (!item) {
    return
  }

  // 资源管理器语义：拖动未选中的项 = 先把它变成唯一选择，再拖这个选择
  if (!selectedItemsSet.value.has(item)) {
    selectByNames([item.name])
  }
  beginEntryDrag(event, {
    sourceBasePath: normalizeListingPath(basePath.value),
    paths: [...selectedPaths.value],
    items: selectedItems.value.map(selected => ({
      name: selected.name,
      isDirectory: selected.isDirectory,
    })),
  })
}

const DRAG_SCROLL_EDGE = 48
const DRAG_SCROLL_MAX_STEP = 24
let dragScrollFrame = 0
let dragPointerY = 0
let dragPointerInside = false

function stopDragAutoScroll() {
  dragPointerInside = false
  if (dragScrollFrame) {
    cancelAnimationFrame(dragScrollFrame)
    dragScrollFrame = 0
  }
}

function scheduleDragAutoScroll() {
  if (!dragScrollFrame) {
    dragScrollFrame = requestAnimationFrame(runDragAutoScroll)
  }
}

/**
 * 拖到列表上下边缘时自动滚动。
 * 不滚动的话，滚出视口的文件夹行就永远够不着，只能中断拖拽先滚屏。
 */
function runDragAutoScroll() {
  dragScrollFrame = 0
  const el = explorerContentRef.value
  if (!el || !dragPointerInside || !dragSession.value) {
    return
  }

  const rect = el.getBoundingClientRect()
  let delta = 0
  if (dragPointerY < rect.top + DRAG_SCROLL_EDGE) {
    delta = -Math.ceil((rect.top + DRAG_SCROLL_EDGE - dragPointerY) / 3)
  }
  else if (dragPointerY > rect.bottom - DRAG_SCROLL_EDGE) {
    delta = Math.ceil((dragPointerY - (rect.bottom - DRAG_SCROLL_EDGE)) / 3)
  }
  delta = Math.max(-DRAG_SCROLL_MAX_STEP, Math.min(DRAG_SCROLL_MAX_STEP, delta))
  if (!delta) {
    return
  }

  const before = el.scrollTop
  el.scrollTop = before + delta
  if (el.scrollTop === before) {
    // 已经到顶 / 到底，别空转 rAF
    return
  }
  scheduleDragAutoScroll()
}

function updateDragAutoScroll(event: DragEvent) {
  dragPointerY = event.clientY
  dragPointerInside = true
  scheduleDragAutoScroll()
}

function onContentDragOver(event: DragEvent) {
  if (!dragEnabled.value) {
    return
  }
  const internal = isInternalDrag(event)
  if (!internal && !isExternalFileDrag(event)) {
    return
  }

  const row = hoveredDropRow(event)
  if (row && acceptDirDrag(row.dir, event, { delegateExternal: true })) {
    dropTargetName.value = row.name
    if (internal) {
      updateDragAutoScroll(event)
    }
    return
  }

  dropTargetName.value = null
  // 落在列表空白处 = 落到当前目录。拖到别的标签页的内容区就走这里：
  // 目录不同就是普通的移动 / 复制；目录相同只有 Ctrl（复制）才有意义——那是 duplicate。
  // 没有行可以高亮，落点反馈交给拖拽光标。
  if (internal) {
    acceptDirDrag(basePath.value, event, { delegateExternal: true })
    updateDragAutoScroll(event)
  }
}

function onContentDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && explorerContentRef.value?.contains(next)) {
    return
  }
  dropTargetName.value = null
  stopDragAutoScroll()
}

function onContentDrop(event: DragEvent) {
  dropTargetName.value = null
  stopDragAutoScroll()

  if (!dragEnabled.value || !isInternalDrag(event)) {
    // 系统文件交给外层上传区：它按事件目标解析真正的落点目录
    endEntryDrag()
    return
  }

  const row = hoveredDropRow(event)
  if (row) {
    dropIntoDir(row.dir, event, { delegateExternal: true })
    return
  }
  // 落在空白处 = 落到当前目录（同目录只有带 Ctrl 时才会被 entry-drag 接受）
  if (dropIntoDir(basePath.value, event, { delegateExternal: true })) {
    return
  }
  endEntryDrag()
}

function resolveExternalDropDir(event: DragEvent) {
  return hoveredDropRow(event)?.dir ?? basePath.value
}

function onRowDragEnd() {
  endEntryDrag()
  dropTargetName.value = null
  stopDragAutoScroll()
  resetDropZone()
}

useEventListener(window, 'dragend', onRowDragEnd)
useEventListener(window, 'drop', () => {
  dropTargetName.value = null
  stopDragAutoScroll()
})
onBeforeUnmount(stopDragAutoScroll)

// 上传下载功能
const {
  dropZoneRef,
  isOverDropZone,
  onDropZoneDragEnter,
  onDropZoneDragOver,
  onDropZoneDragLeave,
  onDropZoneDrop,
  resetDropZone,
  selectUploadFiles,
  selectUploadFolder,
  handleDownload,
  confirmDownload,
  downloadToFolder,
} = useTransfer({
  basePath,
  isLoading,
  selectedItems,
  dragEnabled,
  resolveDropDir: resolveExternalDropDir,
})

watch(isLoading, (val) => {
  // 聚焦的面板才抢焦点：拆分视图里另一个面板加载完不该把活动面板抢过去
  if (!val && props.focused) {
    focusFileList()
  }
})

async function focusFileList() {
  await nextTick()
  dropZoneRef.value?.focus()
}

// 新建 / 重命名后待选中的名字。列表更新来自服务端推送，可能早于或晚于操作返回。
const pendingRevealName = ref<string | null>(null)

function revealWhenListed(name: string) {
  pendingRevealName.value = name
  if (!files.value.some(item => item.name === name))
    return
  pendingRevealName.value = null
  nextTick(() => selectAndReveal(name))
}

// 文件操作功能
const {
  handleOpen,
  handleCreateFile,
  handleCreateFolder,
  handleRename: renameSelected,
  confirmDelete,
  ctxMenuOptions,
  handleShowCtxMenu,
  loadOpenWithPlugins,
  enableAction,
} = useFileActions({
  isLoading,
  selectedPaths,
  basePath,
  selectedItems,
  enablePaste,
  handlePaste,
  handlePasteFromClipboard,
  handleCut,
  handleCopy,
  selectedItemsSet,
  handleDownload,
  downloadToFolder,
  emit,
  isBranchView,
  onOpenContainingFolder: (path) => {
    emit('openPath', path)
  },
  onEntryCreated: revealWhenListed,
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

function viewMenuItems(): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: 'List',
      icon: isGridView.value ? '' : 'mdi mdi-check',
      onClick: () => {
        isGridView.value = false
      },
    },
    {
      label: 'Grid',
      icon: isGridView.value ? 'mdi mdi-check' : '',
      divided: true,
      onClick: () => {
        isGridView.value = true
      },
    },
    {
      label: 'Branch view',
      icon: isBranchView.value ? 'mdi mdi-check' : '',
      shortcut: 'Ctrl+B',
      divided: isGrouping.value,
      onClick: () => {
        isBranchView.value = !isBranchView.value
      },
    },
  ]
  if (isGrouping.value) {
    items.push(
      {
        label: 'Expand all groups',
        icon: 'mdi mdi-unfold-more-horizontal',
        onClick: () => setAllGroupsCollapsed(false),
      },
      {
        label: 'Collapse all groups',
        icon: 'mdi mdi-unfold-less-horizontal',
        onClick: () => setAllGroupsCollapsed(true),
      },
    )
  }
  return items
}

function getMenuOptions() {
  // 选择器只负责挑条目：菜单里只有 Select，不提供打开 / 传输 / 删除等操作
  if (selectFileMode.value) {
    const selected = selectedItems.value
    if (!selected.length) {
      return []
    }
    const files = selected.filter(item => !item.isDirectory)
    if (selectFileMode.value === 'file' && !files.length) {
      return []
    }
    const label = selectFileMode.value === 'file' && multiple.value && files.length > 1
      ? `Select ${files.length} items`
      : 'Select'
    return [
      {
        label,
        onClick: () => emit('select'),
      },
    ]
  }

  if (selectedItems.value.length)
    return ctxMenuOptions.value

  return [
    {
      label: 'View',
      icon: 'mdi mdi-eye-outline',
      children: viewMenuItems(),
    },
    {
      label: 'Sort',
      icon: 'mdi mdi-sort-alphabetical-variant',
      children: sortOptions.value,
    },
    {
      label: 'Group by',
      icon: 'mdi mdi-format-list-group',
      children: groupOptions.value,
      divided: true,
    },
    {
      label: 'New',
      icon: 'mdi mdi-plus',
      children: [
        {
          label: 'File',
          icon: 'mdi mdi-file-document-plus-outline',
          onClick() {
            handleCreateFile()
          },
        },
        {
          label: 'Folder',
          icon: 'mdi mdi-folder-plus-outline',
          shortcut: 'F7',
          onClick() {
            handleCreateFolder()
          },
        },
      ],
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
    ...ctxMenuOptions.value,
  ]
}

function updateMenuOptions(item: IEntry | null, event: MouseEvent | KeyboardEvent) {
  handleShowCtxMenu(item, event, getMenuOptions)
}
async function updateMenuOptions2(event: MouseEvent) {
  await loadOpenWithPlugins()
  const items = resolveMenuIcons(getMenuOptions())
  if (!items.length) {
    return
  }
  const button = (event.target as HTMLElement)?.closest('button') as HTMLElement
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    ...menuThemeOptions,
    items,
  })
}

function selectKeyboardItem(index: number) {
  const items = keyboardFiles.value
  if (!items.length) {
    return
  }

  const nextIndex = Math.min(Math.max(index, 0), items.length - 1)
  const nextItem = items[nextIndex]
  if (!nextItem) {
    return
  }

  selectByNames([nextItem.name])
  nextTick(() => scrollToFile(nextItem.name))
}

function selectKeyboardItemByName(name: string) {
  const index = keyboardFiles.value.findIndex(item => item.name === name)
  if (index >= 0)
    selectKeyboardItem(index)
}

function moveKeyboardSelection(offset: number) {
  const items = keyboardFiles.value
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

/** 网格二维导航：左右 ±1，上下按列跨行；分组时在组间按同列衔接 */
function moveKeyboardSelectionGrid(dx: number, dy: number) {
  const cols = Math.max(virtualGrid.columns.value, 1)
  const groups = groupedFiles.value
  const visibleGroups = groups
    ? groups.filter(g => !collapsedGroupSet.value.has(g.id) && g.items.length > 0)
    : null

  const segments: IEntry[][] = visibleGroups
    ? visibleGroups.map(g => g.items)
    : keyboardFiles.value.length
      ? [keyboardFiles.value]
      : []

  if (!segments.length)
    return

  const currentName = selectedItems.value[0]?.name
  if (!currentName) {
    const first = segments[0][0]
    const lastSeg = segments[segments.length - 1]
    const last = lastSeg[lastSeg.length - 1]
    selectKeyboardItemByName((dx > 0 || dy > 0) ? first.name : last.name)
    return
  }

  let segIdx = -1
  let localIdx = -1
  for (let i = 0; i < segments.length; i++) {
    const found = segments[i].findIndex(item => item.name === currentName)
    if (found !== -1) {
      segIdx = i
      localIdx = found
      break
    }
  }
  if (segIdx === -1) {
    selectKeyboardItemByName(segments[0][0].name)
    return
  }

  const items = segments[segIdx]

  if (dx !== 0) {
    const next = localIdx + dx
    if (next >= 0 && next < items.length) {
      selectKeyboardItemByName(items[next].name)
      return
    }
    if (dx < 0 && segIdx > 0) {
      const prev = segments[segIdx - 1]
      selectKeyboardItemByName(prev[prev.length - 1].name)
      return
    }
    if (dx > 0 && segIdx < segments.length - 1) {
      selectKeyboardItemByName(segments[segIdx + 1][0].name)
    }
    return
  }

  const col = localIdx % cols
  const nextLocal = localIdx + dy * cols
  if (nextLocal >= 0 && nextLocal < items.length) {
    selectKeyboardItemByName(items[nextLocal].name)
    return
  }

  if (dy < 0) {
    if (segIdx <= 0) {
      selectKeyboardItemByName(items[col].name)
      return
    }
    const prev = segments[segIdx - 1]
    let target = Math.min(col, prev.length - 1)
    for (let i = col; i < prev.length; i += cols)
      target = i
    selectKeyboardItemByName(prev[target].name)
    return
  }

  if (dy > 0) {
    if (segIdx >= segments.length - 1) {
      let target = col
      for (let i = col; i < items.length; i += cols)
        target = i
      selectKeyboardItemByName(items[target].name)
      return
    }
    const nextSeg = segments[segIdx + 1]
    selectKeyboardItemByName(nextSeg[Math.min(col, nextSeg.length - 1)].name)
  }
}

const gridArrowDisabled = computed(() => shortcutsDisabled.value || !isGridMode.value)

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+r', 'meta+r'],
  description: 'Refresh',
  handler: () => emit('refresh'),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+a', 'meta+a'],
  description: 'Select all / clear selection',
  handler: toggleSelectAll,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+b', 'meta+b'],
  description: 'Toggle branch view',
  handler: () => {
    isBranchView.value = !isBranchView.value
  },
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+x', 'meta+x'],
  description: 'Cut',
  handler: handleCut,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+c', 'meta+c'],
  description: 'Copy',
  handler: handleCopy,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+v', 'meta+v'],
  description: 'Paste',
  handler: handlePaste,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+h', 'meta+h'],
  description: 'Toggle hidden files',
  handler: () => {
    showHidden.value = !showHidden.value
  },
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: ['ctrl+m', 'meta+m'],
  description: 'Open context menu',
  handler: event => updateMenuOptions(null, event),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'delete',
  description: 'Delete',
  handler: confirmDelete,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'f2',
  description: 'Rename',
  handler: handleRename,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'f3',
  description: 'Open',
  handler: handleOpen,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'enter',
  description: 'Open',
  handler: handleOpen,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'f7',
  description: 'New folder',
  handler: handleCreateFolder,
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'arrowup',
  description: 'Select previous item',
  handler: () => {
    if (isGridMode.value)
      moveKeyboardSelectionGrid(0, -1)
    else
      moveKeyboardSelection(-1)
  },
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'arrowdown',
  description: 'Select next item',
  handler: () => {
    if (isGridMode.value)
      moveKeyboardSelectionGrid(0, 1)
    else
      moveKeyboardSelection(1)
  },
})

useShortcut({
  disabled: gridArrowDisabled,
  scope: shortcutScope,
  combo: 'arrowleft',
  description: 'Select left (grid)',
  handler: () => moveKeyboardSelectionGrid(-1, 0),
})

useShortcut({
  disabled: gridArrowDisabled,
  scope: shortcutScope,
  combo: 'arrowright',
  description: 'Select right (grid)',
  handler: () => moveKeyboardSelectionGrid(1, 0),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'home',
  description: 'Select first item',
  handler: () => selectKeyboardItem(0),
})

useShortcut({
  disabled: shortcutsDisabled,
  scope: shortcutScope,
  combo: 'end',
  description: 'Select last item',
  handler: () => selectKeyboardItem(keyboardFiles.value.length - 1),
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

function scrollToFile(name: string) {
  const el = explorerContentRef.value
  if (!el) {
    return
  }

  expandGroupForName(name)

  nextTick(() => {
    let targetTop = 0
    let itemHeight = virtualList.itemHeight.value

    if (isGrouping.value && isGridMode.value) {
      const block = groupedGridVirtual.positioned.value.find(b =>
        b.data.kind === 'row' && b.data.items.some(item => item.name === name),
      )
      if (!block)
        return
      targetTop = block.top
      itemHeight = block.height
    }
    else if (isGrouping.value) {
      const block = groupedListVirtual.positioned.value.find(b =>
        b.data.kind === 'file' && b.data.item.name === name,
      )
      if (!block)
        return
      const headerHeight = el.querySelector('thead')?.getBoundingClientRect().height || listRowHeight.value
      targetTop = headerHeight + block.top
      itemHeight = block.height
    }
    else if (isGridMode.value) {
      const index = filteredFiles.value.findIndex(item => item.name === name)
      if (index < 0)
        return
      targetTop = 10 + Math.floor(index / virtualGrid.columns.value) * virtualGrid.rowHeight.value
      itemHeight = virtualGrid.rowHeight.value
    }
    else {
      const index = filteredFiles.value.findIndex(item => item.name === name)
      if (index < 0)
        return
      targetTop = index * virtualList.itemHeight.value
    }

    el.scrollTop = Math.max(targetTop - (el.clientHeight - itemHeight) / 2, 0)
    virtualList.refresh()
    virtualGrid.refresh()
    groupedListVirtual.refresh()
    groupedGridVirtual.refresh()
  })
}

function selectAndReveal(name: string) {
  const index = filteredFiles.value.findIndex(item => item.name === name)
  if (index === -1) {
    return
  }

  selectByNames([name])
  nextTick(() => scrollToFile(name))
}

/**
 * 恢复本目录上次的滚动位置。
 *
 * 保活的标签被重新显示时调用：`display:none` 期间容器尺寸为 0，虚拟列表的可视区是空的，
 * 需要重新量一次并滚回去（位置按 path 存在 explorerStateMap 里）。
 */
function restoreViewport() {
  const position = explorerStateMap.value[basePath.value]?.position || 0
  nextTick(() => {
    virtualList.refresh()
    virtualGrid.refresh()
    groupedListVirtual.refresh()
    groupedGridVirtual.refresh()
    getSetScrollPosition('set', position)
    virtualList.refresh()
    virtualGrid.refresh()
    groupedListVirtual.refresh()
    groupedGridVirtual.refresh()
  })
}

watchDebounced(files, () => {
  if (explorerStateMap.value[basePath.value]) {
    restoreViewport()
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

function snapIconSize(value: number, min: number, max: number, step: number) {
  const snapped = Math.round(value / step) * step
  return Math.min(max, Math.max(min, snapped))
}

function onContentWheel(event: WheelEvent) {
  if (!(event.ctrlKey || event.metaKey))
    return
  // 拦住浏览器页级缩放；passive: false 才能 preventDefault
  event.preventDefault()
  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (!delta)
    return
  const direction = delta > 0 ? -1 : 1
  if (isGridMode.value) {
    iconSizeGrid.value = snapIconSize(iconSizeGrid.value + direction * 8, 48, 512, 8)
  }
  else {
    iconSizeList.value = snapIconSize(iconSizeList.value + direction * 2, 16, 128, 2)
  }
}
useEventListener(() => explorerContentRef.value, 'wheel', onContentWheel, { passive: false })

defineExpose({
  selectedItems,
  selectByNames,
  selectAndReveal,
  basePath,
  handleCreateFile,
  sortedFiles,
  filteredFiles,
  files,
  restoreViewport,
})
</script>

<template>
  <div
    ref="dropZoneRef"
    :class="{ isOverDropZone: isOverDropZone && !dropTargetName }"
    class="explorer-list-wrap"
    tabindex="-1"
    @contextmenu.prevent
    @dragenter="onDropZoneDragEnter"
    @dragover="onDropZoneDragOver"
    @dragleave="onDropZoneDragLeave"
    @drop="onDropZoneDrop"
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

    <div class="explorer-body">
      <div
        v-if="stickyGroup && (isGridMode || groupStickyTop > 0)"
        class="explorer-sticky-group-slot"
        :style="stickyGroupSlotStyle"
      >
        <div class="explorer-sticky-group-slot__bar">
          <FileGroupHeader
            :label="stickyGroup.label"
            :collapsed="stickyGroup.collapsed"
            @toggle="toggleGroup(stickyGroup.id)"
            @select="selectGroup(stickyGroup.id)"
            @contextmenu.prevent.stop="updateMenuOptions(null, $event)"
          />
        </div>
      </div>
      <div
        ref="explorerContentRef"
        class="explorer-content"
        @click.capture="handleContentClickCapture"
        @click="handleContentClick"
        @mousedown="handleContentMouseDown"
        @dragstart="onRowDragStart"
        @dragover="onContentDragOver"
        @dragleave="onContentDragLeave"
        @drop="onContentDrop"
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
            v-if="emptyState.showClear && !selectFileMode"
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
            :virtual-rows="tableVirtualRows"
            :virtual-before-height="tableBeforeHeight"
            :virtual-after-height="tableAfterHeight"
            :virtual-row-height="virtualList.itemHeight.value"
            :get-tooltip="(row) => getTooltip(row)"
            :cut-names="currentCutNames"
            :draggable="dragEnabled"
            :drop-target-name="dropTargetName"
            :custom-toggle="toggleSelect"
            :row-contextmenu="updateMenuOptions"
            @open="(row) => emit('open', { item: row })"
            @toggle-group="toggleGroup"
            @select-group="selectGroup"
          />
        </div>
        <div v-else-if="isGrouping" class="explorer-grid-view" :style="groupedGridStyle">
          <div class="explorer-grid-spacer" :style="groupedGridSpacerStyle" aria-hidden="true" />
          <template v-for="block in groupedGridVirtual.visibleBlocks.value" :key="block.key">
            <FileGroupHeader
              v-if="block.data.kind === 'header'"
              :label="block.data.label"
              :collapsed="block.data.collapsed"
              @toggle="toggleGroup(block.data.id)"
              @select="selectGroup(block.data.id)"
              @contextmenu.prevent.stop="updateMenuOptions(null, $event)"
            />
            <div
              v-else
              class="explorer-grid-items"
              :style="{ ...virtualGridItemsStyle, height: `${block.height}px` }"
            >
              <FileGridItem
                v-for="item in block.data.items"
                :key="item.name"
                class="selectable"
                :item="item"
                :base-path="basePath"
                :data-name="item.name"
                :active="selectedItemsSet.has(item)"
                :is-cut="currentCutNames.has(item.name)"
                :draggable="dragEnabled"
                :is-drop-target="dropTargetName === item.name"
                :show-checkbox="allowMultipleSelection"
                :icon-size="iconSizeGrid"
                @open="(i) => emit('open', i)"
                @select="toggleSelect"
                @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
              />
            </div>
          </template>
        </div>
        <div v-else class="explorer-grid-view" :style="virtualGridStyle">
          <div class="explorer-grid-spacer" :style="virtualGridSpacerStyle" aria-hidden="true" />
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
              :draggable="dragEnabled"
              :is-drop-target="dropTargetName === item.name"
              :show-checkbox="allowMultipleSelection"
              :icon-size="iconSizeGrid"
              @open="(i) => emit('open', i)"
              @select="toggleSelect"
              @contextmenu.prevent.stop="updateMenuOptions(item, $event)"
            />
          </div>
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

    @include when-panel-narrow {
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

  .explorer-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .explorer-content {
    padding: 0 2px;
    flex: 1;
    overflow: auto;
    user-select: none;
    position: relative;
  }

  .explorer-sticky-group-slot {
    position: absolute;
    left: 0;
    height: 0;
    z-index: var(--vgo-z-sticky);
    overflow: visible;
    pointer-events: none;
    :deep(.file-group-header) {
      pointer-events: auto;
    }
  }

  .explorer-sticky-group-slot__bar {
    background-color: var(--vgo-surface);
    pointer-events: auto;
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

  // 视口上方那些行的高度：让下面的条目在文档流里就落在正确位置
  // （等价于旧实现里容器的 translateY）。
  .explorer-grid-spacer {
    pointer-events: none;
  }

  .explorer-grid-items {
    margin-left: 10px;
    display: grid;
    align-items: start;
    justify-content: start;
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

    @include when-panel-narrow {
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
