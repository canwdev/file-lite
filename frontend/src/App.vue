<script setup lang="ts">
import {ElMessage, ElMessageBox} from 'element-plus'
import {authToken} from './store'
import {useGlobalTheme} from '@/hooks/use-global-theme.ts'
window.$message = ElMessage
window.$dialog = ElMessageBox

const router = useRouter()

useGlobalTheme()
window.$logout = () => {
  authToken.value = ''
  router.push({name: 'LoginView'})
}
</script>

<template>
  <div class="page-root">
    <RouterView />
  </div>
</template>

<style lang="scss">
.page-root {
  position: relative;
  height: 100%;
  width: 100%;
}

.dark {
  .page-root {
    background-color: #303030;
    //background-image: linear-gradient(#434343, #282828);
    color: white;
  }
}
</style>
