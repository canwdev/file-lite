<script setup lang="ts">
import type { AppParams } from './apps'
import type { AppWindowState } from './apps-store'
import { WindowDock, WindowStack } from '@canwdev/vgo-ui'
import ShortcutScopeProvider from '@/components/ShortcutScopeProvider.vue'
import { baseContextMenuOptions } from '@/utils/context-menu'
import explorerBus, { ExplorerEvents } from '@/views/FileManager/utils/bus'
import AppEscToClose from './AppEscToClose.vue'
import { appMetaByName, Apps } from './apps'
import { appWindows, defaultAppTitle } from './apps-store'
import PluginHost from './PluginHost.vue'
import PluginIcon from './PluginIcon.vue'

function appMeta(win: AppWindowState) {
  return win.data.appName ? appMetaByName[win.data.appName] : undefined
}

const DEFAULT_WINDOW_SIZE = {
  width: 'min(960px, 90vw)',
  height: 'min(720px, 85vh)',
}

const WINDOW_STYLE = {
  minWidth: '320px',
  minHeight: '200px',
  outline: 'none',
}

function initWinOptions(win: AppWindowState) {
  const chrome = appMeta(win)?.chrome
  return {
    width: chrome?.width ?? DEFAULT_WINDOW_SIZE.width,
    height: chrome?.height ?? DEFAULT_WINDOW_SIZE.height,
  }
}

// 所有 App 窗口都从视口中间弹出（ViewPortWindow 的 initCenter 默认就是 true）
function windowProps(win: AppWindowState) {
  return {
    class: 'app-window',
    style: WINDOW_STYLE,
    initWinOptions: initWinOptions(win),
  }
}

function contentAttrs(win: AppWindowState) {
  return { 'data-shortcut-scope': `app:${win.id}` }
}

function setTitle(win: AppWindowState, title: string) {
  win.title = title || defaultAppTitle(win.data)
}

/** Apps with unsaved state expose `confirmDismiss`; every close path asks it first. */
function bindAppInstance(win: AppWindowState, el: unknown) {
  const confirmDismiss = (el as { confirmDismiss?: () => Promise<boolean> | boolean } | null)?.confirmDismiss
  appWindows.setCloseGuard(win.id, typeof confirmDismiss === 'function' ? confirmDismiss : null)
}

function restoreOrMinimizeWindow(win: AppWindowState) {
  if (win.maximized) {
    win.maximized = false
  }
}

function handleSelectItems(win: AppWindowState, names: string[]) {
  explorerBus.emit(ExplorerEvents.SELECT_COLLECTED, {
    basePath: win.data.appParams.basePath,
    names,
  })
  restoreOrMinimizeWindow(win)
}

function handleLocateItem(win: AppWindowState, name: string) {
  explorerBus.emit(ExplorerEvents.REVEAL_ITEM, {
    basePath: win.data.appParams.basePath,
    name,
  })
  restoreOrMinimizeWindow(win)
}
</script>

<template>
  <WindowStack :manager="appWindows" :window-props="windowProps" :content-attrs="contentAttrs">
    <template #title="{ win }">
      <PluginIcon
        v-if="win.data.plugin"
        :plugin="win.data.plugin"
        class="title-icon"
        @click.stop
        @dblclick.stop="appWindows.requestClose(win.id)"
      />
      <MdiIcon
        v-else
        :name="appMeta(win)?.icon"
        class="title-icon"
        @click.stop
        @dblclick.stop="appWindows.requestClose(win.id)"
      />
      <span class="title-text">{{ win.title }}</span>
    </template>

    <template #default="{ win, close }">
      <ShortcutScopeProvider :scope="`app:${win.id}`">
        <PluginHost
          v-if="win.data.plugin"
          :plugin="win.data.plugin"
          :app-params="win.data.appParams"
          @exit="close"
          @set-title="(val: string) => setTitle(win, val)"
        />
        <component
          :is="Apps[win.data.appName]"
          v-else-if="win.data.appName"
          :ref="(el: unknown) => bindAppInstance(win, el)"
          :app-params="win.data.appParams"
          @exit="close"
          @set-title="(val: string) => setTitle(win, val)"
          @select-items="(names: string[]) => handleSelectItems(win, names)"
          @locate-item="(name: string) => handleLocateItem(win, name)"
          @update-app-params="(params: AppParams) => { win.data.appParams = params }"
        />
        <AppEscToClose :scope="`app:${win.id}`" @close="close" />
      </ShortcutScopeProvider>
    </template>
  </WindowStack>

  <WindowDock
    :manager="appWindows"
    class="app-dock"
    :aria-label="$t('file_lite_i18n.open_apps')"
    :menu-options="baseContextMenuOptions"
  >
    <template #icon="{ win }">
      <span class="dock-icon-wrap vgo-panel">
        <PluginIcon v-if="win.data.plugin" :plugin="win.data.plugin" />
        <MdiIcon v-else :name="appMeta(win)?.icon" />
      </span>
    </template>
  </WindowDock>
</template>

<style lang="scss" scoped>
.title-text {
  word-break: break-word;
  font-size: var(--vgo-font-sm);
}

.title-icon {
  flex-shrink: 0;
  font-size: var(--vgo-icon-md);
}

.dock-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--vgo-control-md);
  height: var(--vgo-control-md);
}

.app-dock {
  position: fixed;
  bottom: var(--vgo-space-1);
  left: var(--vgo-space-1);
  z-index: var(--vgo-z-sticky);
  gap: 2px;

  :deep(.vgo-window-dock__item) {
    position: relative;
    gap: 2px;
    padding: 2px var(--vgo-space-1) 3px;
    border-radius: var(--vgo-radius);
    transition: background-color var(--vgo-duration-fast) ease;

    &:hover {
      background-color: var(--vgo-hover);
    }

    &:active {
      background-color: var(--vgo-primary-opacity);
    }
  }

  :deep(.vgo-window-dock__icon) {
    font-size: var(--vgo-icon-lg);
    line-height: 1;
    color: var(--vgo-primary);
  }

  :deep(.vgo-window-dock__indicator) {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background-color: var(--vgo-text-secondary);
    transition: opacity var(--vgo-duration-fast) ease;
  }

  :deep(.vgo-window-dock__item.is-active .vgo-window-dock__indicator) {
    background-color: var(--vgo-primary);
  }

  :deep(.vgo-window-dock__item.is-minimized .vgo-window-dock__icon) {
    opacity: 0.55;
  }

  :deep(.vgo-window-dock__item.is-minimized .vgo-window-dock__indicator) {
    opacity: 0.35;
  }

  :deep(.vgo-window-dock__item.is-drag-source) {
    opacity: 0.5;
  }

  :deep(.vgo-window-dock__item.is-drop-before::after),
  :deep(.vgo-window-dock__item.is-drop-after::after) {
    content: '';
    position: absolute;
    top: var(--vgo-space-1);
    bottom: var(--vgo-space-1);
    width: 2px;
    background-color: var(--vgo-primary);
    pointer-events: none;
  }

  :deep(.vgo-window-dock__item.is-drop-before::after) {
    left: -2px;
  }

  :deep(.vgo-window-dock__item.is-drop-after::after) {
    right: -2px;
  }
}
</style>
