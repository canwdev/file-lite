<script setup lang="ts">
import type { Ref } from 'vue'
import { nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { localSettingsStore } from '@/store/index'
import { fs } from '@/utils/fs'
import { subtitleName, subtitleToVtt } from '../video-subtitle'
import VArtPlayer from './VArtPlayer.vue'

const props = withDefaults(
  defineProps<{
    src: string
    autoplay?: boolean
    /** 仅原生 `<video>` 生效；Art 使用自带控制栏 */
    controls?: boolean
    /** 同名字幕的服务端路径；两个播放器各自决定怎么加载 */
    subtitlePath?: string
  }>(),
  {
    autoplay: true,
    controls: true,
    subtitlePath: '',
  },
)

const emit = defineEmits<{
  (e: 'mediaElementReady', video: HTMLVideoElement): void
}>()

const nativeVideoRef = ref<HTMLVideoElement | null>(null)
const vArtRef = ref<InstanceType<typeof VArtPlayer> | null>(null)
const isNativePlayer = computed(() => localSettingsStore.value.isNativePlayer)

type ArtplayerInstance = InstanceType<typeof import('artplayer').default>

function getArtplayer(): ArtplayerInstance | null {
  const inst = vArtRef.value
  if (!inst)
    return null
  const raw = (inst as { art?: Ref<ArtplayerInstance | null> | ArtplayerInstance | null }).art
  return raw == null ? null : unref(raw)
}

function getHtmlVideo(): HTMLVideoElement | null {
  if (isNativePlayer.value)
    return nativeVideoRef.value
  return getArtplayer()?.video ?? null
}

async function play() {
  if (isNativePlayer.value)
    await nativeVideoRef.value?.play()
  else
    await getArtplayer()?.play()
}

function pause() {
  if (isNativePlayer.value)
    nativeVideoRef.value?.pause()
  else
    getArtplayer()?.pause()
}

function notifyMediaReady() {
  const v = getHtmlVideo()
  if (v)
    emit('mediaElementReady', v)
}

function onArtReady(_art: ArtplayerInstance) {
  nextTick(() => notifyMediaReady())
}

watch(
  () => props.src,
  () => {
    nextTick(() => notifyMediaReady())
  },
)

watch(
  isNativePlayer,
  () => {
    nextTick(() => notifyMediaReady())
  },
)

onMounted(() => {
  nextTick(() => {
    if (isNativePlayer.value)
      notifyMediaReady()
  })
})

/** 原生 `<video>` 只认 WebVTT，所以字幕要取回来转换；Artplayer 自己会解析。 */
const nativeSubtitleSrc = ref('')
let nativeSubtitleBlobUrl = ''
/** 切片时旧请求可能后返回，用序号让它在途作废。 */
let nativeSubtitleRequest = 0

function clearNativeSubtitle() {
  nativeSubtitleRequest++
  if (nativeSubtitleBlobUrl) {
    URL.revokeObjectURL(nativeSubtitleBlobUrl)
    nativeSubtitleBlobUrl = ''
  }
  nativeSubtitleSrc.value = ''
}

async function loadNativeSubtitle() {
  clearNativeSubtitle()
  const path = props.subtitlePath
  if (!isNativePlayer.value || !path)
    return
  const request = nativeSubtitleRequest

  let url = ''
  try {
    const { text } = await fs.readTextFile(path)
    const vtt = subtitleToVtt(path, text)
    url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }))
  }
  catch (error) {
    // 自动加载是尽力而为：字幕读不到就当没有字幕，不打扰用户。
    console.error('load subtitle failed', error)
    return
  }
  if (request !== nativeSubtitleRequest) {
    URL.revokeObjectURL(url)
    return
  }
  nativeSubtitleBlobUrl = url
  nativeSubtitleSrc.value = url
}

watch([isNativePlayer, () => props.subtitlePath], () => {
  void loadNativeSubtitle()
}, { immediate: true })

/**
 * 打开字幕轨。
 *
 * 动态插进 `<video>` 的 `<track>` 光靠 `default` 不一定会显示（`mode` 默认是
 * disabled），所以这里显式设成 showing；用户在原生控制栏里关掉字幕不会再被打开，
 * 因为只有换字幕或切成原生播放时才走这里。
 */
function showSubtitleTrack() {
  const video = nativeVideoRef.value
  if (!video)
    return
  for (const track of Array.from(video.textTracks))
    track.mode = 'showing'
}

// 表源（getter）在创建 watch 时就会被求值，所以这里只能引用上面已经声明的东西。
watch([isNativePlayer, nativeVideoRef, () => nativeSubtitleSrc.value], () => {
  nextTick(() => showSubtitleTrack())
})

onBeforeUnmount(clearNativeSubtitle)

defineExpose({
  play,
  pause,
  getHtmlVideo,
  getArtplayer,
})
</script>

<template>
  <div class="native-or-art-video">
    <video
      v-if="isNativePlayer"
      ref="nativeVideoRef"
      :src="src"
      :controls="controls"
      :autoplay="autoplay"
    >
      <track
        v-if="nativeSubtitleSrc"
        :src="nativeSubtitleSrc"
        :label="subtitleName(subtitlePath)"
        kind="subtitles"
        srclang="und"
        default
      >
    </video>
    <VArtPlayer
      v-else
      ref="vArtRef"
      :src="src"
      :autoplay="autoplay"
      :subtitle-path="subtitlePath"
      @ready="onArtReady"
    />
  </div>
</template>

<style lang="scss" scoped>
.native-or-art-video {
  width: 100%;
  height: 100%;
  // vgo-allow: 视频信箱底色与主题无关，必须是黑
  background-color: #000;
  overflow: hidden;

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  // 原生字幕叠在画面上，必须显式给颜色：WebVTT 的文字颜色是从 media 元素继承的，
  // 不指定就会在浅色主题里继承页面文字色（近黑），配上 UA 的黑色字幕底就是黑底黑字。
  // 用 overlay 那对 token——它们按画面明暗选，且不随主题翻转。
  :deep(video)::cue {
    color: var(--vgo-overlay-text);
    background-color: var(--vgo-overlay-surface);
  }
}
</style>
