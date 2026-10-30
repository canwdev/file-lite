<script setup lang="ts">
import type { Option, SettingOption } from 'artplayer'
import type { Ref } from 'vue'
import type { SubtitleSource } from '../video-subtitle'
import type { SdkPickResult } from '@/sdk/contract'
import { useStorage } from '@vueuse/core'
import Artplayer from 'artplayer'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LsKeys } from '@/enum'
import { getCurrentPrimaryRgb, rgbToHex } from '@/hooks/use-global-theme'
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import { detectBlobTextEncoding } from '@/utils/text-encoding'
import { subtitleName, subtitleType } from '../video-subtitle'

const props = withDefaults(defineProps<Props>(), {
  autoplay: false,
  options: () => ({}),
  subtitles: () => [],
})

const emit = defineEmits<{
  (e: 'ratechange', event: Event): void
  (e: 'loadedmetadata', event: Event): void
  (e: 'play', event: Event): void
  (e: 'ready', art: Artplayer): void // 抛出实例以便父组件获取控制权
}>()

const sdk = useFileLiteSdk()

interface Props {
  src: string
  autoplay?: boolean
  options?: Partial<Option> // 允许外部传入 Artplayer 的其他高级配置
  /** 自动找到的同名字幕；第一条自动挂上，其余放进播放器的字幕菜单 */
  subtitles?: SubtitleSource[]
}

const storageOpts = { listenToStorageChanges: false as const }

/** 与 art.volume / HTML5 一致，0–1（与 MediaPlayer Pinia 音量仅在原生 video 路径互相同步） */
const persistedVolume = useStorage(LsKeys.ARTPLAYER_VOLUME, 1, localStorage, storageOpts)

/** 与 art.playbackRate 一致（与 MediaPlayer store 仅在原生 video 路径互相同步） */
const persistedPlaybackRate = useStorage(LsKeys.ARTPLAYER_PLAYBACK_RATE, 1, localStorage, storageOpts)

const FLOAT_EPS = 1e-3
const playbackRateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]

interface PlaybackRateSettingItem {
  html: string
  value: number
  default?: boolean
}

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

function formatPlaybackRate(rate: number): string {
  return `${rate}x`
}

function getPlaybackRateSelector(): PlaybackRateSettingItem[] {
  const currentRate = clampPlaybackRate(persistedPlaybackRate.value)

  return playbackRateOptions.map(value => ({
    html: formatPlaybackRate(value),
    value,
    default: Math.abs(value - currentRate) < FLOAT_EPS,
  }))
}

const artRef = ref<HTMLDivElement | null>(null)
const videoFileInputRef = ref<HTMLInputElement | null>(null)
const subtitleFileInputRef = ref<HTMLInputElement | null>(null)
/** 服务端文件的扩展名过滤（与自动找字幕用的列表保持一致） */
const SERVER_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.ogg', '.m4v']
const SERVER_SUBTITLE_EXTENSIONS = ['.vtt', '.srt', '.ass', '.ssa']

/**
 * 从 file-lite 里挑一个文件（视频 / 字幕）。
 *
 * 走 SDK 的 pick：对话框由宿主打开，所以它和文件管理器共用同一个选择器，
 * 也不会被播放器窗口的尺寸限制。
 */
async function pickServerFile(type: 'video' | 'subtitle'): Promise<SdkPickResult | null> {
  return await sdk.pick({
    mode: 'file',
    title: type === 'video'
      ? $t('file_lite_i18n.open_server_video')
      : $t('file_lite_i18n.open_server_subtitle'),
    extensions: type === 'video' ? SERVER_VIDEO_EXTENSIONS : SERVER_SUBTITLE_EXTENSIONS,
  })
}
// 使用 shallowRef 避免 Vue 深度代理复杂的第三方类实例，提升性能
const artInstance = shallowRef<Artplayer | null>(null)
const videoObjectUrl = ref<string | null>(null)
const subtitleObjectUrl = ref<string | null>(null)
/** 探测本地字幕的编码要 await，回来时组件可能已经销毁。 */
let isAlive = true

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
  // 本地视频旁边没有服务端字幕，上一部自动挂上的得撤掉，菜单也不能再列旧字幕
  autoSubtitlesAvailable = false
  clearAutoSubtitle()
  void inst.switchUrl(url).catch(console.error)
}

async function onLocalSubtitlePicked(e: Event) {
  const file = takePickedFile(e)
  const inst = artInstance.value
  if (!file || !inst)
    return
  revokeBlobRef(subtitleObjectUrl)
  // 本地字幕不经过服务端，编码只能在前端探；Artplayer 用它自己的 TextDecoder 解。
  const encoding = await detectBlobTextEncoding(file)
  if (!isAlive)
    return
  const url = URL.createObjectURL(file)
  subtitleObjectUrl.value = url
  inst.subtitle.switch(url, {
    name: file.name,
    type: subtitleType(file.name),
    encoding,
  })
  // 本地字幕不在自动列表里，菜单不再把上一条标成当前项
  subtitleAttached = true
  activeSubtitlePath = ''
  applySubtitleSetting()
}

