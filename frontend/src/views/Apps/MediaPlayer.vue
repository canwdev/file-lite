<script lang="ts" setup="">
import {fsWebApi} from '@/api/filesystem.ts'

const props = withDefaults(
  defineProps<{
    absPath: string
    controls?: boolean
    autoplay?: boolean
  }>(),
  {
    controls: true,
    autoplay: true,
  },
)
const emit = defineEmits(['exit'])
const {absPath} = toRefs(props)

const mediaSrc = computed(() => {
  return fsWebApi.getStreamUrl(absPath.value)
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
