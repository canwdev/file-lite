<script lang="ts" setup="">
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem.ts'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)
const { appParams } = toRefs(props)

const mediaSrc = computed(() => {
  return fsWebApi.getStreamUrl(appParams.value?.absPath)
})
</script>

<template>
  <div class="image-viewer">
    <img :src="mediaSrc">
  </div>
</template>

<style lang="scss" scoped>
.image-viewer {
  width: 100%;
  height: 100%;
  overflow: hidden;

  background: #212121;
  background-image:
    linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black),
    linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black);
  background-size: 60px 60px;
  background-position:
    0 0,
    30px 30px;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
</style>
