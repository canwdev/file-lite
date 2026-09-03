<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useGlobalTheme } from '@/hooks/use-global-theme.ts'
import { settingsStore } from '@/store'
import { authToken } from '@/store/auth'
import WsStatusDisplay from '@/views/WsStatusDisplay.vue'

window.$message = ElMessage
window.$dialog = ElMessageBox

const router = useRouter()

useGlobalTheme()

const pageTitle = computed(() => settingsStore.value.pageTitle.trim())

window.$logout = (clearToken = true) => {
  if (clearToken) {
    authToken.value = ''
  }
  router.push({ name: 'LoginView' })
}
</script>

<template>
  <div class="page-root" :class="{ 'has-page-title': pageTitle }">
    <div v-if="pageTitle" class="page-title-banner">
      {{ pageTitle }}
    </div>
    <RouterView />
    <WsStatusDisplay />
  </div>
</template>

<style lang="scss">
.page-root {
  position: relative;
  height: 100%;
  width: 100%;
  color: var(--vgo-text);
  background-color: var(--vgo-surface);

  &.has-page-title {
    // 为顶部横幅预留空间；高度与 .page-title-banner 保持一致
    padding-top: var(--vgo-control-md);
  }

  .page-title-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: var(--vgo-z-sticky);
    height: var(--vgo-control-md);
    display: flex;
    align-items: center;
    justify-content: center;
    padding-inline: var(--vgo-space-3);
    background-color: var(--vgo-primary);
    color: var(--vgo-on-primary);
    font-size: var(--vgo-font-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px #0000007d;
  }
}
</style>
