<script setup lang="ts">
import type { MediaItem } from './utils/music-state'
import { fsWebApi } from '@/api/filesystem'
import { MusicEvents, useBusOn, useMediaStore } from './utils/media-store'
import { useMusicSettingsStore } from './utils/music-state'

// interface Props {}
// const props = withDefaults(defineProps<Props>(), {})

const storeId = inject('storeId')
const mediaStore = useMediaStore(storeId.value)

const avRef = ref()
const mSettingsStore = useMusicSettingsStore()
const avSrc = ref<string | undefined>()

function play() {
  avRef.value.play()
}
function pause() {
  avRef.value.pause()
}
function previous() {
  mediaStore.playPrev()
}
function next() {
  mediaStore.playNext()
}
function togglePlay() {
  if (!avRef.value || !avRef.value.src) {
    return
  }
  if (avRef.value.paused) {
    play()
  }
  else {
    pause()
  }
}
function registerMediaEvents(av) {
  // console.log(av)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', play)
    navigator.mediaSession.setActionHandler('pause', pause)
    // navigator.mediaSession.setActionHandler('seekbackward', previous)
    // navigator.mediaSession.setActionHandler('seekforward', next)
    navigator.mediaSession.setActionHandler('previoustrack', previous)
    navigator.mediaSession.setActionHandler('nexttrack', next)
  }

  av.addEventListener('play', () => {
    mediaStore.paused = false
    mediaStore.isLoadedAutoplay = true
  })

  av.addEventListener('pause', () => {
    mediaStore.paused = true
    mediaStore.isLoadedAutoplay = false
  })

  av.addEventListener('ended', () => {
    mediaStore.handlePlayEnded()
  })

  av.addEventListener('volumechange', () => {
    // console.log(av.volume)
    mSettingsStore.setAudioVolume(av.volume * 100)
  })
  av.addEventListener('ratechange', () => {
    // console.log('[ratechange]', av.playbackRate)
    mediaStore.playbackRate = av.playbackRate
  })

  av.addEventListener('canplay', (evt) => {
    // console.log('canplay', av)
    mediaStore.duration = evt.target.duration
    if (mediaStore.isLoadedAutoplay) {
      play()
    }
  })

  av.addEventListener('timeupdate', (evt) => {
    // console.log('timeupdate', evt.target.currentTime)
    mediaStore.currentTime = evt.target.currentTime
  })

  av.addEventListener('error', (error) => {
    console.error(error)
    window.$message.error('Load media failed')
  })
}
function changeCurrentTime(newTime) {
  avRef.value && (avRef.value.currentTime = newTime)
}
function changeVolume(val) {
  avRef.value && (avRef.value.volume = val / 100)
}
function changeSpeed(val = 1) {
  if (!avRef.value) {
    return
  }
  try {
    avRef.value.playbackRate = val
  }
  catch (e: any) {
    window.$message.error(e.message)
  }
}

watch(() => mSettingsStore.audioVolume, changeVolume)
watch(() => mediaStore.playbackRate, changeSpeed)

watch(
  () => mediaStore.mediaItem,
  async (item: MediaItem) => {
    if (!item) {
      avSrc.value = undefined
      return
    }
    avSrc.value = fsWebApi.getStreamUrl(item.absPath)
    const playbackRate = mediaStore.playbackRate
    avRef.value?.load()

    // 由于媒体标签变更src会导致速度重置为1，在此还原设置速度
    setTimeout(() => {
      changeSpeed(playbackRate)
    })
  },
  { immediate: true },
)

watch(
  () => mediaStore.isVideo,
  () => {
    setTimeout(() => {
      changeVolume(mSettingsStore.audioVolume)
      changeSpeed(mediaStore.playbackRate)
      registerMediaEvents(avRef.value)
    })
  },
  { immediate: true },
)

useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_TOGGLE_PLAY, togglePlay)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_PLAY, play)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_PAUSE, pause)
useBusOn(mediaStore.mediaBus, MusicEvents.ACTION_CHANGE_CURRENT_TIME, changeCurrentTime)

onBeforeUnmount(() => {})
</script>

<template>
  <div class="player-core" :class="[mediaStore.isVideo ? 'is-video' : 'is-audio']">
    <video v-if="mediaStore.isVideo" ref="avRef" :src="avSrc" controls />
    <audio v-else ref="avRef" :src="avSrc" controls />
  </div>
</template>

<style lang="scss" scoped>
.player-core {
  height: 100%;
  width: 100%;
  &.is-video {
    background-color: #1c1c1c;
    video {
      height: 100%;
      width: 100%;
      object-fit: contain;
    }
  }
  &.is-audio {
    display: flex;
    align-items: center;
    justify-content: center;
    audio {
      width: 80%;
    }
  }
}
</style>
