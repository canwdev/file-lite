<script setup lang="ts">
import type { AppParams } from './apps'
import type { AppWindowState } from './apps-store'
import { ViewPortWindow } from '@canwdev/vgo-ui'
import ShortcutScopeProvider from '@/components/ShortcutScopeProvider.vue'
import explorerBus, { ExplorerEvents } from '@/views/FileManager/utils/bus'
import AppEscToClose from './AppEscToClose.vue'
import { appMetaByName, Apps } from './apps'
import {
  appsStoreState,
  closeAppWindow,
  consumeReturnFocus,
  setAppWindowActive,
  syncAppWindowRefs,
} from './apps-store'
import PluginHost from './PluginHost.vue'
import PluginIcon from './PluginIcon.vue'

const vpWindowRefs = ref<unknown[]>([])
const appContainerRefs = new Map<string, HTMLElement | null>()
const appInstances = new Map<string, { confirmDismiss?: () => Promise<boolean> | boolean }>()
const closeInFlight = new Set<string>()

watch(
  () => appsStoreState.windows.map(w => w.id),
  async () => {
    await nextTick()
    syncAppWindowRefs((vpWindowRefs.value ?? []) as unknown[])
  },
  { flush: 'post' },
)

function appMeta(win: AppWindowState) {
  return win.appName ? appMetaByName[win.appName] : undefined
}

const DEFAULT_WINDOW_SIZE = {
  width: 'min(960px, 90vw)',
  height: 'min(720px, 85vh)',
}

function initCenter(win: AppWindowState) {
  return !appMeta(win)?.chrome?.cascade
}

function initWinOptions(win: AppWindowState) {
  const chrome = appMeta(win)?.chrome
  const options = {
    width: chrome?.width ?? DEFAULT_WINDOW_SIZE.width,
    height: chrome?.height ?? DEFAULT_WINDOW_SIZE.height,
  }
  if (!chrome?.cascade) {
    return options
  }
  const slot = appsStoreState.windows
    .filter(item => item.appName === win.appName && !item.isClosing)
    .indexOf(win)
  const step = 32
  const index = Math.max(0, slot)
  return {
    ...options,
    left: `${48 + index * step}px`,
    top: `${56 + index * step}px`,
  }
}

function dockTitle(win: AppWindowState) {
  return win.appTitle || win.plugin?.name || appMeta(win)?.name || win.appParams.item.name
}

function windowTitle(win: AppWindowState) {
  return win.appTitle || win.plugin?.name || appMeta(win)?.name
}

function setAppInstance(id: string, el: unknown) {
  if (el && typeof el === 'object' && typeof (el as { confirmDismiss?: unknown }).confirmDismiss === 'function') {
    appInstances.set(id, el as { confirmDismiss: () => Promise<boolean> | boolean })
    return
  }
  appInstances.delete(id)
}

function focusReturnedFile(win: AppWindowState, fallback: HTMLElement) {
  const name = win.appParams.item?.name
  const list = fallback.closest('.explorer-list-wrap')
  if (name && list) {
    const item = list.querySelector(`[data-name="${CSS.escape(name)}"]`)
    if (item instanceof HTMLElement) {
      if (!item.matches('button, a, input, textarea, select, [tabindex]'))
        item.tabIndex = -1
      item.focus({ preventScroll: true })
      return
    }
  }
  fallback.focus({ preventScroll: true })
}

/** Close button, title-icon double-click, Esc, and the app's own Exit share this. */
async function requestClose(win: AppWindowState) {
  if (win.isClosing || closeInFlight.has(win.id))
    return
  closeInFlight.add(win.id)
  try {
    const confirmed = await appInstances.get(win.id)?.confirmDismiss?.()
    if (confirmed === false)
      return
    const othersOpen = appsStoreState.windows.some(item => item.id !== win.id && !item.isClosing)
    const back = othersOpen ? null : consumeReturnFocus(win.id)
    closeAppWindow(win.id)
    if (back)
      focusReturnedFile(win, back)
  }
  finally {
    closeInFlight.delete(win.id)
  }
}

function setAppContainerRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) {
    appContainerRefs.set(id, el)
  }
  else {
    appContainerRefs.delete(id)
  }
}

function focusAppContainer(id: string, attempts = 3) {
  const win = appsStoreState.windows.find(item => item.id === id)
  if (!win || win.isClosing)
    return
  const el = appContainerRefs.get(id)
  if (el?.isConnected) {
    const active = document.activeElement
    if (active instanceof Node && el.contains(active) && active !== el)
      return
    el.focus({ preventScroll: true })
    return
  }

  if (attempts > 0) {
    setTimeout(focusAppContainer, 50, id, attempts - 1)
  }
}

function handleWindowActive(win: AppWindowState) {
  setAppWindowActive(win, false)
  focusAppContainer(win.id)
}

function handleWindowRestored(win: AppWindowState) {
  setTimeout(() => {
    focusAppContainer(win.id)
  }, 0)
}

function handleDockClick(win: AppWindowState) {
  setAppWindowActive(win, true)
  if (!win.minimized) {
    focusAppContainer(win.id)
  }
}

function restoreOrMinimizeWindow(win: AppWindowState) {
  if (win.maximized) {
    win.maximized = false
  }

  // win.minimized = true
}

function handleSelectItems(win: AppWindowState, names: string[]) {
  // Emit to FileManager to select the items
  explorerBus.emit(ExplorerEvents.SELECT_COLLECTED, {
    basePath: win.appParams.basePath,
    names,
  })
  restoreOrMinimizeWindow(win)
}

