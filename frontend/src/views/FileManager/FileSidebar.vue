<script setup lang="ts">
import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IDrive } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { fsWebApi } from '@/api/filesystem'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { bytesToSize } from '@/utils'
import { normalizePath } from '@/views/FileManager/utils'

interface Props {
  currentPath?: string
}

const props = withDefaults(defineProps<Props>(), {
})

const emit = defineEmits(['openDrive', 'openPathInNewTab'])

const { currentPath } = toRefs(props)

const isLoading = ref(false)
const driveList = ref<IDrive[]>([])

function getPathNormalized(path: string) {
  path = normalizePath(path)
  if (!/\/$/.test(path)) {
    path += '/'
  }
  return path
}

async function loadDrives() {
  try {
    isLoading.value = true
    const drives = (await fsWebApi.getDrives())
    driveList.value = drives.map((i) => {
      return {
        ...i,
        path: getPathNormalized(i.path),
      }
    })
  }
  catch (e) {
    console.error(e)
    driveList.value = []
  }
  finally {
    isLoading.value = false
  }
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
    items,
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
          <span class="mdi mdi-reload vgo-u-icon-sm" />
        </button>
      </div>
      <button
        v-for="(item, index) in driveList"
        :key="index"
        class="vgo-u-button-reset vgo-list-item drive-item"
        :title="getTitle(item)"
        :class="{ 'is-active': item.path === currentPath }"
        @click="openDrive(item)"
        @contextmenu.prevent.stop="showDriveMenu(item, $event)"
      >
        <span class="drive-icon">
          <span class="mdi vgo-u-icon-md" :class="[getIcon(item)]" />
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
