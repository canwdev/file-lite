<script setup lang="ts">
import type { IRandomAccessTokenizer } from 'strtok3'
import type { MediaItem } from './utils/music-state'
import { parseFromTokenizer, selectCover } from 'music-metadata'
import { useFileUrl } from '@/hooks/use-file-url'
import { createLastOpenedMediaRecorder } from '@/hooks/use-last-opened-media'
import { localSettingsStore } from '@/store/index'
import NativeOrArtVideo from '../components/NativeOrArtVideo.vue'
import defaultCoverUrl from './assets/default-cover.webp'
import MusicDetail from './MusicDetail.vue'
import { lyricsLinesFromCommonTags } from './utils/lyrics-metadata'
import { MusicEvents, useBusOn, useMediaStore } from './utils/media-store'
import { useMusicSettingsStore } from './utils/music-state'
import { makeStreamMetadataTokenizer } from './utils/stream-metadata-tokenizer'

const emit = defineEmits<{
  (e: 'setTitle', val: string): void
}>()
const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)
const audioRef = ref<HTMLAudioElement | null>(null)
const videoHostRef = ref<InstanceType<typeof NativeOrArtVideo> | null>(null)

const mSettingsStore = useMusicSettingsStore()
/**
 * 当前媒体的地址。
 *
 * 挂载卷的文件要读成 objectURL，而那是异步的：一次性调用
 * `resolveFileUrl` 只会拿到空串，之后永远不再重试（过去就是这样，挂载卷里的
 * 音乐因此完全没有 src）。所以走响应式的 `useFileUrl`，解析完成后自动重算。
 */
const resolvedMediaUrl = useFileUrl(() => mediaStore.mediaItem?.absPath ?? null)
const avSrc = computed(() => resolvedMediaUrl.value || undefined)
const recordLastOpenedMedia = createLastOpenedMediaRecorder()

let mediaEventsAbort: AbortController | null = null

/** 仅音频、或「视频 + 原生 video」与全局音量/倍速 store 互相同步；Art 视频由 VArtPlayer 本地持久化，且此时无 MusicControl */
function syncVolumeAndRateWithStore(): boolean {
  if (!mediaStore.isVideo)
    return true
  return localSettingsStore.value.isNativePlayer
}

function getActiveHtmlMedia(): HTMLMediaElement | null {
  if (mediaStore.isVideo)
    return videoHostRef.value?.getHtmlVideo() ?? null
  return audioRef.value
}

async function play() {
  if (mediaStore.isVideo)
    await videoHostRef.value?.play()
  else
    await audioRef.value?.play()
}
function pause() {
  if (mediaStore.isVideo)
    videoHostRef.value?.pause()
  else
    audioRef.value?.pause()
}
function previous() {
  mediaStore.playPrev()
}
function next() {
  mediaStore.playNext()
}
function togglePlay() {
  const el = getActiveHtmlMedia()
  if (!el) {
    return
  }
  if (!(el.src || el.currentSrc || avSrc.value)) {
    return
  }
  if (el.paused) {
    void play()
  }
  else {
    pause()
  }
}
function registerMediaEvents(av: HTMLMediaElement | undefined) {
  mediaEventsAbort?.abort()
  mediaEventsAbort = null
  if (!av) {
    return
  }
  const ac = new AbortController()
  mediaEventsAbort = ac
  const { signal } = ac

  function recordIfMediaReady(el: HTMLMediaElement) {
    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      recordLastOpenedMedia(mediaStore.mediaItem)
    }
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', play)
    navigator.mediaSession.setActionHandler('pause', pause)
    navigator.mediaSession.setActionHandler('previoustrack', previous)
    navigator.mediaSession.setActionHandler('nexttrack', next)
  }

  av.addEventListener('play', () => {
    mediaStore.paused = false
    mediaStore.isLoadedAutoplay = true
    recordLastOpenedMedia(mediaStore.mediaItem)
  }, { signal })

  av.addEventListener('pause', () => {
    mediaStore.paused = true
    mediaStore.isLoadedAutoplay = false
  }, { signal })

  av.addEventListener('ended', () => {
    mediaStore.handlePlayEnded()
  }, { signal })

  av.addEventListener('volumechange', () => {
    if (syncVolumeAndRateWithStore())
      mSettingsStore.setAudioVolume(av.volume * 100)
  }, { signal })
  av.addEventListener('ratechange', () => {
    if (syncVolumeAndRateWithStore())
      mediaStore.playbackRate = av.playbackRate
  }, { signal })

  av.addEventListener('canplay', (evt: Event) => {
    const target = evt.target as HTMLMediaElement
    mediaStore.duration = target.duration
    recordLastOpenedMedia(mediaStore.mediaItem)
    if (mediaStore.isLoadedAutoplay) {
      void play()
    }
  }, { signal })

  av.addEventListener('timeupdate', (evt: Event) => {
    const target = evt.target as HTMLMediaElement
    mediaStore.currentTime = target.currentTime
  }, { signal })

  av.addEventListener('error', (error: Event) => {
    console.error(error)
    window.$message.error('Load media failed')
  }, { signal })

  recordIfMediaReady(av)
}

function clearMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) {
    return
  }
  try {
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('previoustrack', null)
    navigator.mediaSession.setActionHandler('nexttrack', null)
  }
  catch {
    // Some environments reject clearing handlers
  }
}

function clearAudioMediaSessionMetadata() {
  if (!('mediaSession' in navigator)) {
    return
  }
  try {
    navigator.mediaSession.metadata = null
  }
  catch {
    /* ignore */
  }
}

/** OS / browser media popup: title, artist, album, artwork (embedded cover or default). */
function setAudioMediaSessionMetadata(item: MediaItem) {
  if (!('mediaSession' in navigator) || item.type !== 'music') {
    return
  }
  const title = item.titleDisplay
  const artist = item.artist?.trim() ?? ''
  const album = item.album?.trim() ?? ''
  const coverSrc = item.cover?.trim() || defaultCoverUrl
  const artwork: MediaImage[] = [
    item.cover
      ? { src: coverSrc, sizes: '512x512' }
      : { src: coverSrc, sizes: '512x512', type: 'image/webp' },
  ]
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: artist || undefined,
      album: album || undefined,
      artwork,
    })
  }
  catch (e) {
    console.warn('[mediaSession.metadata]', e)
  }
}

function onVideoHtmlReady(video: HTMLVideoElement) {
  registerMediaEvents(video)
  if (syncVolumeAndRateWithStore()) {
    changeVolume(mSettingsStore.audioVolume)
    changeSpeed(mediaStore.playbackRate)
  }
}

function changeCurrentTime(newTime: number) {
  const el = getActiveHtmlMedia()
  if (el) {
    el.currentTime = newTime
  }
}
function changeVolume(val: number) {
  const el = getActiveHtmlMedia()
  if (el) {
    el.volume = val / 100
  }
}
function changeSpeed(val: number = 1) {
  const el = getActiveHtmlMedia()
  if (!el) {
    return
  }
  try {
    el.playbackRate = val
  }
  catch (e: any) {
    window.$message.error(e.message)
  }
}

watch(
  () => mSettingsStore.audioVolume,
  (vol) => {
    if (syncVolumeAndRateWithStore())
      changeVolume(vol)
  },
)
watch(
  () => mediaStore.playbackRate,
  (rate) => {
    if (syncVolumeAndRateWithStore())
      changeSpeed(rate)
  },
)

watch(
  () => mediaStore.mediaItem,
  async (item: MediaItem | null) => {
    if (!item) {
      emit('setTitle', '')
      clearAudioMediaSessionMetadata()
      return
    }
    emit('setTitle', item.filename || '')
    const playbackRate = mediaStore.playbackRate
    if (!mediaStore.isVideo) {
      audioRef.value?.load()
    }

    if (item.type === 'music') {
      setAudioMediaSessionMetadata(item)
    }
    else {
      clearAudioMediaSessionMetadata()
    }

    await nextTick()
    setTimeout(() => {
      if (syncVolumeAndRateWithStore())
        changeSpeed(playbackRate)
    })
  },
  { immediate: true },
)

/**
 * 标签（封面 / 歌词 / 标题）的加载时机。
 *
 * **必须盯地址，而不是盯媒体条目。** 挂载卷里的文件地址是异步解析出来的
 * objectURL：切歌那一帧 `avSrc` 还是空的。过去只在 `mediaItem` 变化时读一次标签，
 * 那一刻拿到空地址就 `return`，而且**再也没有第二次机会**——封面与歌词就随机消失。
 * 是「偶现」还是「稳定丢」取决于歌词解析器是不是已经就绪（第一次打开时已经 await 过，
 * 之后的切歌就可能抢在地址解析完成之前）。
 *
 * 盯 `avSrc` 之后，地址一到就加载；同时用 watcher cleanup 中止上一首的在途解析。
 */
