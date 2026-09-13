<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { ExplorerPaneView, ExplorerTabItem } from './ExplorerUI/explorer-tabs-store'
import type { FileSelectResult } from './types'
import type { IDrive } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener, useStorage } from '@vueuse/core'
import { provide } from 'vue'
import { LsKeys } from '@/enum'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { localSettingsStore } from '@/store'
import { resolveMenuIcons } from '@/utils/icons'
import { appsStoreState } from '@/views/Apps/apps-store'
import ExplorerPane from './ExplorerPane.vue'
import ConflictDialog from './ExplorerUI/ConflictDialog.vue'
import { acceptDirDrag, dragEnabledKey, dropIntoDir, isStarDrag, STAR_DRAG_MIME } from './ExplorerUI/entry-drag'
import { isSplitItem, useExplorerTabs } from './ExplorerUI/explorer-tabs-store'
import FilePropertiesWindow from './ExplorerUI/FilePropertiesWindow.vue'
import { useFavourites } from './ExplorerUI/hooks/use-favourites'
import TaskFailureDialog from './ExplorerUI/TaskFailureDialog.vue'
import FileSidebar from './FileSidebar.vue'
import { getLastDirName, normalizeListingPath } from './utils'

const props = withDefaults(
  defineProps<{
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    // 只展示内容
    contentOnly?: boolean
    // 左侧导航是否可见
    sidebarVisible?: boolean
    // 文件后缀过滤正则，如 "\\.(mp4|webm|mkv)$"
    fileFilterPattern?: string
    // 快捷键作用域，供主文件管理器和文件选择器隔离
    shortcutScope?: string
    // 多标签模式：只有主界面用；选择器固定单面板、单标签
    tabsMode?: boolean
  }>(),
  {
    multiple: false,
    contentOnly: false,
    sidebarVisible: true,
    shortcutScope: 'fileManager',
    tabsMode: false,
  },
)
const emit = defineEmits<{
  handleSelect: [val: FileSelectResult]
  cancelSelect: []
}>()
const { selectFileMode } = toRefs(props)
// 选择器模式（FileSelector）只用来挑文件 / 文件夹，整个窗口禁用拖拽
const dragEnabled = computed(() => !selectFileMode.value)
provide(dragEnabledKey, dragEnabled)
// 选择器模式下只响应 FileList 的筛选条目
const rootRef = ref()
const route = useRoute()
const router = useRouter()

/** 选择器（单面板）的路径：沿用旧的 NAV_PATH，标签模式不碰它 */
const selectorPath = useStorage(LsKeys.NAV_PATH, '', localStorage, {
  listenToStorageChanges: false,
})
const SELECTOR_PANE_ID = 'selector'

const {
  items,
  activeTabId,
  activeItemId,
  activePath: tabsActivePath,
  addTab,
  openTab,
  closeTab,
  activateItem,
  activateTab,
  setTabPath,
  setActivePath,
  setPaneView,
} = useExplorerTabs()

/**
 * 选择器窗口的视图偏好。选择器没有面板级状态，所以本地留一份用于当次显示，
 * 同时写回全局设置，下次打开还保持。
 */
const selectorView = ref<ExplorerPaneView>()

function onSelectorViewUpdate(view: ExplorerPaneView) {
  selectorView.value = view
  localSettingsStore.value = { ...localSettingsStore.value, ...view }
}

/** 标签模式下每个面板（拆分项里的两个各自）一个 ExplorerPane；选择器模式固定一个本地面板 */
const activePaneId = computed(() => props.tabsMode ? activeTabId.value : SELECTOR_PANE_ID)
const activePath = computed(() => props.tabsMode ? tabsActivePath.value : selectorPath.value)

/**
 * 我们的 `split` 存的是**分隔线方向**（vertical = 左右并排），而 el-splitter 的 `layout`
 * 是**排列方向**（horizontal = 左右并排），两者恰好相反，只在这里做一次映射。
 */
function splitterLayout(item: ExplorerTabItem) {
  return item.split === 'horizontal' ? 'vertical' : 'horizontal'
}

/** 选择器只有一个面板，底部按钮需要它的选中状态；标签模式外壳不需要引用面板实例 */
const selectorPaneRef = ref<InstanceType<typeof ExplorerPane> | null>(null)

/**
 * 每个标签一个唯一的快捷键 scope，外壳根节点上的 `data-shortcut-scope` 动态指向活动标签。
 * 这样按键只会命中活动面板的注册，隐藏标签的注册虽然还在，但永远不会被 `closest` 选中。
 */
function paneScope(id: string) {
  return props.tabsMode ? `${props.shortcutScope}:${id}` : props.shortcutScope
}
const activeScope = computed(() => paneScope(activePaneId.value))

