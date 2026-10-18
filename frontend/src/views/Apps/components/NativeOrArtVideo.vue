<script setup lang="ts">
import type { Ref } from 'vue'
import type { SubtitleSource } from '../video-subtitle'
import { nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { useMediaSessionRecovery } from '@/hooks/use-media-session-recovery'
import { localSettingsStore } from '@/store/index'
import { fs } from '@/utils/fs'
import { subtitleToVtt } from '../video-subtitle'
import VArtPlayer from './VArtPlayer.vue'

const props = withDefaults(
  defineProps<{
    src: string
    autoplay?: boolean
    /** 仅原生 `<video>` 生效；Art 使用自带控制栏 */
    controls?: boolean
    /** 自动找到的所有同名字幕；两个播放器各自决定怎么呈现 */
    subtitles?: SubtitleSource[]
  }>(),
  {
    autoplay: true,
    controls: true,
    subtitles: () => [],
  },
)

const emit = defineEmits<{
  (e: 'mediaElementReady', video: HTMLVideoElement): void
}>()

const nativeVideoRef = ref<HTMLVideoElement | null>(null)
const vArtRef = ref<InstanceType<typeof VArtPlayer> | null>(null)
const isNativePlayer = computed(() => localSettingsStore.value.isNativePlayer)
/** The element the recovery hook watches; Artplayer replaces the HTML element. */
const mediaElement = ref<HTMLVideoElement | null>(null)
useMediaSessionRecovery(mediaElement)

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
  mediaElement.value = v
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
    // Artplayer's `ready` event can arrive after the initial load has already
    // failed; ask for the element once after mount too, so the media recovery
    // hook sees the <video> even when that event is late.
    notifyMediaReady()
  })
})

/**
 * 原生 `<video>` 只认 WebVTT，而且每份字幕是一个 `<track>`，所以先把所有字幕都取回来
 * 转成 VTT。浏览器自己在原生控制栏里列出这些轨，用户选哪条由浏览器管。
 */
interface NativeSubtitleTrack extends SubtitleSource {
  url: string
}

const nativeSubtitleTracks = ref<NativeSubtitleTrack[]>([])
/** 已创建的 blob URL：数据源换了、组件销毁时要全部释放。 */
let nativeSubtitleUrls: string[] = []
/** 切源时旧请求可能后返回，用序号让它在途作废。 */
let nativeSubtitleRequest = 0

function clearNativeSubtitles() {
  nativeSubtitleRequest++
  for (const url of nativeSubtitleUrls)
    URL.revokeObjectURL(url)
  nativeSubtitleUrls = []
  nativeSubtitleTracks.value = []
}

async function loadNativeSubtitles() {
  clearNativeSubtitles()
  const request = nativeSubtitleRequest
  if (!isNativePlayer.value || !props.subtitles.length)
    return

  const loaded = await Promise.all(props.subtitles.map(async (source): Promise<NativeSubtitleTrack | null> => {
    try {
      const { text } = await fs.readTextFile(source.path)
      const vtt = subtitleToVtt(source.path, text)
      return { ...source, url: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' })) }
    }
    catch (error) {
      // 自动加载是尽力而为：某份字幕读不到就跳过它，其余照常上轨。
      console.error('load subtitle failed', error)
      return null
    }
  }))

  if (request !== nativeSubtitleRequest) {
    for (const track of loaded) {
      if (track)
        URL.revokeObjectURL(track.url)
    }
    return
  }

  const tracks = loaded.filter((track): track is NativeSubtitleTrack => track !== null)
  nativeSubtitleUrls = tracks.map(track => track.url)
  nativeSubtitleTracks.value = tracks
}

watch([isNativePlayer, () => props.subtitles], () => {
  void loadNativeSubtitles()
}, { immediate: true })

/**
 * 打开第一条字幕轨。
 *
 * 动态插进 `<video>` 的 `<track>` 光靠 `default` 不一定会显示（`mode` 默认是
 * disabled），所以这里显式设成 showing；多轨时其余必须是 disabled，否则会叠在一起。
 * 用户在原生控制栏里换轨后不会再被打开，因为只有字幕列表或播放器切换时才走这里。
 */
function showSubtitleTrack() {
  const video = nativeVideoRef.value
  if (!video)
    return
  Array.from(video.textTracks).forEach((track, index) => {
    track.mode = index === 0 ? 'showing' : 'disabled'
  })
}

// 表源（getter）在创建 watch 时就会被求值，所以这里只能引用上面已经声明的东西。
watch([isNativePlayer, nativeVideoRef, () => nativeSubtitleTracks.value], () => {
  nextTick(() => showSubtitleTrack())
})

onBeforeUnmount(clearNativeSubtitles)

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
        v-for="(track, index) in nativeSubtitleTracks"
        :key="track.path"
        :src="track.url"
        :label="track.label"
        kind="subtitles"
        srclang="und"
        :default="index === 0"
      >
    </video>
    <VArtPlayer
      v-else
      ref="vArtRef"
      :src="src"
      :autoplay="autoplay"
      :subtitles="subtitles"
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