watch(
  resolvedMediaUrl,
  (url, _previous, onCleanup) => {
    const item = mediaStore.mediaItem
    if (!url || !item || item.type !== 'music') {
      return
    }
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void loadMusicMetadata(controller.signal)
  },
  { immediate: true },
)

async function loadMusicMetadata(signal: AbortSignal) {
  const item = mediaStore.mediaItem
  if (!item || item.type !== 'music' || !avSrc.value || signal.aborted) {
    return
  }
  const loadGuid = item.guid
  let tokenizer: IRandomAccessTokenizer | null = null
  try {
    // 传 signal：切歌时中止在途的 Range 请求，避免旧解析抢在新解析前面落地
    tokenizer = await makeStreamMetadataTokenizer(avSrc.value, undefined, undefined, signal)
    if (signal.aborted || mediaStore.mediaItem?.guid !== loadGuid) {
      return
    }
    const meta = await parseFromTokenizer(tokenizer, {
      duration: false,
    })
    if (signal.aborted || mediaStore.mediaItem?.guid !== loadGuid) {
      return
    }
    const { common } = meta
    const artistJoined = common.artists?.filter(Boolean).length
      ? common.artists!.filter(Boolean).join(', ')
      : (common.artist ?? common.albumartist)?.trim()

    const cover = selectCover(common.picture)
    let coverImage: { data: Uint8Array, mimeType: string } | undefined
    if (cover?.data?.length) {
      coverImage = {
        data: cover.data,
        mimeType: cover.format || 'image/jpeg',
      }
    }

    item.applyEmbeddedTags({
      title: common.title,
      artist: artistJoined,
      album: common.album,
      year: common.year ?? undefined,
      coverImage,
      lyricsLines: lyricsLinesFromCommonTags(common.lyrics),
    })
    if (mediaStore.mediaItem?.guid === loadGuid) {
      setAudioMediaSessionMetadata(item)
    }
  }
  catch (e) {
    console.warn('[loadMusicMetadata]', e)
    if (mediaStore.mediaItem?.guid === loadGuid) {
      setAudioMediaSessionMetadata(mediaStore.mediaItem)
    }
  }
  finally {
    await tokenizer?.close().catch(() => {})
  }
}

watch(
  () => mediaStore.isVideo,
  () => {
    if (mediaStore.isVideo) {
      return
    }
    nextTick(() => {
      registerMediaEvents(audioRef.value ?? undefined)
      changeVolume(mSettingsStore.audioVolume)
      changeSpeed(mediaStore.playbackRate)
    })
  },
  { immediate: true },
)

useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_TOGGLE_PLAY, togglePlay)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_PLAY, play)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_PAUSE, pause)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_CHANGE_CURRENT_TIME, (...args: unknown[]) => {
  changeCurrentTime(args[0] as number)
})

onBeforeUnmount(() => {
  mediaEventsAbort?.abort()
  mediaEventsAbort = null
  clearMediaSessionHandlers()
  clearAudioMediaSessionMetadata()
})
</script>

<template>
  <div class="player-core" :class="[mediaStore.isVideo ? 'is-video' : 'is-audio']">
    <NativeOrArtVideo
      v-if="mediaStore.isVideo && avSrc"
      ref="videoHostRef"
      class="player-core-video-host"
      :src="avSrc"
      :autoplay="mediaStore.isLoadedAutoplay"
      :controls="true"
      @media-element-ready="onVideoHtmlReady"
    />
    <template v-else>
      <audio v-show="false" ref="audioRef" :src="avSrc" controls />
      <MusicDetail class="player-core-music-detail" />
    </template>
  </div>
</template>

<style lang="scss" scoped>
.player-core {
  height: 100%;
  width: 100%;
  border-radius: inherit;
  overflow: hidden;

  // 视频信箱底色与主题无关，必须是黑
  &.is-video {
    display: flex;
    flex-direction: column;
    // vgo-allow: 视频信箱底色与主题无关，必须是黑
    background-color: #000;

    .player-core-video-host {
      flex: 1;
      min-height: 0;
      width: 100%;
    }
  }
  &.is-audio {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: stretch;
    min-height: 0;
    audio {
      width: 80%;
    }
    .player-core-music-detail {
      flex: 1;
      min-height: 0;
      width: 100%;
    }
  }
}
</style>
