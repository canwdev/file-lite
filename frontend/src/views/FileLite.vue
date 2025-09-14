<script lang="ts" setup>
import {authToken} from '@/store'
import FileManager from '@/views/FileManager/FileManager.vue'
import Login from '@/views/Login.vue'
</script>

<template>
  <div class="file-lite">
    <Login v-if="!authToken" />
    <FileManager v-else />
  </div>
</template>

<style lang="scss" scoped>
.file-lite {
  height: 100%;
}
</style>