const AUTO_SUBTITLE_SETTING = 'auto-subtitle'
/** 自动字幕菜单里当前挂上的那条；空字符串表示没挂。 */
let activeSubtitlePath = ''
/** 画面上是否挂着字幕（自动或手动载入的都算），换片时要撤掉。 */
let subtitleAttached = false
/** 已经自动处理过的字幕列表；同一份列表只自动挂一次，用户关掉后不会自己再打开。 */
let appliedSubtitleList: SubtitleSource[] | null = null
/** App 传进来的自动字幕是否还对应正在播放的视频（在播放器里换过片之后就不是了）。 */
let autoSubtitlesAvailable = true
let subtitleSettingAdded = false
let emptyVttUrl = ''

/** Artplayer 没有 clear API：换到没有字幕的视频时，用一个空 VTT 把上一部的顶掉。 */
function getEmptyVttUrl() {
  emptyVttUrl ||= URL.createObjectURL(new Blob(['WEBVTT\n\n'], { type: 'text/vtt;charset=utf-8' }))
  return emptyVttUrl
}

/** 当前自动字幕的名字，供菜单 tooltip 显示。 */
function activeSubtitleLabel(): string {
  return props.subtitles.find(source => source.path === activeSubtitlePath)?.label
    ?? $t('file_lite_i18n.off')
}

/** 挂上字幕菜单：自动扫描到的每一条 + 关闭。 */
function applySubtitleSetting() {
  const inst = artInstance.value
  if (!inst?.isReady)
    return
  if (!autoSubtitlesAvailable || !props.subtitles.length) {
    if (subtitleSettingAdded) {
      inst.setting.remove(AUTO_SUBTITLE_SETTING)
      subtitleSettingAdded = false
    }
    return
  }
  const setting = {
    name: AUTO_SUBTITLE_SETTING,
    html: $t('file_lite_i18n.subtitles'),
    tooltip: activeSubtitleLabel(),
    selector: [
      { html: $t('file_lite_i18n.off'), value: '', default: !activeSubtitlePath },
      ...props.subtitles.map(source => ({
        html: source.label,
        value: source.path,
        default: source.path === activeSubtitlePath,
      })),
    ],
    onSelect(item: SettingOption) {
      // 菜单自己会更新勾选与 tooltip，不必在这里重绘整份设置
      switchSubtitle(String(item.value ?? ''), false)
      return item.html
    },
  }
  if (subtitleSettingAdded) {
    inst.setting.update(setting)
  }
  else {
    inst.setting.add(setting)
    subtitleSettingAdded = true
  }
}

/** 切到某条自动字幕；空路径表示关闭。 */
function switchSubtitle(path: string, refreshSetting = true) {
  const inst = artInstance.value
  if (!inst?.isReady)
    return
  activeSubtitlePath = path
  if (!path) {
    subtitleAttached = false
    void inst.subtitle.switch(getEmptyVttUrl(), {}).catch(console.error)
  }
  else {
    subtitleAttached = true
    // 服务端已经把非 UTF-8 的字幕转成 UTF-8（Artplayer 默认按 UTF-8 解），
    // srt / ass / vtt 它自己都会解析，所以直接把服务端 URL 交给它。
    const source = props.subtitles.find(item => item.path === path)
    void inst.subtitle.switch(sdk.url(path), {
      name: source?.label || subtitleName(path),
      type: subtitleType(path),
    }).catch(console.error)
  }
  if (refreshSetting)
    applySubtitleSetting()
}

/** 自动挂上列表里的第一条字幕；用户关掉后，同一份列表不会再被自动打开。 */
function applyAutoSubtitle() {
  const inst = artInstance.value
  if (!inst?.isReady)
    return
  if (!autoSubtitlesAvailable || appliedSubtitleList === props.subtitles) {
    applySubtitleSetting()
    return
  }
  appliedSubtitleList = props.subtitles
  if (!props.subtitles.length) {
    clearAutoSubtitle()
    return
  }
  switchSubtitle(props.subtitles[0]!.path)
}

/**
 * 撤掉自动挂上的字幕。
 *
 * 在播放器里换片（本地视频或另一个服务端视频）之后，App 传进来的那条已经对不上号，
 * 而 Artplayer 没有 clear API，只能用一个空 VTT 把它顶掉。
 */
function clearAutoSubtitle() {
  activeSubtitlePath = ''
  if (subtitleAttached) {
    subtitleAttached = false
    const inst = artInstance.value
    if (inst?.isReady)
      void inst.subtitle.switch(getEmptyVttUrl(), {}).catch(console.error)
  }
  applySubtitleSetting()
}

