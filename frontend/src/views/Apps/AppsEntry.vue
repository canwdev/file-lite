<script setup lang="ts">
import type { AppWindowState } from './apps-store'
import { ViewPortWindow } from '@canwdev/vgo-ui'
import { appListByOpenWith, Apps } from './apps'
import {
  appsStoreState,
  closeAppWindow,
  setAppWindowActive,
  syncAppWindowRefs,
} from './apps-store'

const vpWindowRefs = ref<unknown[]>([])

watch(
  () => appsStoreState.windows.map(w => w.id),
  async () => {
    await nextTick()
    syncAppWindowRefs((vpWindowRefs.value ?? []) as unknown[])
  },
  { flush: 'post' },
)

function appMeta(win: AppWindowState) {
  return appListByOpenWith[win.appName]
}

function dockTitle(win: AppWindowState) {
  return win.appTitle || appMeta(win)?.name || win.appParams.item.name
}

function handleClose(win: AppWindowState) {
  closeAppWindow(win.id)
}

function handleWindowRestored(win: AppWindowState) {
  setTimeout(() => {
    win.windowRef?.focus()
  }, 0)
}

const hasOpenApps = computed(() => appsStoreState.windows.length > 0)
</script>

<template>
  <ViewPortWindow
    v-for="win in appsStoreState.windows"
    :key="win.id"
    ref="vpWindowRefs"
    v-model:maximized="win.maximized"
    v-model:minimized="win.minimized"
    class="apps-vp-window"
    :visible="!win.minimized && !win.isClosing"
    :allow-maximum="true"
    :allow-minimum="true"
    :init-center="true"
    :init-win-options="{
      width: 'min(960px, 90vw)',
      height: 'min(720px, 85vh)',
    }"
    @on-active="setAppWindowActive(win, false)"
    @on-close="handleClose(win)"
    @on-restored="handleWindowRestored(win)"
  >
    <template #titleBarLeft>
      <span :class="appMeta(win)?.icon" />
      <span class="title-text">{{ win.appTitle || appMeta(win)?.name }}</span>
    </template>

    <div class="app-container vgo-bg">
      <component
        :is="Apps[win.appName]"
        :app-params="win.appParams"
        @exit="handleClose(win)"
        @set-title="(val: string) => { win.appTitle = val }"
      />
    </div>
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
          class="dock-item btn-no-style"
          :class="{
            'is-active': win.id === appsStoreState.activeId,
            'is-minimized': win.minimized,
          }"
          :title="dockTitle(win)"
          @click="setAppWindowActive(win, true)"
        >
          <span class="dock-icon-wrap vgo-panel">
            <span :class="appMeta(win)?.icon" class="dock-icon" />
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
}

.title-text {
  word-break: break-word;
  font-size: 12px;
}

.apps-vp-window {
  outline: none;
  min-width: 320px;
  min-height: 200px;
}

/* 底部 Dock */
.app-dock {
  position: fixed;
  bottom: 4px;
  z-index: 10;
  pointer-events: none;
  left: 4px;
  transform: none;
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
  padding: 2px 4px 3px;
  border-radius: var(--vgo-radius);
  cursor: pointer;
  color: inherit;
  transition: background-color 0.12s ease;
}

.dock-item:hover {
  background-color: color-mix(in srgb, var(--vgo-primary, #1976d2) 10%, transparent);
}

.dock-item:active {
  background-color: color-mix(in srgb, var(--vgo-primary, #1976d2) 16%, transparent);
}

.dock-icon-wrap {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dock-icon {
  font-size: 24px;
  line-height: 1;
  color: var(--vgo-primary, #1976d2);
}

.dock-indicator {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--vgo-color-text, #333) 45%, transparent);
  opacity: 0.55;
  transition: opacity 0.12s ease;
}

.dock-item.is-active .dock-indicator {
  opacity: 1;
  background: var(--vgo-primary, #1976d2);
}

.dock-item.is-minimized .dock-icon-wrap {
  opacity: 0.55;
}

.dock-item.is-minimized .dock-indicator {
  opacity: 0.35;
}

.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: opacity 0.16s ease;
}

.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
}
</style>
