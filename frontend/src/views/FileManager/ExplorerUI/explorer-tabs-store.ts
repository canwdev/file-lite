import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { guid } from '@/utils'
import { normalizeListingPath } from '../utils'

/**
 * 内置标签页的状态。模块级单例 + localStorage 持久化，风格与 `Apps/apps-store.ts` 一致
 * （项目虽然装了 pinia，但既有代码没有用过，不为这一个功能单独引入）。
 *
 * 两层结构：
 * - `ExplorerTab` 是**面板**（pane），真正渲染文件列表的那个，路径挂在它身上；
 * - `ExplorerTabItem` 是标签条上的**一项**，含 1 个面板（单标签）或 2 个面板（拆分视图）。
 *   拆分项的两个面板共享一个标签项与一个关闭按钮。
 *
 * `path` 存原样（可能是空串），只有比较时才 `normalizeListingPath` —— 空串意味着
 * 「还没导航过」，外壳要靠它决定是否打开第一个磁盘，归一成 `/` 会把这个语义弄丢。
 */
/**
 * 面板自己的视图偏好。跟标签内容一起挂在面板上持久化：拆分视图里两个面板各看各的，
 * 改动一个不会带着另一个一起变。没设置过的面板（刚开、没动过）继续用全局设置，
 * 选择器窗口没有面板级状态，也一直走全局设置。
 */
export interface ExplorerPaneView {
  grid: boolean
  iconSizeList: number
  iconSizeGrid: number
}

export interface ExplorerTab {
  id: string
  path: string
  /** 面板级视图偏好；未设置时由外壳回落到全局设置 */
  view?: ExplorerPaneView
}

/** 分隔线方向：vertical = 左右并排（默认），horizontal = 上下堆叠。el-splitter 的 layout 与之相反，映射见 FileManager.vue */
export type ExplorerSplitDirection = 'vertical' | 'horizontal'

export interface ExplorerTabItem {
  id: string
  /** 1 个（单标签）或 2 个（拆分）面板 */
  tabs: ExplorerTab[]
  /** 仅拆分项存在 */
  split?: ExplorerSplitDirection
  /** 该项内聚焦的面板 id，必须属于 tabs */
  activeTabId: string
}

interface ExplorerTabsState {
  items: ExplorerTabItem[]
  activeItemId: string
}

function createTab(path: string): ExplorerTab {
  return { id: guid(), path }
}

/** 单标签项：项 id 就取它唯一那个面板的 id，拆分 / 取消拆分时包装元素能原地复用 */
function createItem(path: string): ExplorerTabItem {
  const tab = createTab(path)
  return { id: tab.id, tabs: [tab], activeTabId: tab.id }
}

export function isSplitItem(item: ExplorerTabItem): boolean {
  return item.tabs.length > 1
}

function isSplitDirection(value: unknown): value is ExplorerSplitDirection {
  return value === 'vertical' || value === 'horizontal'
}

function createDefaultState(): ExplorerTabsState {
  return { items: [], activeItemId: '' }
}

/**
 * 只用于迁移与深链的「上次路径」。新代码一律读标签 store，
 * 保留它是为了 `?navPath=`、`file_lite_nav_path` 的老数据以及选择器的初始目录。
 */
const legacyNavPath = useStorage(LsKeys.NAV_PATH, '', localStorage, {
  listenToStorageChanges: false,
})

const state = useStorage<ExplorerTabsState>(LsKeys.EXPLORER_TABS, createDefaultState(), localStorage, {
  mergeDefaults: true,
  listenToStorageChanges: false,
})

function normalizePanes(raw: unknown): ExplorerTab[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const panes: ExplorerTab[] = []
  for (const entry of raw) {
    if (panes.length >= 2) {
      break
    }
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      continue
    }
    panes.push({ id: entry.id, path: entry.path, view: normalizePaneView(entry.view) })
  }
  return panes
}

