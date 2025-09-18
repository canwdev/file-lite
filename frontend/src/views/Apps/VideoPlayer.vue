<script lang="ts" setup="">
import {fsWebApi} from '@/api/filesystem.ts'
import {AppParams} from '@/views/Apps/apps.ts'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
    controls?: boolean
    autoplay?: boolean
  }>(),
  {
    controls: true,
    autoplay: true,
  },
)
const emit = defineEmits([])
const {appParams} = toRefs(props)

const mediaSrc = computed(() => {
  return fsWebApi.getStreamUrl(appParams.value?.absPath)
})
</script>

<template>
  <div class="media-player">
    <video :src="mediaSrc" :controls="controls" :autoplay="autoplay"></video>
  </div>
</template>

<style lang="scss" scoped>
.media-player {
  width: 100%;
  height: 100%;
  background-color: #1c1c1c;
  overflow: hidden;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
</style>
