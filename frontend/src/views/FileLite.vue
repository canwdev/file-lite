<script lang="ts" setup>
import { localSettingsStore, settingsStore } from '@/store'
import { useFileLiteMenu } from '@/views/Apps/use-file-lite-menu.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

const { showMenu } = useFileLiteMenu()

const pageTitle = computed(() => settingsStore.value.pageTitle.trim())
const sidebarVisible = computed(() => localSettingsStore.value.sidebarVisible)

function toggleSidebar() {
  localSettingsStore.value.sidebarVisible = !localSettingsStore.value.sidebarVisible
}
</script>

<template>
  <FileManager :sidebar-visible="sidebarVisible">
    <template #topBar>
      <!-- 顶栏：左侧是多标签页预留区，右侧是页面标题与全局菜单 -->
      <div class="explorer-top-bar vgo-panel vgo-panel--flat">
        <div class="explorer-top-bar__left">
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :title="sidebarVisible ? 'Hide navigation' : 'Show navigation'"
            @click="toggleSidebar"
          >
            <i-mdi-menu-open />
          </button>
          <div class="explorer-top-bar__tabs" />
        </div>
        <div class="explorer-top-bar__right">
          <span v-if="pageTitle" class="vgo-badge vgo-badge--primary explorer-top-bar__title">
            <span class="vgo-u-text-overflow">{{ pageTitle }}</span>
          </span>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            title="Menu"
            @click="showMenu"
          >
            <i-mdi-menu />
          </button>
        </div>
      </div>
    </template>
  </FileManager>
  <AppsEntry />
</template>

<style lang="scss" scoped>
// 背景与高度对齐 FileManager 的 explorer-header：同一个 flat 面板 + 同样的内边距
.explorer-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-1);
  padding: var(--vgo-space-1);
  border-bottom: 1px solid var(--vgo-border);

  &__left,
  &__right {
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    min-width: 0;
  }

  &__left {
    flex: 1;
  }

  // 多标签页 UI 的位置，暂时只占位
  &__tabs {
    flex: 1;
    min-width: 0;
  }

  &__title {
    flex-shrink: 1;
    min-width: 0;
  }
}
</style>