/** 面板级视图偏好三项必须齐全才认，否则整份丢掉，回落到全局设置 */
function normalizePaneView(raw: unknown): ExplorerPaneView | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const { grid, iconSizeList, iconSizeGrid } = raw as Partial<ExplorerPaneView>
  if (typeof grid !== 'boolean' || !Number.isFinite(iconSizeList) || !Number.isFinite(iconSizeGrid)) {
    return undefined
  }
  return {
    grid,
    iconSizeList: iconSizeList as number,
    iconSizeGrid: iconSizeGrid as number,
  }
}

/**
 * 把持久化里读到的内容收敛成合法状态：至少 1 项、activeItemId / activeTabId 必须存在、
 * 面板 id 不重复、最多 2 个面板。
 *
 * 旧结构（只有 `tabs` 没有 `items`）不兼容也不再迁移：读不到合法项就当没有数据，
 * 退化成 `NAV_PATH` 的 1 个标签。
 */
function normalizeState() {
  const raw = state.value as Partial<ExplorerTabsState> | undefined
  const items: ExplorerTabItem[] = []
  const itemIds = new Set<string>()
  const paneIds = new Set<string>()

  for (const entry of Array.isArray(raw?.items) ? raw.items : []) {
    if (!entry || typeof entry.id !== 'string' || itemIds.has(entry.id)) {
      continue
    }
    const tabs = normalizePanes(entry.tabs).filter(tab => !paneIds.has(tab.id))
    if (!tabs.length) {
      continue
    }
    itemIds.add(entry.id)
    tabs.forEach(tab => paneIds.add(tab.id))
    const activeTabId = tabs.some(tab => tab.id === entry.activeTabId) ? entry.activeTabId : tabs[0].id
    items.push({
      id: entry.id,
      tabs,
      ...(tabs.length > 1 ? { split: isSplitDirection(entry.split) ? entry.split : 'vertical' as const } : {}),
      activeTabId,
    })
  }

  if (!items.length) {
    // 老版本只有一份 NAV_PATH：迁移成 1 个标签
    items.push(createItem(legacyNavPath.value || ''))
  }

  const activeItemId = items.some(item => item.id === raw?.activeItemId) ? raw!.activeItemId! : items[0].id
  state.value = { items, activeItemId }
}

normalizeState()

const items = computed(() => state.value.items)

const activeItem = computed(() => state.value.items.find(item => item.id === state.value.activeItemId) ?? null)

/** 当前聚焦的面板 id（拆分项里就是其中一个面板） */
const activeTabId = computed(() => activeItem.value?.activeTabId ?? '')

const activePane = computed(() =>
  activeItem.value?.tabs.find(tab => tab.id === activeItem.value?.activeTabId) ?? null)

const activePath = computed(() => activePane.value?.path ?? '')

/** 活动标签的路径变化时同步一份到 NAV_PATH，供深链与选择器兜底 */
watch(activePath, (path) => {
  if (legacyNavPath.value !== path) {
    legacyNavPath.value = path
  }
})

/** 只剩 1 项时不允许关闭（关一项 = 关掉它里面所有面板） */
const canCloseTabs = computed(() => state.value.items.length > 1)

function findItemIndex(id: string) {
  return state.value.items.findIndex(item => item.id === id)
}

function findPaneOwner(paneId: string) {
  return state.value.items.find(item => item.tabs.some(tab => tab.id === paneId)) ?? null
}

/** 写回一整份项列表；activeItemId 失效时退到第一项 */
function replaceItems(next: ExplorerTabItem[], nextActiveItemId = state.value.activeItemId) {
  const activeItemId = next.some(item => item.id === nextActiveItemId) ? nextActiveItemId : next[0].id
  state.value = { items: next, activeItemId }
}

function patchItem(itemId: string, patch: Partial<ExplorerTabItem>) {
  replaceItems(state.value.items.map(item => item.id === itemId ? { ...item, ...patch } : item))
}

