import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { guid } from '@/utils'
import { normalizeListingPath } from '../utils'

/**
 * 内置标签页的状态。模块级单例 + localStorage 持久化，风格与 `Apps/apps-store.ts` 一致
 * （项目虽然装了 pinia，但既有代码没有用过，不为这一个功能单独引入）。
 *
 * `path` 存原样（可能是空串），只有比较时才 `normalizeListingPath` —— 空串意味着
 * 「还没导航过」，外壳要靠它决定是否打开第一个磁盘，归一成 `/` 会把这个语义弄丢。
 */
export interface ExplorerTab {
  id: string
  path: string
}

interface ExplorerTabsState {
  tabs: ExplorerTab[]
  activeTabId: string
}

function createTab(path: string): ExplorerTab {
  return { id: guid(), path }
}

function createDefaultState(): ExplorerTabsState {
  return { tabs: [], activeTabId: '' }
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

/** 把持久化里读到的内容收敛成合法状态：至少 1 个标签、activeTabId 必须存在。 */
function normalizeState() {
  const raw = state.value
  const tabs = Array.isArray(raw?.tabs)
    ? raw.tabs.filter((tab): tab is ExplorerTab =>
        Boolean(tab) && typeof tab.id === 'string' && typeof tab.path === 'string')
    : []

  if (!tabs.length) {
    // 老版本只有一份 NAV_PATH：迁移成 1 个标签
    tabs.push(createTab(legacyNavPath.value || ''))
  }

  const activeTabId = tabs.some(tab => tab.id === raw?.activeTabId) ? raw.activeTabId : tabs[0].id
  state.value = { tabs, activeTabId }
}

normalizeState()

const tabs = computed(() => state.value.tabs)

const activeTab = computed(() => state.value.tabs.find(tab => tab.id === state.value.activeTabId) ?? null)

const activePath = computed(() => activeTab.value?.path ?? '')

/** 活动标签的路径变化时同步一份到 NAV_PATH，供深链与选择器兜底 */
watch(activePath, (path) => {
  if (legacyNavPath.value !== path) {
    legacyNavPath.value = path
  }
})

/** 只剩 1 个标签时不允许关闭 */
const canCloseTabs = computed(() => state.value.tabs.length > 1)

function findTabIndex(id: string) {
  return state.value.tabs.findIndex(tab => tab.id === id)
}

export function useExplorerTabs() {
  /** 新建标签并激活，永远追加在最后。默认沿用当前标签的路径（和资源管理器一致）。 */
  function addTab(path = activePath.value): string {
    const tab = createTab(path)
    state.value = { tabs: [...state.value.tabs, tab], activeTabId: tab.id }
    return tab.id
  }

  /**
   * 右键菜单的「Open in new Tab」：同一个路径已经开着就切过去，
   * 免得同一个目录堆出好几个标签。
   */
  function openTab(path: string): string {
    const target = normalizeListingPath(path)
    const existing = state.value.tabs.find(tab => normalizeListingPath(tab.path) === target)
    if (existing) {
      activateTab(existing.id)
      return existing.id
    }
    return addTab(path)
  }

  /** 关闭标签；只剩 1 个时拒绝（至少保留 1 个）。 */
  function closeTab(id: string): boolean {
    if (!canCloseTabs.value) {
      return false
    }
    const index = findTabIndex(id)
    if (index === -1) {
      return false
    }
    const next = state.value.tabs.filter(tab => tab.id !== id)
    // 关掉活动标签后接右邻，没有右邻就接左邻
    const activeTabId = state.value.activeTabId === id
      ? (next[index] ?? next[index - 1]).id
      : state.value.activeTabId
    state.value = { tabs: next, activeTabId }
    return true
  }

  function activateTab(id: string) {
    if (state.value.activeTabId === id || findTabIndex(id) === -1) {
      return
    }
    state.value = { ...state.value, activeTabId: id }
  }

  function activateRelative(step: number) {
    const { tabs: list, activeTabId } = state.value
    const index = findTabIndex(activeTabId)
    if (index === -1 || list.length < 2) {
      return
    }
    const next = (index + step + list.length) % list.length
    activateTab(list[next].id)
  }

  /** 只留这一个标签（天然满足「至少保留 1 个」） */
  function closeOthers(id: string) {
    const index = findTabIndex(id)
    if (index === -1 || state.value.tabs.length < 2) {
      return
    }
    state.value = { tabs: [state.value.tabs[index]], activeTabId: id }
  }

  /** 关掉它左边的所有标签；活动标签被关掉时接到第一个留下的 */
  function closeToLeft(id: string) {
    const index = findTabIndex(id)
    if (index <= 0) {
      return
    }
    const next = state.value.tabs.slice(index)
    const activeTabId = next.some(tab => tab.id === state.value.activeTabId)
      ? state.value.activeTabId
      : next[0].id
    state.value = { tabs: next, activeTabId }
  }

  /** 关掉它右边的所有标签；活动标签被关掉时接到最后一个留下的 */
  function closeToRight(id: string) {
    const index = findTabIndex(id)
    if (index === -1 || index === state.value.tabs.length - 1) {
      return
    }
    const next = state.value.tabs.slice(0, index + 1)
    const activeTabId = next.some(tab => tab.id === state.value.activeTabId)
      ? state.value.activeTabId
      : next[next.length - 1].id
    state.value = { tabs: next, activeTabId }
  }

  function moveTab(from: number, to: number) {
    const list = [...state.value.tabs]
    if (from < 0 || from >= list.length || to < 0 || to > list.length || from === to) {
      return
    }
    const [moved] = list.splice(from, 1)
    // `to` 是「未删除前」的插入下标，删掉源之后要回退一位
    list.splice(from < to ? to - 1 : to, 0, moved)
    state.value = { ...state.value, tabs: list }
  }

  function setTabPath(id: string, path: string) {
    const index = findTabIndex(id)
    if (index === -1 || state.value.tabs[index].path === path) {
      return
    }
    const list = [...state.value.tabs]
    list[index] = { ...list[index], path }
    state.value = { ...state.value, tabs: list }
  }

  function setActivePath(path: string) {
    setTabPath(state.value.activeTabId, path)
  }

  return {
    state,
    tabs,
    activeTab,
    activePath,
    activeTabId: computed(() => state.value.activeTabId),
    canCloseTabs,
    addTab,
    openTab,
    closeTab,
    closeOthers,
    closeToLeft,
    closeToRight,
    activateTab,
    activateRelative,
    moveTab,
    setTabPath,
    setActivePath,
  }
}