function handleLocateItem(win: AppWindowState, name: string) {
  explorerBus.emit(ExplorerEvents.REVEAL_ITEM, {
    basePath: win.appParams.basePath,
    name,
  })
  restoreOrMinimizeWindow(win)
}

const hasOpenApps = computed(() => appsStoreState.windows.length > 0)

watch(
  () => appsStoreState.activeId,
  (activeId) => {
    if (activeId) {
      focusAppContainer(activeId)
    }
  },
)
</script>

<template>
  <ViewPortWindow
    v-for="win in appsStoreState.windows"
    :key="win.id"
    ref="vpWindowRefs"
    v-model:maximized="win.maximized"
    v-model:minimized="win.minimized"
    class="app-window"
    :visible="!win.minimized && !win.isClosing"
    :allow-maximum="true"
    :allow-minimum="true"
    :init-center="initCenter(win)"
    :init-win-options="initWinOptions(win)"
    @on-active="handleWindowActive(win)"
    @on-close="requestClose(win)"
    @on-restored="handleWindowRestored(win)"
  >
    <template #titleBarLeft>
      <PluginIcon
        v-if="win.plugin"
        :plugin="win.plugin"
        class="title-icon"
        @click.stop
        @dblclick.stop="requestClose(win)"
      />
      <MdiIcon
        v-else
        :name="appMeta(win)?.icon"
        class="title-icon"
        @click.stop
        @dblclick.stop="requestClose(win)"
      />
      <span class="title-text">{{ windowTitle(win) }}</span>
    </template>

    <ShortcutScopeProvider :scope="`app:${win.id}`">
      <div
        :ref="(el) => setAppContainerRef(win.id, el)"
        class="app-container vgo-u-surface"
        tabindex="-1"
        :data-shortcut-scope="`app:${win.id}`"
      >
        <PluginHost
          v-if="win.plugin"
          :plugin="win.plugin"
          :app-params="win.appParams"
          @exit="requestClose(win)"
          @set-title="(val: string) => { win.appTitle = val }"
        />
        <component
          :is="Apps[win.appName]"
          v-else-if="win.appName"
          :ref="(el: unknown) => setAppInstance(win.id, el)"
          :app-params="win.appParams"
          @exit="requestClose(win)"
          @set-title="(val: string) => { win.appTitle = val }"
          @select-items="(names: string[]) => handleSelectItems(win, names)"
          @locate-item="(name: string) => handleLocateItem(win, name)"
          @update-app-params="(params: AppParams) => { win.appParams = params }"
        />
        <AppEscToClose :scope="`app:${win.id}`" @close="requestClose(win)" />
      </div>
    </ShortcutScopeProvider>
  </ViewPortWindow>

  <Transition name="dock-fade">
    <div
      v-if="hasOpenApps"
      class="app-dock"
      role="toolbar"
      aria-label="Open apps"
    >
      <div class="app-dock-inner">
        <button
          v-for="win in appsStoreState.windows"
          :key="win.id"
          type="button"
          class="vgo-u-button-reset dock-item"
          :class="{
            'is-active': win.id === appsStoreState.activeId,
            'is-minimized': win.minimized,
          }"
          :title="dockTitle(win)"
          @click="handleDockClick(win)"
        >
          <span class="dock-icon-wrap vgo-panel">
            <PluginIcon v-if="win.plugin" :plugin="win.plugin" class="dock-icon" />
            <MdiIcon v-else :name="appMeta(win)?.icon" class="dock-icon" />
          </span>
          <span class="dock-indicator" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.app-container {
  height: 100%;
  overflow: auto;
  border-radius: 0 0 var(--vgo-radius) var(--vgo-radius);

  &:focus {
    outline: none;
  }
}

.app-window.is-maximized {
  .app-container {
    border-radius: 0;
  }
}

.title-text {
  word-break: break-word;
  font-size: var(--vgo-font-sm);
}

.title-icon {
  flex-shrink: 0;
  font-size: var(--vgo-icon-md);
}

.app-window {
  outline: none;
  min-width: 320px;
  min-height: 200px;
}

/* 底部 Dock */
.app-dock {
  position: fixed;
  bottom: var(--vgo-space-1);
  left: var(--vgo-space-1);
  z-index: var(--vgo-z-sticky);
  pointer-events: none;
}

.app-dock-inner {
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}

.dock-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 2px var(--vgo-space-1) 3px;
  border-radius: var(--vgo-radius);
  cursor: pointer;
  color: inherit;
  transition: background-color var(--vgo-duration-fast) ease;
}

.dock-item:hover {
  background-color: var(--vgo-hover);
}

.dock-item:active {
  background-color: var(--vgo-primary-opacity);
}

.dock-icon-wrap {
  width: var(--vgo-control-md);
  height: var(--vgo-control-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dock-icon {
  font-size: var(--vgo-icon-lg);
  line-height: 1;
  color: var(--vgo-primary);
}

.dock-indicator {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background-color: var(--vgo-text-secondary);
  transition: opacity var(--vgo-duration-fast) ease;
}

.dock-item.is-active .dock-indicator {
  background-color: var(--vgo-primary);
}

.dock-item.is-minimized .dock-icon-wrap {
  opacity: 0.55;
}

.dock-item.is-minimized .dock-indicator {
  opacity: 0.35;
}

.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: opacity var(--vgo-duration-base) ease;
}

.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
}
</style>