const fileSidebarRef = ref()
onMounted(async () => {
  if (!fileSidebarRef.value) {
    return
  }
  await fileSidebarRef.value.loadDrives()
  const navPath = typeof route.query.navPath === 'string' ? route.query.navPath : ''
  if (navPath) {
    openPath(navPath)
    router.replace({ query: { ...route.query, navPath: undefined } })
  }
  else if (!activePath.value) {
    // 没有可恢复的路径：打开第一个磁盘。面板自身负责挂载/激活时的首次加载
    fileSidebarRef.value.openFirstDrive()
  }
})

/**
 * 右键菜单的「Open in new Tab」：主界面开内置标签页。
 * 选择器窗口没有标签概念，保持原来的浏览器新标签行为。
 */
function openPathInNewTab(path: string) {
  if (props.tabsMode) {
    openTab(path)
    return
  }
  const routeLocation = router.resolve({
    name: 'HomeView',
    query: {
      ...route.query,
      navPath: path,
    },
  })
  window.open(routeLocation.href, '_blank')
}

/** 面板内部导航回传：写进对应标签（选择器则写本地路径） */
function onPanePathUpdate(id: string, path: string) {
  if (props.tabsMode) {
    setTabPath(id, path)
    return
  }
  selectorPath.value = path
}

/**
 * 标签快捷键。
 *
 * 不走 `useShortcut`：那套按 scope 路由，而标签操作属于外壳、要作用于当前活动标签，
 * 注册到某一个固定 scope 上都不对。这里直接听 keydown，并排除输入框与 App 窗口。
 *
 * 不用 Ctrl+T / Ctrl+W / Ctrl+Tab：Chrome 把这几个保留给浏览器自身，页面拿不到。
 */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (!props.tabsMode || event.defaultPrevented || appsStoreState.activeId || isEditableTarget(event.target)) {
    return
  }
  const mod = event.ctrlKey || event.metaKey
  const alt = event.altKey
  if (!alt || mod || event.shiftKey) {
    return
  }

  const key = event.key.toLowerCase()
  if (key === 't') {
    event.preventDefault()
    addTab()
    return
  }
  if (key === 'w') {
    event.preventDefault()
    closeTab(activeItemId.value)
    return
  }
  if (/^[1-9]$/.test(key)) {
    const item = items.value[Number(key) - 1]
    if (item) {
      event.preventDefault()
      activateItem(item.id)
    }
  }
})

/** 侧边栏磁盘 / 收藏项：只改活动面板的路径，面板会自己刷新 */
function openPath(path: string) {
  if (props.tabsMode) {
    setActivePath(path)
    return
  }
  selectorPath.value = path
}

const { starList, removeStarredPath } = useFavourites()

const starredPathsList = computed(() => [...starList.value])
const currentPathForSidebar = computed(() => activePath.value)

