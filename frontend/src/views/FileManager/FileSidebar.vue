<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { MountedVolume } from './ExplorerUI/mounted-volumes'
import type { IDrive } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { bytesToSize } from '@/utils'
import { resolveMenuIcons } from '@/utils/icons'
import { driveList, drivesLoading, loadDrives as refreshDrives } from './ExplorerUI/drives'
import { acceptDirDrag, dropIntoDir, useDragEnabled } from './ExplorerUI/entry-drag'
import {
  grantMountedVolume,
  isMountSupported,
  isPickerCancelled,
  loadMountedVolumes,
  mountBrowserFolder,
  mountedVolumeListingPath,
  mountedVolumes,
  mountedVolumesLoaded,
  requestAllMountedVolumes,
  unmountBrowserFolder,
} from './ExplorerUI/mounted-volumes'

interface Props {
  currentPath?: string
}

const props = withDefaults(defineProps<Props>(), {
})

const emit = defineEmits(['openDrive', 'openPathInNewTab', 'openMountedVolume'])

const { currentPath } = toRefs(props)

const isLoading = drivesLoading

/**
 * 浏览器挂载区。
 *
 * `canMount` 为假（Firefox / Safari）时整块不渲染——在那里给一个点了没反应的
 * 入口比没有更糟。
 */
const canMount = computed(() => isMountSupported())
const mountedList = computed(() => mountedVolumes.value)
/** 正在授权中的卷：按钮转圈，避免重复点击 */
const grantingIds = ref<Set<string>>(new Set())
const mounting = ref(false)

const pendingCount = computed(() => mountedList.value.filter(volume => volume.access === 'prompt').length)
/** 空态只在恢复完成后出现，否则每次刷新都会闪一下「没有挂载」 */
const showEmptyState = computed(() =>
  canMount.value && mountedVolumesLoaded.value && !mountedList.value.length,
)

/** 驱动器列表由 drives.ts 共享缓存：拖拽判定「是否同一个卷」也要用它 */
async function loadDrives() {
  await refreshDrives(true)
}

/** 挂载卷的恢复（读句柄 + 查权限）由侧边栏负责，外壳只需要等它完成 */
async function loadMounted() {
  await loadMountedVolumes()
}

function openFirstDrive() {
  if (driveList.value[0]) {
    emit('openDrive', driveList.value[0])
  }
}

function getIcon(item: IDrive) {
  // 图标看 kind，不看「有没有容量」：网络位置与拿不到容量的卷都会被误判。
  // 后端不带 kind 时（老版本）沿用「有容量才算卷」的回退。
  const kind = item.kind ?? (item.total ? 'volume' : undefined)
  if (item.label.toLowerCase() === 'home') {
    return 'mdi-home'
  }
  if (item.label.toLowerCase() === 'data') {
    return 'mdi-folder-pound-outline'
  }
  // 加密未解锁的卷：读不到卷标也读不到容量，给「文件夹 + 锁」，
  // 别让它看起来像一块普通硬盘，也别丢掉「它是个可点的位置」这层意思
  if (kind === 'locked') {
    return 'mdi-folder-lock-outline'
  }
  if (kind === 'network') {
    return 'mdi-folder-network-outline'
  }
  if (kind === 'home') {
    return 'mdi-home'
  }
  if (!item.total) {
    return 'mdi-folder-outline'
  }
  return 'mdi-harddisk'
}

function openDrive(item: IDrive) {
  if (item.path !== currentPath.value) {
    emit('openDrive', item)
  }
}

/* ------------------------------------------------------------------ */
/* 浏览器挂载的本地文件夹                                              */
/* ------------------------------------------------------------------ */

/** 需要重新授权时用「文件夹 + 锁」，和「已经能用」的卷区分开 */
function getMountedIcon(volume: MountedVolume) {
  return volume.access === 'granted' ? 'mdi-folder-arrow-up-down-outline' : 'mdi-folder-lock-outline'
}

function isActiveMounted(volume: MountedVolume) {
  return mountedVolumeListingPath(volume.id) === currentPath.value
}

