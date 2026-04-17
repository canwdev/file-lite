<script setup lang="ts">
import type { Option } from 'artplayer/types/option'
import Artplayer from 'artplayer'
import { useStorage } from '@vueuse/core'
import { type Ref, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LsKeys } from '@/enum'

interface Props {
  src: string
  autoplay?: boolean
  options?: Partial<Option> // 允许外部传入 Artplayer 的其他高级配置
}

const props = withDefaults(defineProps<Props>(), {
  autoplay: false,
  options: () => ({}),
})

const emit = defineEmits<{
  (e: 'ratechange', event: Event): void
  (e: 'loadedmetadata', event: Event): void
  (e: 'play', event: Event): void
  (e: 'ready', art: Artplayer): void // 抛出实例以便父组件获取控制权
}>()

const storageOpts = { listenToStorageChanges: false as const }

/** 与 art.volume / HTML5 一致，0–1 */
const persistedVolume = useStorage(LsKeys.ARTPLAYER_VOLUME, 1, localStorage, storageOpts)

/** 与 art.playbackRate 一致 */
const persistedPlaybackRate = useStorage(LsKeys.ARTPLAYER_PLAYBACK_RATE, 1, localStorage, storageOpts)

const FLOAT_EPS = 1e-3

function clamp(n: number, lo: number, hi: number, nanFallback: number): number {
  if (!Number.isFinite(n))
    return nanFallback
  return Math.min(hi, Math.max(lo, n))
}

function clampVolume(v: number): number {
  return clamp(v, 0, 1, 1)
}

function clampPlaybackRate(v: number): number {
  return clamp(v, 0.25, 4, 1)
}

/** Subtitle type 可选 vtt、srt、ass */
function inferSubtitleType(filename: string): 'vtt' | 'srt' | 'ass' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.vtt'))
    return 'vtt'
  if (lower.endsWith('.ass') || lower.endsWith('.ssa'))
    return 'ass'
  return 'srt'
}

const artRef = ref<HTMLDivElement | null>(null)
const videoFileInputRef = ref<HTMLInputElement | null>(null)
const subtitleFileInputRef = ref<HTMLInputElement | null>(null)
// 使用 shallowRef 避免 Vue 深度代理复杂的第三方类实例，提升性能
const artInstance = shallowRef<Artplayer | null>(null)
const videoObjectUrl = ref<string | null>(null)
const subtitleObjectUrl = ref<string | null>(null)

function revokeBlobRef(urlRef: Ref<string | null>) {
  if (urlRef.value) {
    URL.revokeObjectURL(urlRef.value)
    urlRef.value = null
  }
}

function takePickedFile(e: Event): File | null {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  return file
}

function onLocalVideoPicked(e: Event) {
  const file = takePickedFile(e)
  const inst = artInstance.value
  if (!file || !inst)
    return
  revokeBlobRef(videoObjectUrl)
  const url = URL.createObjectURL(file)
  videoObjectUrl.value = url
  void inst.switchUrl(url).catch(console.error)
}

function onLocalSubtitlePicked(e: Event) {
  const file = takePickedFile(e)
  const inst = artInstance.value
  if (!file || !inst)
    return
  revokeBlobRef(subtitleObjectUrl)
  const url = URL.createObjectURL(file)
  subtitleObjectUrl.value = url
  inst.subtitle.switch(url, {
    name: file.name,
    type: inferSubtitleType(file.name),
  })
}

/** data URL（如截图）→ 剪贴板图片，需 HTTPS 且浏览器支持 ClipboardItem */
async function copyDataUrlImageToClipboard(dataUrl: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image API is not available')
  }
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png'
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })])
}

/** 将 useStorage 中的音量/倍速应用到播放器（ready 与跨处复用） */
function applyPersistedToArt(art: Artplayer) {
  const v = clampVolume(persistedVolume.value)
  if (Math.abs(art.volume - v) > FLOAT_EPS)
    art.volume = v
  const r = clampPlaybackRate(persistedPlaybackRate.value)
  if (Math.abs(art.playbackRate - r) > FLOAT_EPS)
    art.playbackRate = r
}

