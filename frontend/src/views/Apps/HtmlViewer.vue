<script lang="ts" setup>
import { useFileLiteSdk } from '@/sdk/use-app-sdk'

const sdk = useFileLiteSdk()
const path = ref('')

/** 文件地址 */
const src = computed(() => path.value ? sdk.url(path.value) : '')

sdk.onOpen((launch) => {
  if (!launch)
    return
  path.value = launch.path
  sdk.setTitle(launch.filename)
})
</script>

<template>
  <div class="html-viewer">
    <iframe
      v-if="src"
      class="html-viewer__frame"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts"
      :src="src"
    />
  </div>
</template>

<style lang="scss" scoped>
.html-viewer {
  width: 100%;
  height: 100%;

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
}
</style>
