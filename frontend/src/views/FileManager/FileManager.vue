<script setup lang="ts">
import type { IEntry } from '@server/types/server'
import type { OpenWithEnum } from '../Apps/apps'
import { fsWebApi } from '@/api/filesystem'
import FileList from './ExplorerUI/FileList.vue'
import { useNavigation } from './ExplorerUI/hooks/use-navigation'
import FileSidebar from './FileSidebar.vue'
import { getLastDirName } from './utils'

const props = withDefaults(
  defineProps<{
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    // 只展示内容
    contentOnly?: boolean
  }>(),
  {
    multiple: false,
    contentOnly: false,
  },
)
const emit = defineEmits(['handleSelect', 'cancelSelect'])
const { selectFileMode, multiple } = toRefs(props)

const {
  isLoading,
  filteredFiles,
  handleOpen,
  handleRefresh,
  basePathNormalized,
  starList,
  handleOpenPath,
  backHistory,
  goBack,
  forwardHistory,
  goForward,
  allowUp,
  goUp,
  basePath,
  toggleStar,
  isStared,
  filterText,
} = useNavigation({
  getListFn: async () => {
    const res = await fsWebApi.getList({
      path: basePath.value,
    })
    // console.log(res)

    return res as unknown as IEntry[]
  },
})

const fileSidebarRef = ref()
onMounted(async () => {
  if (fileSidebarRef.value) {
    await fileSidebarRef.value.loadDrives()
    if (basePath.value) {
      handleRefresh()
    }
    else {
      fileSidebarRef.value.openFirstDrive()
    }
  }
})

function handleFileListOpen({ item, openWith }: { item: IEntry, openWith?: OpenWithEnum }) {
  if (selectFileMode.value === 'file' && !item.isDirectory) {
    emit('handleSelect', { items: [item], item, basePath: fileListRef.value.basePath })
    return
  }
  return handleOpen({
    item,
    openWith,
  })
}

const fileListRef = ref()
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
    handleOpen({ item: items[0] })
    return
  }
  if (selectFileMode.value === 'folder') {
    emit('handleSelect', { basePath: fileListRef.value.basePath })
  }
  if (!items.length) {
    return
  }
  if (selectFileMode.value === 'file') {
    items = items.filter(i => !i.isDirectory)
    if (!items.length) {
      return
    }
    emit('handleSelect', { items, item: items[0], basePath: fileListRef.value.basePath })
  }
}

const rootRef = ref()
const inputAddrRef = ref()
const searchInputRef = ref()
function handleShortcutKey(event) {
  // console.log('handleShortcutKey', event)
  const key = event.key?.toLowerCase()
  if (event.altKey) {
    if (key === 'a') {
      if (inputAddrRef.value) {
        inputAddrRef.value.focus()
      }
    }
    else if (key === 's') {
      if (searchInputRef.value) {
        searchInputRef.value.focus()
      }
    }
    else if (key === 'd') {
      toggleStar()
    }
    else if (event.key === 'ArrowUp') {
      goUp()
    }
    else if (event.key === 'ArrowLeft') {
      goBack()
    }
    else if (event.key === 'ArrowRight') {
      goForward()
    }
  }
  fileListRef.value.handleShortcutKey(event)
}
</script>