function getMountedTitle(volume: MountedVolume) {
  if (volume.access === 'granted') {
    return `${volume.label}\nLocal folder mounted from this browser`
  }
  if (volume.access === 'denied') {
    return `${volume.label}\nAccess denied — unmount and pick the folder again`
  }
  return `${volume.label}\nClick to restore access (the browser asks for permission again after a reload)`
}

function setGranting(id: string, value: boolean) {
  const next = new Set(grantingIds.value)
  if (value) {
    next.add(id)
  }
  else {
    next.delete(id)
  }
  grantingIds.value = next
}

function openMountedVolume(volume: MountedVolume) {
  if (volume.access === 'granted') {
    emit('openMountedVolume', volume)
    return
  }
  void grantAndOpen(volume)
}

/** 授权必须在用户手势里发起，所以这一步由点击驱动；授权成功再导航进去。 */
async function grantAndOpen(volume: MountedVolume) {
  if (grantingIds.value.has(volume.id)) {
    return
  }
  setGranting(volume.id, true)
  try {
    const access = await grantMountedVolume(volume.id)
    if (access === 'granted') {
      emit('openMountedVolume', volume)
    }
    else if (access === null) {
      window.$message?.error('This mounted folder is no longer available')
    }
    else {
      window.$message?.warning('Access to the mounted folder was not granted')
    }
  }
  finally {
    setGranting(volume.id, false)
  }
}

/**
 * 一次性恢复全部待授权卷。
 *
 * 浏览器只保证「用户手势内发起」的授权请求会被处理，所以这里必须由这个点击
 * 同步触发；有多少个卷就会弹多少次确认框。
 */
async function requestAllAccess() {
  await requestAllMountedVolumes()
  const stillPending = mountedVolumes.value.filter(volume => volume.access !== 'granted').length
  if (stillPending) {
    window.$message?.info(`${stillPending} mounted folder(s) still need access`)
  }
}

async function mountFolder() {
  if (mounting.value) {
    return
  }
  mounting.value = true
  try {
    const volume = await mountBrowserFolder()
    if (volume) {
      emit('openMountedVolume', volume)
    }
  }
  catch (error) {
    if (isPickerCancelled(error)) {
      return
    }
    console.error('[mounted-volumes] mount failed', error)
    window.$message?.error('Failed to mount the folder')
  }
  finally {
    mounting.value = false
  }
}

async function unmount(volume: MountedVolume, event?: MouseEvent) {
  event?.stopPropagation()
  await unmountBrowserFolder(volume.id)
}

function showMountedMenu(volume: MountedVolume, event: MouseEvent) {
  const items: MenuItem[] = []

  if (volume.access === 'granted') {
    items.push({
      label: 'Open',
      icon: 'mdi mdi-folder-open-outline',
      onClick: () => emit('openMountedVolume', volume),
    })
    items.push({
      label: 'Open in new Tab',
      icon: 'mdi mdi-open-in-new',
      onClick: () => emit('openPathInNewTab', mountedVolumeListingPath(volume.id)),
    })
  }
  else {
    items.push({
      label: 'Restore Access',
      icon: 'mdi mdi-key-outline',
      onClick: () => void grantAndOpen(volume),
    })
  }

  items.push({
    label: 'Unmount',
    icon: 'mdi mdi-eject',
    onClick: () => void unmount(volume),
  })

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(items),
  })
}

/* ------------------------------------------------------------------ */
/* 磁盘根是拖拽落点：拖到磁盘上 = 移动 / 复制（跨卷自动变成复制）到该卷 */
/* ------------------------------------------------------------------ */
const dragEnabled = useDragEnabled()
const dragOverPath = ref<string | null>(null)

function onDriveDragOver(item: IDrive, event: DragEvent) {
  if (!dragEnabled.value) {
    return
  }
  if (!acceptDirDrag(item.path, event)) {
    if (dragOverPath.value === item.path) {
      dragOverPath.value = null
    }
    return
  }
  dragOverPath.value = item.path
}

function onDriveDragLeave(item: IDrive, event: DragEvent) {
  if (dragOverPath.value !== item.path) {
    return
  }
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as Node | null)?.contains(next)) {
    return
  }
  dragOverPath.value = null
}

function onDriveDrop(item: IDrive, event: DragEvent) {
  dragOverPath.value = null
  if (!dragEnabled.value) {
    return
  }
  dropIntoDir(item.path, event)
}