export function useExplorerTabs() {
  /** 新建标签并激活，永远追加在最后。默认沿用当前标签的路径（和资源管理器一致）。 */
  function addTab(path = activePath.value): string {
    const item = createItem(path)
    replaceItems([...state.value.items, item], item.id)
    return item.id
  }

  /**
   * 右键菜单的「Open in new Tab」：同一个路径已经开着就切过去，
   * 免得同一个目录堆出好几个标签。拆分项里的面板同样会被认出来。
   */
  function openTab(path: string): string {
    const target = normalizeListingPath(path)
    const existing = state.value.items
      .flatMap(item => item.tabs)
      .find(tab => normalizeListingPath(tab.path) === target)
    if (existing) {
      activateTab(existing.id)
      return existing.id
    }
    return addTab(path)
  }

  /** 关闭整个标签项（拆分时两个面板一起）；只剩 1 项时拒绝。 */
  function closeTab(itemId: string): boolean {
    if (!canCloseTabs.value) {
      return false
    }
    const index = findItemIndex(itemId)
    if (index === -1) {
      return false
    }
    const next = state.value.items.filter(item => item.id !== itemId)
    // 关掉活动项后接右邻，没有右邻就接左邻
    const activeItemId = state.value.activeItemId === itemId
      ? (next[index] ?? next[index - 1]).id
      : state.value.activeItemId
    replaceItems(next, activeItemId)
    return true
  }

  /** 聚焦某个面板（同时激活它所在的项）。 */
  function activateTab(paneId: string) {
    const item = findPaneOwner(paneId)
    if (!item || (state.value.activeItemId === item.id && item.activeTabId === paneId)) {
      return
    }
    state.value = {
      activeItemId: item.id,
      items: state.value.items.map(entry =>
        entry.id === item.id ? { ...entry, activeTabId: paneId } : entry),
    }
  }

  /** 只切活动项，保留项内原来聚焦的面板（快捷键跳转 / 弹簧加载 / 点标签主体） */
  function activateItem(itemId: string) {
    if (state.value.activeItemId === itemId || findItemIndex(itemId) === -1) {
      return
    }
    state.value = { ...state.value, activeItemId: itemId }
  }

  function activateRelative(step: number) {
    const list = state.value.items
    const index = findItemIndex(state.value.activeItemId)
    if (index === -1 || list.length < 2) {
      return
    }
    const next = (index + step + list.length) % list.length
    activateItem(list[next].id)
  }

  /** 只留这一项（天然满足「至少保留 1 个」） */
  function closeOthers(itemId: string) {
    const index = findItemIndex(itemId)
    if (index === -1 || state.value.items.length < 2) {
      return
    }
    replaceItems([state.value.items[index]], itemId)
  }

  /** 关掉它左边的所有项；活动项被关掉时接到第一个留下的 */
  function closeToLeft(itemId: string) {
    const index = findItemIndex(itemId)
    if (index <= 0) {
      return
    }
    const next = state.value.items.slice(index)
    const activeItemId = next.some(item => item.id === state.value.activeItemId)
      ? state.value.activeItemId
      : next[0].id
    replaceItems(next, activeItemId)
  }

  /** 关掉它右边的所有项；活动项被关掉时接到最后一个留下的 */
  function closeToRight(itemId: string) {
    const index = findItemIndex(itemId)
    if (index === -1 || index === state.value.items.length - 1) {
      return
    }
    const next = state.value.items.slice(0, index + 1)
    const activeItemId = next.some(item => item.id === state.value.activeItemId)
      ? state.value.activeItemId
      : next[next.length - 1].id
    replaceItems(next, activeItemId)
  }

  function moveTab(from: number, to: number) {
    const list = [...state.value.items]
    if (from < 0 || from >= list.length || to < 0 || to > list.length || from === to) {
      return
    }
    const [moved] = list.splice(from, 1)
    // `to` 是「未删除前」的插入下标，删掉源之后要回退一位
    list.splice(from < to ? to - 1 : to, 0, moved)
    replaceItems(list)
  }

  function setTabPath(paneId: string, path: string) {
    const item = findPaneOwner(paneId)
    if (!item) {
      return
    }
    const index = item.tabs.findIndex(tab => tab.id === paneId)
    if (index === -1 || item.tabs[index].path === path) {
      return
    }
    const tabs = [...item.tabs]
    tabs[index] = { ...tabs[index], path }
    patchItem(item.id, { tabs })
  }

  function setActivePath(path: string) {
    setTabPath(activeTabId.value, path)
  }

  /** 写某个面板自己的视图偏好（list/grid、图标大小），只影响这一个面板 */
  function setPaneView(paneId: string, view: ExplorerPaneView) {
    const item = findPaneOwner(paneId)
    if (!item) {
      return
    }
    const index = item.tabs.findIndex(tab => tab.id === paneId)
    if (index === -1) {
      return
    }
    const tabs = [...item.tabs]
    tabs[index] = { ...tabs[index], view }
    patchItem(item.id, { tabs })
  }

  /**
   * 拆分视图：优先吸收右邻单标签项，其次左邻，都没有就新建一个同路径标签当第二个面板。
   * 合并后的项落在两者中靠前的位置，面板顺序保持标签条原来的左右顺序。
   */
  function splitTab(itemId: string) {
    const index = findItemIndex(itemId)
    if (index === -1) {
      return
    }
    const item = state.value.items[index]
    if (isSplitItem(item)) {
      return
    }
    const self = item.tabs[0]

    const right = state.value.items[index + 1]
    const left = state.value.items[index - 1]
    const neighbor = right && !isSplitItem(right)
      ? { item: right, prepend: false }
      : (left && !isSplitItem(left) ? { item: left, prepend: true } : null)

    const tabs = neighbor
      ? (neighbor.prepend ? [neighbor.item.tabs[0], self] : [self, neighbor.item.tabs[0]])
      : [self, createTab(self.path)]

    const merged: ExplorerTabItem = { id: item.id, tabs, split: 'vertical', activeTabId: self.id }
    const next = state.value.items.filter(entry => entry.id !== item.id && entry.id !== neighbor?.item.id)
    next.splice(neighbor?.prepend ? index - 1 : index, 0, merged)
    replaceItems(next, merged.id)
  }

  /** 取消拆分：无损换回两个独立标签，按原左右顺序插回原位置 */
  function unsplit(itemId: string) {
    const index = findItemIndex(itemId)
    if (index === -1) {
      return
    }
    const item = state.value.items[index]
    if (!isSplitItem(item)) {
      return
    }
    const next = [...state.value.items]
    next.splice(index, 1, ...item.tabs.map(tab => ({ id: tab.id, tabs: [tab], activeTabId: tab.id })))
    replaceItems(next, item.activeTabId)
  }

  function toggleSplitDirection(itemId: string) {
    const item = state.value.items.find(entry => entry.id === itemId)
    if (!item || !isSplitItem(item)) {
      return
    }
    patchItem(itemId, { split: item.split === 'horizontal' ? 'vertical' : 'horizontal' })
  }

  function swapSplitPanes(itemId: string) {
    const item = state.value.items.find(entry => entry.id === itemId)
    if (!item || !isSplitItem(item)) {
      return
    }
    patchItem(itemId, { tabs: [...item.tabs].reverse() })
  }

  /** 把拆分项里聚焦面板的目录同步给另一个面板（另一个面板自己刷新过去） */
  function syncSplitPath(itemId: string) {
    const item = state.value.items.find(entry => entry.id === itemId)
    if (!item || !isSplitItem(item)) {
      return
    }
    const sourceIndex = item.tabs.findIndex(tab => tab.id === item.activeTabId)
    if (sourceIndex === -1) {
      return
    }
    const targetIndex = sourceIndex === 0 ? 1 : 0
    const path = item.tabs[sourceIndex].path
    if (normalizeListingPath(item.tabs[targetIndex].path) === normalizeListingPath(path)) {
      return
    }
    const tabs = [...item.tabs]
    tabs[targetIndex] = { ...tabs[targetIndex], path }
    patchItem(itemId, { tabs })
  }

  return {
    state,
    items,
    activeItem,
    activeItemId: computed(() => state.value.activeItemId),
    activeTabId,
    activePath,
    canCloseTabs,
    addTab,
    openTab,
    closeTab,
    closeOthers,
    closeToLeft,
    closeToRight,
    activateTab,
    activateItem,
    activateRelative,
    moveTab,
    setTabPath,
    setActivePath,
    setPaneView,
    splitTab,
    unsplit,
    toggleSplitDirection,
    swapSplitPanes,
    syncSplitPath,
  }
}
