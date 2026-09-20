<script lang="ts" setup="">
import type { AppParams } from '@/views/Apps/apps.ts'
import { useFileUrl } from '@/hooks/use-file-url'
import NativeOrArtVideo from './components/NativeOrArtVideo.vue'

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
const emit = defineEmits(['setTitle'])
const { appParams } = toRefs(props)
// 文件地址
const mediaSrc = useFileUrl(() => appParams.value?.absPath)
watch(
  () => props.appParams,
  () => {
    const { item } = props.appParams
    emit('setTitle', item?.name || '')
  },
  { immediate: true },
)
</script>

<template>
  <div class="media-player">
    <NativeOrArtVideo
      :src="mediaSrc"
      :controls="controls"
      :autoplay="autoplay"
    />
  </div>
</template>

<style lang="scss" scoped>
.media-player {
  width: 100%;
  height: 100%;
  // vgo-allow: 视频信箱底色与主题无关，必须是黑
  background-color: #000;
  overflow: hidden;
}
</style>