function clearDragOver() {
  dragOverPath.value = null
}

onMounted(() => window.addEventListener('dragend', clearDragOver))
onBeforeUnmount(() => window.removeEventListener('dragend', clearDragOver))

function showDriveMenu(item: IDrive, event: MouseEvent) {
  const items: MenuItem[] = [
    {
      label: 'Open',
      icon: 'mdi mdi-folder-open-outline',
      onClick: () => openDrive(item),
    },
    {
      label: 'Open in new Tab',
      icon: 'mdi mdi-open-in-new',
      onClick: () => emit('openPathInNewTab', item.path),
    },
  ]

  ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(items),
  })
}

function getTitle(item: IDrive) {
  let txt = `Path: ${item.path}`

  if (item.total && item.free) {
    const used = item.total - item.free
    txt += `
Used: ${bytesToSize(used)}/${bytesToSize(item.total)} (${`${((used / item.total) * 100).toFixed(0)}%`})
Available: ${bytesToSize(item.free)}
`
  }
  return txt
}

defineExpose({
  loadDrives,
  loadMounted,
  openFirstDrive,
})
</script>

<template>
  <div class="explorer-sidebar">
    <slot />
    <!-- 挂载本地文件夹：按规范复用 Storage 列表的全部视觉语言，只有标题栏的
         加号按钮与每项右侧的取消挂载是自己的一层 -->
    <div v-if="canMount" class="sidebar-list mounted-list">
      <div class="sidebar-list__header">
        <span>OPFS</span>
        <span class="mounted-list__actions">
          <button
            v-if="pendingCount"
            class="vgo-button vgo-button--text vgo-button--sm"
            title="Restore access to every mounted folder"
            @click="requestAllAccess"
          >
            <i-mdi-key-outline class="vgo-u-icon-sm" />
          </button>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
            title="Mount a local folder"
            :disabled="mounting"
            @click="mountFolder"
          >
            <i-mdi-plus class="vgo-u-icon-sm" />
          </button>
        </span>
      </div>

      <!-- 行是 div 而不是 button：取消挂载按钮要嵌在行里，button 不能套 button
           （FileTable 的行同样用非 button 容器承载 vgo-list-item） -->
      <div
        v-for="volume in mountedList"
        :key="volume.id"
        class="vgo-u-button-reset vgo-list-item sidebar-list__item mounted-list__item"
        :class="{
          'is-active': isActiveMounted(volume),
          'is-locked': volume.access !== 'granted',
        }"
        role="button"
        tabindex="0"
        :title="getMountedTitle(volume)"
        @click="openMountedVolume(volume)"
        @keydown.enter.prevent="openMountedVolume(volume)"
        @keydown.space.prevent="openMountedVolume(volume)"
        @contextmenu.prevent.stop="showMountedMenu(volume, $event)"
      >
        <span class="sidebar-list__icon">
          <MdiIcon :name="getMountedIcon(volume)" class="vgo-u-icon-md" />
        </span>
        <span class="sidebar-list__content">
          <span class="sidebar-list__title vgo-u-text-overflow">{{ volume.label }}</span>
          <span v-if="volume.access === 'prompt'" class="mounted-list__hint vgo-u-text-overflow">Remount</span>
          <span v-else-if="volume.access === 'denied'" class="mounted-list__hint vgo-u-text-overflow">Access denied</span>
        </span>
        <span v-if="grantingIds.has(volume.id)" class="mounted-list__busy">
          <i-mdi-loading class="vgo-u-icon-sm" />
        </span>
        <button
          v-else
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm mounted-list__remove"
          :title="`Unmount ${volume.label}`"
          @click="unmount(volume, $event)"
        >
          <i-mdi-eject class="vgo-u-icon-sm" />
        </button>
      </div>

      <div v-if="showEmptyState" class="mounted-list__empty vgo-u-text-overflow">
        No folder mounted
      </div>
    </div>

    <div class="sidebar-list drive-list">
      <div class="sidebar-list__header">
        <span>Storage</span>
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
          title="Reload drives"
          :disabled="isLoading"
          @click="loadDrives"
        >
          <i-mdi-reload class="vgo-u-icon-sm" />
        </button>
      </div>
      <button
        v-for="(item, index) in driveList"
        :key="index"
        class="vgo-u-button-reset vgo-list-item sidebar-list__item"
        :title="getTitle(item)"
        :class="{ 'is-active': item.path === currentPath, 'is-drop-target': dragOverPath === item.path }"
        @click="openDrive(item)"
        @contextmenu.prevent.stop="showDriveMenu(item, $event)"
        @dragover="onDriveDragOver(item, $event)"
        @dragleave="onDriveDragLeave(item, $event)"
        @drop="onDriveDrop(item, $event)"
      >
        <span class="sidebar-list__icon">
          <MdiIcon :name="getIcon(item)" class="vgo-u-icon-md" />
        </span>
        <span class="sidebar-list__content">
          <span class="sidebar-list__title vgo-u-text-overflow">{{ item.label }}</span>
          <span v-if="item.total && item.free" class="vgo-progress">
            <span
              :style="{ width: `${((item.total - item.free) / item.total) * 100}%` }"
              class="vgo-progress__value"
            />
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.explorer-sidebar {
  height: 100%;
  position: relative;
  display: flex;
  gap: var(--vgo-space-2);
  flex-direction: column;
  background-color: var(--vgo-surface-raised);

  // 两段列表（Storage / Mounted Folders）共用：同一层视觉，只有动作按钮不同
  .sidebar-list {
    overflow: auto;

    &__header {
      position: sticky;
      top: 0;
      z-index: var(--vgo-z-sticky);
      display: flex;
      gap: var(--vgo-space-2);
      align-items: center;
      justify-content: space-between;
      padding-left: var(--vgo-space-2);
      font-size: var(--vgo-font-sm);
      color: var(--vgo-text-secondary);
      // 吸顶时要盖住下面滚过去的磁盘项
      background-color: var(--vgo-surface-raised);
    }

    &__item {
      position: relative;
      width: 100%;
      min-height: var(--vgo-control-md);
      padding-inline: var(--vgo-space-2);
      font-size: var(--vgo-font-sm);

      // 高亮只留底色，去掉 vgo-list-item.is-active 的 1px outline，和收藏项保持一致；
      // 写在 is-drop-target 之前，拖拽落点的虚线仍能盖过它
      &.is-active {
        outline: none;
      }

      &.is-drop-target {
        background-color: var(--vgo-primary-opacity);
        outline: 2px dashed var(--vgo-primary);
        outline-offset: -2px;
      }
    }

    &__icon {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      width: var(--vgo-icon-md);
      height: var(--vgo-icon-md);

      img {
        width: 100%;
        height: 100%;
      }
    }

    &__content {
      flex: 1;
      overflow: hidden;
    }

    &__title {
      display: block;
      line-height: 1.4;
      text-align: initial;
    }
  }

  .drive-list {
  }

  .mounted-list {

    &__actions {
      display: flex;
      gap: var(--vgo-space-1);
      align-items: center;
    }

    &__item {
      // 右侧的取消挂载要伸到内边距之外，所以这里放宽右边距，让它压住行尾
      padding-right: var(--vgo-space-1);
    }

    // 未授权的卷仍然是可点位置，只是整体压低一档，和可用的卷区分开
    &__item.is-locked .sidebar-list__title {
      color: var(--vgo-text-secondary);
    }

    &__hint {
      display: block;
      font-size: var(--vgo-font-sm);
      line-height: 1.3;
      color: var(--vgo-text-secondary);
      text-align: initial;
    }

    &__remove {
      flex-shrink: 0;
      // 默认不占视觉重量，悬停到该项上才出现
      opacity: 0;
      transition: opacity var(--vgo-duration-fast);
    }

    &__item:hover &__remove,
    &__remove:focus-visible {
      opacity: 1;
    }

    &__busy {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      width: var(--vgo-icon-md);
      color: var(--vgo-text-secondary);

      svg {
        animation: mounted-list-spin var(--vgo-duration-base) linear infinite;
      }
    }

    &__empty {
      padding: var(--vgo-space-2);
      font-size: var(--vgo-font-sm);
      color: var(--vgo-text-secondary);
    }
  }
}

@keyframes mounted-list-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
