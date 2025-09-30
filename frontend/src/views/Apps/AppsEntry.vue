<script setup lang="ts">
import { AppList, Apps } from './apps'
import { appsStoreState } from './apps-store'

function handleExit() {
  appsStoreState.isShowApp = false
  appsStoreState.appParams = null
}

const rootRef = ref()
watch(
  () => appsStoreState.isShowApp,
  (newVal) => {
    if (newVal) {
      setTimeout(() => {
        console.log('appsEntry focus', rootRef.value)
        rootRef.value?.focus()
      })
    }
  },
)

const appDetails = computed(() => AppList.find(item => item.openWith === appsStoreState.appName))
</script>

<template>
  <div v-if="appsStoreState.isShowApp" ref="rootRef" class="apps-entry-wrapper vgo-bg" tabindex="0">
    <div class="title-bar">
      <div class="title-text">
        <span :class="appDetails?.icon" /><span style="font-size: 12px;">{{ appsStoreState.appParams?.absPath }}</span>
      </div>
      <button class="btn-no-style btn-close" @click="handleExit">
        <span class="mdi mdi-close" />
      </button>
    </div>

    <!-- <pre>{{ appsStoreState }}</pre> -->
    <div class="app-container">
      <component
        :is="Apps[appsStoreState.appName]"
        :app-params="appsStoreState.appParams"
        @exit="handleExit"
      />
    </div>
  </div>
</template>

<style scoped>
.apps-entry-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  outline: none;

  .title-bar {
    min-height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    padding: 0 0 0 10px;
    border-bottom: 1px solid var(--vgo-color-border);
    .title-text {
      font-size: 14px;
      padding: 4px 0;
      display: flex;
      align-items: center;
      gap: 4px;
      .mdi {
        color: var(--vgo-primary);
      }
    }

    .btn-close {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      font-size: 16px;
      &:hover {
        background-color: var(--vgo-primary-opacity);
      }
    }
  }

  .app-container {
    flex: 1;
    overflow: auto;
  }
}
</style>