/** 收藏项按当前路径高亮，和磁盘项一样；两边路径形态不一定一致，比较前先归一化 */
function isActiveStarredPath(path: string) {
  return normalizeListingPath(path) === normalizeListingPath(currentPathForSidebar.value)
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

function showStarredPathMenu(path: string, event: MouseEvent) {
  const menuItems: MenuItem[] = [
    {
      label: 'Open',
      icon: 'mdi mdi-folder-open-outline',
      onClick: () => openPath(path),
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
    items: resolveMenuIcons(menuItems),
  })
}
</script>

<template>
  <div ref="rootRef" class="explorer-wrap" tabindex="0" :data-shortcut-scope="activeScope">
    <slot name="topBar" />
    <div class="explorer-body">
      <FileSidebar
        v-if="!contentOnly"
        v-show="sidebarVisible"
        ref="fileSidebarRef"
        :current-path="currentPathForSidebar"
        @open-drive="(i: IDrive) => openPath(i.path)"
        @open-path-in-new-tab="openPathInNewTab"
      >
        <div v-if="starredPathsList.length" ref="starListRef" class="star-list">
          <button
            v-for="(path, index) in starredPathsList"
            :key="path"
            class="vgo-u-button-reset vgo-list-item star-list__item"
            :class="{
              'is-active': isActiveStarredPath(path),
              'is-drop-target': starredDragOverPath === path,
              'is-drag-source': starDragPath === path,
              'is-drop-before': effectiveStarDropIndex === index,
              'is-drop-after': effectiveStarDropIndex === index + 1 && index === starredPathsList.length - 1,
            }"
            :draggable="dragEnabled"
            :title="path"
            @click="openPath(path)"
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

      <!-- 标签模式：一项一个容器，v-show 保活（隐藏的标签不加载预览，见 ThemedIcon）；
           拆分项内部用 el-splitter 排两个面板，单标签项只有一个面板，不画分隔线 -->
      <template v-if="tabsMode">
        <div
          v-for="item in items"
          v-show="item.id === activeItemId"
          :key="item.id"
          class="explorer-tab-panel"
        >
          <el-splitter :layout="splitterLayout(item)">
            <el-splitter-panel
              v-for="pane in item.tabs"
              :key="pane.id"
              @mousedown="activateTab(pane.id)"
              @focusin="activateTab(pane.id)"
            >
              <ExplorerPane
                :path="pane.path"
                :view="pane.view"
                :active="item.id === activeItemId"
                :focused="pane.id === activeTabId"
                :shortcut-scope="paneScope(pane.id)"
                :select-file-mode="selectFileMode"
                :multiple="multiple"
                :content-only="contentOnly"
                :file-filter-pattern="fileFilterPattern"
                @update:path="(path: string) => onPanePathUpdate(pane.id, path)"
                @update:view="(view: ExplorerPaneView) => setPaneView(pane.id, view)"
                @handle-select="emit('handleSelect', $event)"
                @cancel-select="emit('cancelSelect')"
                @open-path-in-new-tab="openPathInNewTab"
              />
              <!-- 拆分视图下聚焦面板的描边：必须是不吃点击的浮层，画在面板自身上会被
                   内部有背景的元素（工具栏、滚动区、状态栏）盖住 -->
              <div
                v-if="isSplitItem(item) && pane.id === activeTabId"
                class="explorer-pane-outline"
              />
            </el-splitter-panel>
          </el-splitter>
        </div>
      </template>
      <!-- 选择器：固定单面板，路径沿用 NAV_PATH，视图偏好走全局设置 -->
      <ExplorerPane
        v-else
        ref="selectorPaneRef"
        v-model:path="selectorPath"
        :view="selectorView"
        :shortcut-scope="paneScope(SELECTOR_PANE_ID)"
        :select-file-mode="selectFileMode"
        :multiple="multiple"
        :content-only="contentOnly"
        :file-filter-pattern="fileFilterPattern"
        @update:view="onSelectorViewUpdate"
        @handle-select="emit('handleSelect', $event)"
        @cancel-select="emit('cancelSelect')"
        @open-path-in-new-tab="openPathInNewTab"
      />
    </div>

    <ConflictDialog />
    <TaskFailureDialog />
    <FilePropertiesWindow />

    <!-- 文件选择器 -->
    <div v-if="selectFileMode && selectorPaneRef?.hasFileList" class="vgo-u-surface explorer-bottom-wrap">
      <button class="vgo-button vgo-button--primary" @click="selectorPaneRef?.handleSelect()">
        {{ selectFileMode === 'file' || selectorPaneRef?.isSelectAFolder ? 'Open' : 'Select Folder' }}
      </button>
      <button class="vgo-button" @click="emit('cancelSelect')">
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

  .explorer-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  // 面板根元素（ExplorerPane）的布局：scoped 样式会作用到子组件根节点
  .explorer-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  // 拆分视图下给聚焦的面板一圈主题色 inset 描边（浮层，见模板）
  .explorer-pane-outline {
    position: absolute;
    inset: 0;
    outline: 2px solid var(--vgo-primary);
    outline-offset: -2px;
    pointer-events: none;
    z-index: var(--vgo-z-sticky);
  }

  // 标签项容器：v-show 保活，撑满侧边栏右侧的区域
  .explorer-tab-panel {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  // el-splitter 是单根子组件，根节点会带上本组件的 scope id；el-splitter-panel 是多根
  // （面板 + 分隔线两个根节点），Vue 不会把父组件的 scope id 贴上去，只能用 :deep()
  .explorer-tab-panel > .el-splitter {
    flex: 1;
    min-width: 0;
  }

  // 面板自带 overflow: auto，会和面板内部的滚动容器叠成两条滚动条；relative 给描边浮层当定位父级
  .explorer-tab-panel :deep(.el-splitter-panel) {
    position: relative;
    display: flex;
    overflow: hidden;
    min-width: 0;
  }

  // 侧边栏根元素归布局管：固定宽度 + 右侧分隔线（以前由分栏组件提供）
  .explorer-body > .explorer-sidebar {
    flex-shrink: 0;
    width: 130px;
    overflow: auto;
    border-right: 1px solid var(--vgo-border);
  }

  .star-list {
    &__item {
      position: relative;
      width: 100%;
      min-height: var(--vgo-control-sm);
      font-size: var(--vgo-font-sm);
      padding-inline: var(--vgo-space-2);

      // 高亮只留底色，去掉 vgo-list-item.is-active 的 1px outline，和磁盘项保持一致；
      // 写在 is-drop-target 之前，拖拽落点的虚线仍能盖过它
      &.is-active {
        outline: none;
      }

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

  .explorer-bottom-wrap {
    padding: var(--vgo-space-1);
    display: flex;
    justify-content: flex-end;
    gap: var(--vgo-space-1);
  }
}
</style>
