<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
window.$message = ElMessage
window.$dialog = ElMessageBox
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
