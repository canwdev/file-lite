<script lang="ts" setup="">
import type { AppParams } from '@/views/Apps/apps.ts'
import { fs } from '@/utils/fs'
import NativeOrArtVideo from './components/NativeOrArtVideo.vue'
import { useSiblingSubtitles } from './use-sibling-subtitle'

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
const mediaSrc = computed(() => {
  const path = appParams.value?.absPath
  return path ? fs.url(path) : ''
})
watch(
  () => props.appParams,
  () => {
    const { item } = props.appParams
    emit('setTitle', item?.name || '')
  },
  { immediate: true },
)

/** 同名 SRT/ASS/VTT/SSA 自动交给播放器，`SRT/` 里的字幕也算；这一层只负责找到它们。 */
const subtitles = useSiblingSubtitles(() => props.appParams?.absPath ?? '')
</script>

<template>
  <div class="media-player">
    <NativeOrArtVideo
      :src="mediaSrc"
      :controls="controls"
      :autoplay="autoplay"
      :subtitles="subtitles"
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
