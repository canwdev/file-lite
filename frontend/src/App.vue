<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { logout } from '@/api/auth'
import { useGlobalTheme } from '@/hooks/use-global-theme.ts'
import { clearAuthSession } from '@/store/auth'
import WsStatusDisplay from '@/views/WsStatusDisplay.vue'

window.$message = ElMessage
window.$dialog = ElMessageBox

const router = useRouter()

useGlobalTheme()

// `clearServerSession` is false when the server already refused the request (a
// 401): nothing is left to clear, so skip the round trip. Otherwise the
// HttpOnly cookie can only be removed by the backend.
window.$logout = (clearServerSession = true) => {
  if (clearServerSession) {
    void logout().catch(() => {})
  }
  clearAuthSession()
  router.push({ name: 'LoginView' })
}
</script>

<template>
  <div class="page-root">
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
}
</style>
