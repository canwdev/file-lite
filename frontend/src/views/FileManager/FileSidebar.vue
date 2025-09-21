<script setup lang="ts">
import {fsWebApi} from '@/api/filesystem'
import {IDrive} from '@server/types/server'
import {useStorage} from '@vueuse/core'
import {LsKeys} from '@/enum'
import {normalizePath} from '@/views/FileManager/utils'
import {bytesToSize} from '@/utils'

interface Props {
  width?: string
  currentPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: '130px',
})

const {currentPath} = toRefs(props)

const emit = defineEmits(['openDrive'])

const isLoading = ref(false)
const driveList = ref<IDrive[]>([])

const getPathNormalized = (path: string) => {
  path = normalizePath(path)
  if (!/\/$/gi.test(path)) {
    path += '/'
  }
  return path
}

const loadDrives = async () => {
  try {
    isLoading.value = true

    const drives = (await fsWebApi.getDrives()) as unknown as IDrive[]
    driveList.value = drives.map((i) => {
      return {
        ...i,
        path: getPathNormalized(i.path),
      }
    })
  } catch (e) {
    console.error(e)
    driveList.value = []
  } finally {
    isLoading.value = false
  }
}
onMounted(() => {
  loadDrives()
})

const openFirstDrive = () => {
  if (driveList.value[0]) {
    emit('openDrive', driveList.value[0])
  }
}

const getIcon = (item: IDrive) => {
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

const showSidebar = useStorage(LsKeys.EXPLORER_SHOW_SIDEBAR, true, localStorage, {
  listenToStorageChanges: false,
})

const openDrive = (item: IDrive) => {
  if (item.path !== currentPath.value) {
    emit('openDrive', item)
  }
}

const getTitle = (item: IDrive) => {
  let txt = `Path: ${item.path}`

  if (item.total && item.free) {
    const used = item.total - item.free
    txt += `
Used: ${bytesToSize(used)}/${bytesToSize(item.total)} (${((used / item.total) * 100).toFixed(0) + '%'})
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
  <div class="explorer-file-sidebar" :style="{width: showSidebar ? width : '0'}">
    <button
      class="btn-toggle btn-no-style"
      :class="{_folded: !showSidebar}"
      @click="showSidebar = !showSidebar"
    >
      <span v-if="!showSidebar" class="mdi mdi-chevron-right"></span>
      <span v-else class="mdi mdi-chevron-left"></span>
    </button>

    <slot></slot>

    <div class="file-sidebar-content">
      <div class="file-sidebar-content-top">
        <span>Storage</span>
        <button
          class="btn-no-style mdi mdi-reload"
          :disabled="isLoading"
          @click="loadDrives"
        ></button>
      </div>
      <button
        class="drive-item btn-no-style"
        v-for="(item, index) in driveList"
        :key="index"
        :title="getTitle(item)"
        :class="{active: item.path === currentPath}"
        @click="openDrive(item)"
      >
        <span class="drive-icon">
          <span :class="['mdi', getIcon(item)]" />
        </span>
        <span class="drive-content">
          <span class="drive-title text-overflow">{{ item.label }}</span>
          <span v-if="item.total && item.free" class="volume-bar">
            <span
              :style="{width: ((item.total - item.free) / item.total) * 100 + '%'}"
              class="volume-value"
            ></span>
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.explorer-file-sidebar {
  //width: 180px;
  height: 100%;
  border-right: 1px solid var(--vgo-color-border);
  position: relative;
  display: flex;
  gap: 8px;
  flex-direction: column;

  .btn-toggle {
    position: absolute;
    right: 0px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0.3;
    transition: all 1s;
    z-index: 10;

    &._folded {
      right: -20px;
    }

    &:hover {
      opacity: 1;
    }

    span {
    }
  }

  .file-sidebar-content {
    flex: 1;
    overflow: auto;

    .file-sidebar-content-top {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px;
      font-size: 12px;
      opacity: 0.5;
    }
  }

  .drive-item {
    display: flex;
    width: 100%;
    text-align: unset;
    cursor: pointer;
    padding: 4px 6px;
    box-sizing: border-box;
    gap: 6px;
    align-items: center;

    &.active {
      background-color: var(--vgo-primary-opacity) !important;
    }

    &:focus {
      outline: 1px solid var(--vgo-primary);
      outline-offset: -1px;
    }

    .drive-icon {
      width: 20px;
      height: 20px;
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;

      .mdi {
        font-size: 20px;
      }

      i {
        display: flex;
      }

      img {
        width: 100%;
        height: 100%;
      }
    }

    .drive-content {
      flex: 1;
      overflow: hidden;
    }

    &:hover {
      background-color: var(--vgo-color-hover);
    }

    & + .drive-item {
      border-top: 1px solid var(--vgo-color-border);
    }

    .drive-title {
      font-size: 12px;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .volume-bar {
      overflow: hidden;
      height: 2px;
      width: 100%;
      position: relative;
      background-color: var(--vgo-color-border);
      display: flex;

      .volume-value {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 0%;
        background-color: var(--vgo-primary);
        transition: all 0.3s;
      }
    }
  }
}
</style>
