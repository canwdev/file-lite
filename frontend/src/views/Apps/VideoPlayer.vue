<script lang="ts" setup="">
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import NativeOrArtVideo from './components/NativeOrArtVideo.vue'
import { useSiblingSubtitles } from './use-sibling-subtitle'

const props = withDefaults(
  defineProps<{
    controls?: boolean
    autoplay?: boolean
  }>(),
  {
    controls: true,
    autoplay: true,
  },
)
const sdk = useFileLiteSdk()
const path = ref('')

// 文件地址
const mediaSrc = computed(() => path.value ? sdk.url(path.value) : '')

sdk.onOpen((launch) => {
  if (!launch) {
    path.value = ''
    return
  }
  path.value = launch.path
  sdk.setTitle(launch.filename)
})

/** 同名 SRT/ASS/VTT/SSA 自动交给播放器，`SRT/` 里的字幕也算；这一层只负责找到它们。 */
const subtitles = useSiblingSubtitles(() => path.value)
</script>

<template>
  <div class="media-player">
    <NativeOrArtVideo
      :src="mediaSrc"
      :controls="props.controls"
      :autoplay="props.autoplay"
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
