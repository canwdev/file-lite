<script setup lang="ts">
import {appsStoreState} from './apps-store'
import {Apps} from './apps'

const handleExit = () => {
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
</script>

<template>
  <div ref="rootRef" class="apps-entry-wrapper vgo-bg" tabindex="0" v-if="appsStoreState.isShowApp">
    <div class="title-bar">
      <div class="font-code">{{ appsStoreState.appParams?.absPath }}</div>
      <button @click="handleExit" class="btn-no-style mdi mdi-close"></button>
    </div>

    <!--<pre>{{ appsStoreState }}</pre>-->
    <div class="app-container">
      <component
        :is="Apps[appsStoreState.appName]"
        :appParams="appsStoreState.appParams"
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
    border-radius: 0 0 8px 8px;
    padding: 0 10px;
  }

  .app-container {
    flex: 1;
    overflow: auto;
  }
}
</style>
