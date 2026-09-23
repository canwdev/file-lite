<script lang="ts" setup>
import { listPlugins } from '@/api/plugins'
import { SHELL_SHORTCUT_SCOPE, useShortcut } from '@/hooks/use-shortcut'
import { localSettingsStore, settingsStore } from '@/store'
import { useFileLiteMenu } from '@/views/Apps/use-file-lite-menu.ts'
import ExplorerTabBar from '@/views/FileManager/ExplorerTabBar.vue'
import { transferQueue } from '@/views/FileManager/ExplorerUI/transfer-queue-registry'
import FileManager from '@/views/FileManager/FileManager.vue'
import TransferQueue from '@/views/FileManager/TransferQueue.vue'
import AppsEntry from './Apps/AppsEntry.vue'

const { showMenu } = useFileLiteMenu()

onMounted(() => {
  void listPlugins().catch(() => [])
})

const pageTitle = computed(() => settingsStore.value.pageTitle.trim())
const sidebarVisible = computed(() => localSettingsStore.value.sidebarVisible)

function toggleSidebar() {
  localSettingsStore.value.sidebarVisible = !localSettingsStore.value.sidebarVisible
}

useShortcut({
  scope: SHELL_SHORTCUT_SCOPE,
  combo: ['ctrl+`', 'meta+`'],
  description: 'Show / hide navigation',
  handler: toggleSidebar,
})

useShortcut({
  scope: SHELL_SHORTCUT_SCOPE,
  combo: 'alt+m',
  description: 'Open global menu',
  handler: () => {
    void showMenu()
  },
})

// 传输面板全局唯一，注册表里的 ref 在它挂载前是 null，所以取值都走 computed
const transferVisible = computed(() => transferQueue.value?.isVisible.value === true)
const transferTotal = computed(() => transferQueue.value?.totalCount.value ?? 0)
const transferActive = computed(() => transferQueue.value?.activeCount.value ?? 0)
const transferFailed = computed(() => transferQueue.value?.failedCount.value ?? 0)

function toggleTransferPanel() {
  transferQueue.value?.toggle()
}
</script>

<template>
  <FileManager :sidebar-visible="sidebarVisible" tabs-mode>
    <template #topBar>
      <!-- 顶栏：左侧是标签栏，右侧是传输面板入口、页面标题与全局菜单 -->
      <div class="explorer-top-bar vgo-panel vgo-panel--flat">
        <div class="explorer-top-bar__left">
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            :title="sidebarVisible ? 'Hide navigation' : 'Show navigation'"
            @click="toggleSidebar"
          >
            <i-mdi-menu-close v-if="!sidebarVisible" />
            <i-mdi-menu-open v-else />
          </button>
          <ExplorerTabBar />
        </div>
        <div class="explorer-top-bar__right">
          <button
            v-if="transferTotal || transferVisible"
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md explorer-top-bar__transfers"
            :class="{ 'is-active': transferVisible }"
            :title="transferVisible ? 'Hide transfers & tasks' : 'Show transfers & tasks'"
            @click="toggleTransferPanel"
          >
            <i-mdi-cloud-sync v-if="transferActive" />
            <i-mdi-cloud-check-outline v-else />
            <span v-if="transferFailed" class="vgo-badge vgo-badge--danger">{{ transferFailed }}</span>
            <span v-else-if="transferActive" class="vgo-badge vgo-badge--primary">{{ transferActive }}</span>
          </button>
          <span v-if="pageTitle" class="vgo-badge vgo-badge--primary explorer-top-bar__title">
            <span class="vgo-u-text-overflow">{{ pageTitle }}</span>
          </span>
          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--md"
            data-file-lite-menu
            title="Menu"
            @click="showMenu"
          >
            <i-mdi-menu />
          </button>
        </div>
      </div>
    </template>
  </FileManager>
  <!-- 全局唯一一份：面板 Teleport 到 body，放在顶栏只是为了有个稳定的挂载点 -->
  <TransferQueue auto-close />
  <AppsEntry />
</template>

<style lang="scss" scoped>
// Firefox-style strip: slightly darker than the floating active tab / toolbar below.
.explorer-top-bar {
  --explorer-tab-strip: color-mix(in srgb, var(--vgo-window) 95%, var(--vgo-text));

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-1);
  padding: var(--vgo-space-1);
  // 与 explorer-header 等高：两者都是 control-md 控件 + space-1 内边距
  min-height: var(--explorer-top-bar-height);
  border-bottom: 1px solid var(--vgo-border);
  // keep this comment: background-color: color-mix(in srgb, var(--vgo-primary) 10%, transparent);
  background-color: var(--explorer-tab-strip);

  // :global() replaces the whole selector, so a :global(html.dark) & rule
  // lands on <html> and loses to the variable declared on this element.
  html.dark & {
    --explorer-tab-strip: var(--vgo-surface);
  }

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

  &__title {
    flex-shrink: 1;
    min-width: 0;
    padding: var(--vgo-space-1) var(--vgo-space-2);
  }

  // 图标 + 计数角标并排，不是单图标按钮：--icon 的定宽会把图标挤小
  &__transfers {
    width: auto;

    :deep(svg) {
      flex: 0 0 auto;
    }
  }
}
</style>