watch(() => props.subtitles, () => applyAutoSubtitle())

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
    playbackRate: false,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    // autoSize: true,
    theme: rgbToHex(getCurrentPrimaryRgb()) || '#53ade4',
    // 字幕默认 20px、离底 15px，1080p 下又小又贴边。这两个变量是 Artplayer 的公开入口，
    // 控制栏出现时它仍然会按 --art-control-height 自动上移，所以不要改用 subtitle.style。
    cssVar: {
      '--art-subtitle-font-size': 'clamp(24px, 2.6vw, 40px)',
      '--art-subtitle-bottom': 'clamp(24px, 4vh, 48px)',
    },
    // autoMini: true,
    aspectRatio: true,
    screenshot: true,
    mutex: true,
    // backdrop: false, // 关闭毛玻璃效果
    miniProgressBar: true,
    airplay: true,
    subtitleOffset: true,
    subtitle: {},
    // Artplayer 会把 button 型设置的 onClick 返回值写进右侧 tooltip；
    // 返回 undefined 会显示成 "undefined"，所以动作项统一 return ''。
    settings: [
      {
        name: 'custom-playback-rate',
        html: $t('file_lite_i18n.playback_speed'),
        tooltip: formatPlaybackRate(clampPlaybackRate(persistedPlaybackRate.value)),
        selector: getPlaybackRateSelector(),
        onSelect(item: SettingOption) {
          const rate = clampPlaybackRate(Number((item as { value?: unknown }).value))
          persistedPlaybackRate.value = rate
          if (artInstance.value)
            artInstance.value.playbackRate = rate
          return formatPlaybackRate(rate)
        },
      },
      {
        name: 'custom-open-local-video',
        html: $t('file_lite_i18n.open_local_video') + ELLIPSIS,
        // tooltip: 'Play a video file from this device',
        onClick() {
          videoFileInputRef.value?.click()
          return ''
        },
      },
      {
        name: 'custom-open-server-video',
        html: $t('file_lite_i18n.open_server_video') + ELLIPSIS,
        onClick() {
          void openServerVideo()
          return ''
        },
      },
      {
        name: 'custom-load-local-subtitle',
        html: $t('file_lite_i18n.load_local_subtitle') + ELLIPSIS,
        // tooltip: 'VTT, SRT, or ASS',
        onClick() {
          subtitleFileInputRef.value?.click()
          return ''
        },
      },
      {
        name: 'custom-load-subtitle',
        html: $t('file_lite_i18n.load_server_subtitle') + ELLIPSIS,
        onClick() {
          void openServerSubtitle()
          return ''
        },
      },
      ...(Array.isArray(extraSettings) ? extraSettings : []),
    ],
    contextmenu: [
      {
        html: $t('file_lite_i18n.copy'),
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
    applyAutoSubtitle()
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
    const inst = artInstance.value
    if (!inst || !newUrl) {
      return
    }
    revokeBlobRef(videoObjectUrl)
    // App 换了一条视频（也可能在同一窗口重开同一部），自动字幕重新按新列表决定
    autoSubtitlesAvailable = true
    appliedSubtitleList = null
    void inst.switchUrl(newUrl).then(() => {
      if (inst.isReady) {
        applyAutoSubtitle()
        emit('ready', inst)
      }
    }).catch(console.error)
  },
)

// 组件卸载前销毁播放器，释放内存
onBeforeUnmount(() => {
  isAlive = false
  revokeBlobRef(videoObjectUrl)
  revokeBlobRef(subtitleObjectUrl)
  if (emptyVttUrl) {
    URL.revokeObjectURL(emptyVttUrl)
    emptyVttUrl = ''
  }
  artInstance.value?.destroy(false)
})

async function openServerVideo() {
  const picked = await pickServerFile('video')
  const item = picked?.items[0]
  const inst = artInstance.value
  if (!inst || !item) {
    return
  }
  revokeBlobRef(videoObjectUrl)
  videoObjectUrl.value = null
  // 换的是另一个文件，App 那条自动字幕已经对不上号，菜单也不能再列旧字幕
  autoSubtitlesAvailable = false
  clearAutoSubtitle()
  void inst.switchUrl(sdk.url(item.path)).catch(console.error)
}

async function openServerSubtitle() {
  const picked = await pickServerFile('subtitle')
  const item = picked?.items[0]
  const inst = artInstance.value
  if (!inst || !item) {
    return
  }
  inst.subtitle.switch(sdk.url(item.path), {
    name: item.name,
    type: subtitleType(item.name),
  })
  // 服务器字幕不在自动列表里，菜单不再把上一条标成当前项
  subtitleAttached = true
  activeSubtitlePath = ''
  applySubtitleSetting()
}
/**
 * `art`：供 NativeOrArtVideo / PlayerCore 等统一控制播放、取 `art.video` 做 HTML 事件同步。
 */
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
  user-select: none;
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