<template>
  <div ref="rootRef" class="explorer-wrap" tabindex="0" @keydown="handleShortcutKey">
    <div v-if="!contentOnly" class="explorer-header vgo-panel">
      <div class="nav-address-bar">
        <div class="nav-wrap">
          <button
            :disabled="backHistory.length <= 1"
            class="btn-action btn-no-style"
            title="Back (alt+left)"
            @click="goBack"
          >
            <span class="mdi mdi-arrow-left" />
          </button>
          <button
            :disabled="forwardHistory.length <= 0"
            class="btn-action btn-no-style"
            title="Forward (alt+right)"
            @click="goForward"
          >
            <span class="mdi mdi-arrow-right" />
          </button>
          <button
            class="btn-action btn-no-style"
            :disabled="!allowUp"
            title="Up (alt+up)"
            @click="goUp"
          >
            <span class="mdi mdi-arrow-up" />
          </button>
          <button class="btn-no-style btn-action" title="Refresh (ctrl+r)" @click="handleRefresh">
            <span class="mdi mdi-refresh" />
          </button>
        </div>
        <div class="input-wrap" @keydown.stop>
          <input
            ref="inputAddrRef"
            v-model="basePath"
            placeholder="Path"
            class="input-addr vgo-input"
            title="Address bar (alt+a)"
            @keyup.enter="handleRefresh"
            @change="handleRefresh"
          >
          <button class="btn-no-style btn-action" title="Toggle Star (alt+s)" @click="toggleStar">
            <template v-if="isStared">
              <span class="mdi mdi-star" />
            </template>
            <template v-else>
              <span class="mdi mdi-star-outline" />
            </template>
          </button>

          <input
            ref="searchInputRef"
            v-model="filterText"
            placeholder="Filter name"
            class="input-filter vgo-input"
            title="Filter bar (alt+f)"
            @keyup.esc="filterText = ''"
          >

          <slot name="headerRight" />
        </div>
      </div>
    </div>
    <div class="explorer-content-wrap scrollbar-mini">
      <el-splitter lazy>
        <el-splitter-panel size="130px" collapsible>
          <FileSidebar
            v-if="!contentOnly"
            ref="fileSidebarRef"
            :current-path="basePath"
            @open-drive="(i) => handleOpenPath(i.path)"
          >
            <div v-if="starList.length" class="file-sidebar-content star-list">
              <div v-for="(path,) in starList" :key="path">
                <button class="drive-item btn-no-style" :title="path" @click="handleOpenPath(path)">
                  <span class="drive-icon">
                    <span class="mdi mdi-star" />
                  </span>
                  <span class="drive-content">
                    <span class="drive-title text-overflow"> {{ getLastDirName(path) }}</span>
                  </span>
                </button>
              </div>
            </div>
          </FileSidebar>
        </el-splitter-panel>
        <el-splitter-panel>
          <FileList
            ref="fileListRef"
            v-model:is-loading="isLoading"
            :files="filteredFiles"
            :base-path="basePathNormalized"
            :select-file-mode="selectFileMode"
            :multiple="multiple"
            :content-only="contentOnly"
            @open="handleFileListOpen"
            @refresh="handleRefresh"
          />
        </el-splitter-panel>
      </el-splitter>
    </div>

    <!-- 文件选择器 -->
    <div v-if="selectFileMode && fileListRef" class="vgo-bg explorer-bottom-wrap">
      <button class="vgo-button primary" @click="handleSelect">
        {{ selectFileMode === 'file' || isSelectAFolder ? 'Open' : 'Select Folder' }}
      </button>
      <button class="vgo-button" @click="$emit('cancelSelect')">
        Cancel
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.explorer-wrap {
  min-width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  outline: none;

  .vgo-button {
    line-height: 1;
    min-width: 25px;
    min-height: 25px;
    align-items: center;
    justify-content: center;
  }

  .explorer-header {
    &.vgo-panel {
      padding: 4px;
      border: none;
      border-bottom: 1px solid var(--vgo-color-border);
      box-shadow: none;
      border-radius: 0;
    }

    .nav-address-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;

      @media screen and (max-width: $mq_mobile_width) {
        flex-direction: column-reverse;
        align-items: center;
      }

      .btn-action {
        padding: 4px;
        display: flex;
      }

      .nav-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .input-wrap {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        flex: 1;
        gap: 4px;
        font-size: 14px;

        @media screen and (max-width: $mq_mobile_width) {
          width: 100%;
        }

        .input-addr {
          flex: 1;
          line-height: 1;
          padding: 4px 8px;
        }

        .input-filter {
          width: 200px;
          line-height: 1;
          padding: 4px 8px;

          @media screen and (max-width: $mq_mobile_width) {
            width: 100px;
          }
        }
      }
    }
  }

  .star-list {
    height: auto;
    flex: unset;
  }

  .explorer-content-wrap {
    flex: 1;
    overflow: auto;
    display: flex;
  }

  .btn-action {
    display: flex;
    cursor: pointer;
    font-size: 18px;
    border-radius: 4px;
    height: 29px;
    width: 29px;
    align-items: center;
    justify-content: center;

    &:disabled {
      cursor: not-allowed;
    }

    &:hover,
    &:focus {
      background-color: var(--vgo-primary-opacity);
    }
  }

  .explorer-bottom-wrap {
    padding: 8px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}
</style>
