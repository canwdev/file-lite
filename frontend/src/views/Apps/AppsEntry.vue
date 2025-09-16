<script setup lang="ts">
import { appsStoreState } from './apps-store';
import TextEditor from './TextEditor.vue';


const handleExit = () => {
  appsStoreState.isShowApp = false
  appsStoreState.absPath = ''
}

</script>

<template>
  <div class="apps-entry-wrapper vgo-bg" v-if="appsStoreState.isShowApp">
    <div class="title-bar">
      <div class="font-code">{{ appsStoreState.absPath }}</div>
    </div>
    <div class="app-container">
      <TextEditor :abs-path="appsStoreState.absPath" @exit="handleExit" />
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
    background: linear-gradient(to bottom, var(--vgo-primary-opacity) 0%, transparent 100%);
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
