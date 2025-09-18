<script setup lang="ts">
import {appsStoreState} from './apps-store'
import {Apps} from './apps'

const handleExit = () => {
  appsStoreState.isShowApp = false
  appsStoreState.absPath = ''
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
</script>

<template>
  <div ref="rootRef" class="apps-entry-wrapper vgo-bg" tabindex="0" v-if="appsStoreState.isShowApp">
    <div class="title-bar">
      <div class="font-code">{{ appsStoreState.absPath }}</div>
      <button @click="handleExit" class="btn-no-style mdi mdi-close"></button>
    </div>
    <div class="app-container">
      <component
        :is="Apps[appsStoreState.appName]"
        :abs-path="appsStoreState.absPath"
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

  .title-bar {
    min-height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    border-radius: 0 0 8px 8px;
    padding: 0 10px;
  }

  .app-container {
    flex: 1;
    overflow: auto;
  }
}
</style>
