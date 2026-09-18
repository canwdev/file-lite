<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IDrive } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { bytesToSize } from '@/utils'
import { resolveMenuIcons } from '@/utils/icons'
import { driveList, drivesLoading, loadDrives as refreshDrives } from './ExplorerUI/drives'
import { acceptDirDrag, dropIntoDir, useDragEnabled } from './ExplorerUI/entry-drag'

interface Props {
  currentPath?: string
}

const props = withDefaults(defineProps<Props>(), {
})

const emit = defineEmits(['openDrive', 'openPathInNewTab'])

const { currentPath } = toRefs(props)

const isLoading = drivesLoading

/** 驱动器列表由 drives.ts 共享缓存：拖拽判定「是否同一个卷」也要用它 */
async function loadDrives() {
  await refreshDrives(true)
}

// onMounted(() => {
//   loadDrives()
// })

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
  openFirstDrive,
})
</script>

<template>
  <div class="explorer-sidebar">
    <slot />

    <div class="drive-list">
      <div class="drive-list__header">
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
        class="vgo-u-button-reset vgo-list-item drive-list__item"
        :title="getTitle(item)"
        :class="{ 'is-active': item.path === currentPath, 'is-drop-target': dragOverPath === item.path }"
        @click="openDrive(item)"
        @contextmenu.prevent.stop="showDriveMenu(item, $event)"
        @dragover="onDriveDragOver(item, $event)"
        @dragleave="onDriveDragLeave(item, $event)"
        @drop="onDriveDrop(item, $event)"
      >
        <span class="drive-list__icon">
          <MdiIcon :name="getIcon(item)" class="vgo-u-icon-md" />
        </span>
        <span class="drive-list__content">
          <span class="drive-list__title vgo-u-text-overflow">{{ item.label }}</span>
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

  .drive-list {
    flex: 1;
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
}
</style>
