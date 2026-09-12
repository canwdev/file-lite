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
  if (item.label.toLowerCase() === 'home') {
    return 'mdi-home-account'
  }
  if (item.label.toLowerCase() === 'data') {
    return 'mdi-folder-pound-outline'
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
  <div class="explorer-file-sidebar">
    <slot />

    <div class="file-sidebar-content">
      <div class="file-sidebar-content-top">
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
        class="vgo-u-button-reset vgo-list-item drive-item"
        :title="getTitle(item)"
        :class="{ 'is-active': item.path === currentPath, 'is-drop-target': dragOverPath === item.path }"
        @click="openDrive(item)"
        @contextmenu.prevent.stop="showDriveMenu(item, $event)"
        @dragover="onDriveDragOver(item, $event)"
        @dragleave="onDriveDragLeave(item, $event)"
        @drop="onDriveDrop(item, $event)"
      >
        <span class="drive-icon">
          <MdiIcon :name="getIcon(item)" class="vgo-u-icon-md" />
        </span>
        <span class="drive-content">
          <span class="drive-title vgo-u-text-overflow">{{ item.label }}</span>
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
.explorer-file-sidebar {
  height: 100%;
  position: relative;
  display: flex;
  gap: var(--vgo-space-2);
  flex-direction: column;

  .file-sidebar-content {
    flex: 1;
    overflow: auto;

    .file-sidebar-content-top {
      display: flex;
      gap: var(--vgo-space-2);
      align-items: center;
      justify-content: space-between;
      padding-left: var(--vgo-space-2);
      font-size: var(--vgo-font-sm);
      color: var(--vgo-text-secondary);
    }
  }

  .drive-item {
    width: 100%;
    min-height: var(--vgo-control-md);
    padding-inline: var(--vgo-space-2);
    font-size: var(--vgo-font-sm);

    &.is-drop-target {
      background-color: var(--vgo-primary-opacity);
      outline: 2px dashed var(--vgo-primary);
      outline-offset: -2px;
    }

    .drive-icon {
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

    .drive-content {
      flex: 1;
      overflow: hidden;
    }

    .drive-title {
      display: block;
      line-height: 1.4;
      text-align: initial;
    }
  }
}
</style>