onMounted(() => {
  const el = artRef.value
  if (!el)
    return

  const { contextmenu: extraContextmenu, settings: extraSettings, ...playerOptionsRest } = props.options

  // 初始化 Artplayer — https://artplayer.org/document/start/option.html · https://artplayer.org/llms.txt
  artInstance.value = new Artplayer({
    container: el,
    url: props.src,
    autoplay: props.autoplay,
    // 基础控制栏配置
    setting: true,
    playbackRate: true,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    // autoSize: true,
    theme: '#e91e63',
    // autoMini: true,
    aspectRatio: true,
    screenshot: true,
    mutex: true,
    // backdrop: false, // 关闭毛玻璃效果
    miniProgressBar: true,
    airplay: true,
    subtitleOffset: true,
    subtitle: {},
    settings: [
      {
        name: 'custom-open-local-video',
        html: 'Open local video…',
        // tooltip: 'Play a video file from this device',
        onClick() {
          videoFileInputRef.value?.click()
        },
      },
      {
        name: 'custom-load-local-subtitle',
        html: 'Load local subtitle…',
        // tooltip: 'VTT, SRT, or ASS',
        onClick() {
          subtitleFileInputRef.value?.click()
        },
      },
      ...(Array.isArray(extraSettings) ? extraSettings : []),
    ],
    contextmenu: [
      {
        html: 'Copy image to clipboard',
        async click() {
          const inst = artInstance.value
          if (!inst)
            return
          try {
            const dataUrl = await inst.getDataURL()
            await copyDataUrlImageToClipboard(dataUrl)
          }
          catch (e) {
            console.error(e)
          }
          finally {
            inst.contextmenu.show = false
          }
        },
      },
      ...(Array.isArray(extraContextmenu) ? extraContextmenu : []),
    ],
    // lock: true,
    gesture: true,
    fastForward: true,
    autoPlayback: true,
    // 合并外部传入的额外配置（contextmenu 已合并进上方列表）
    ...playerOptionsRest,
    volume: clampVolume(persistedVolume.value),
  })

  const art = artInstance.value

  // Artplayer 会将原生的 video 事件加上 'video:' 前缀
  art.on('video:volumechange', () => {
    persistedVolume.value = clampVolume(art.volume)
  })
  art.on('video:ratechange', (e: Event) => {
    persistedPlaybackRate.value = clampPlaybackRate(art.playbackRate)
    emit('ratechange', e)
  })
  art.on('video:loadedmetadata', (e: Event) => emit('loadedmetadata', e))
  art.on('video:play', (e: Event) => emit('play', e))

  art.on('ready', () => {
    applyPersistedToArt(art)
    emit('ready', art)
  })
})

watch(
  [() => persistedVolume.value, () => persistedPlaybackRate.value],
  () => {
    const inst = artInstance.value
    if (inst?.isReady)
      applyPersistedToArt(inst)
  },
)

// 监听 src 变化，实现视频源的动态切换
watch(
  () => props.src,
  (newUrl) => {
    if (artInstance.value && newUrl) {
      revokeBlobRef(videoObjectUrl)
      artInstance.value.switchUrl(newUrl)
    }
  },
)

// 组件卸载前销毁播放器，释放内存
onBeforeUnmount(() => {
  revokeBlobRef(videoObjectUrl)
  revokeBlobRef(subtitleObjectUrl)
  artInstance.value?.destroy(false)
})

// 向外暴露实例，父组件可通过 template ref 直接调用 artInstance 的方法 (如播放、暂停)
defineExpose({
  art: artInstance,
})
</script>

<template>
  <div class="v-artplayer-wrap">
    <input
      ref="videoFileInputRef"
      type="file"
      class="v-artplayer-file-input"
      accept="video/*,.mp4,.webm,.ogg,.mkv,.m4v"
      @change="onLocalVideoPicked"
    >
    <input
      ref="subtitleFileInputRef"
      type="file"
      class="v-artplayer-file-input"
      accept=".vtt,.srt,.ass,.ssa,text/vtt"
      @change="onLocalSubtitlePicked"
    >
    <div ref="artRef" class="v-artplayer-container" />
  </div>
</template>

<style lang="scss" scoped>
.v-artplayer-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

/* 确保播放器容器默认填满父级 */
.v-artplayer-container {
  width: 100%;
  height: 100%;
}

.v-artplayer-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

<style>
.art-video-player .art-bottom {
    background-image: linear-gradient(to top, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.1), transparent) !important;
}

.art-video-player.art-mini-progress-bar .art-bottom,
.art-video-player.art-lock .art-bottom {
    background-image: none !important;
}

.art-mask .art-icon-state {
    display: none !important;
}
</style>
