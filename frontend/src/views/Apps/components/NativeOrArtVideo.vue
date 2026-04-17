<script setup lang="ts">
import type { Ref } from 'vue'
import { nextTick, onMounted, ref, unref, watch } from 'vue'
import { isNativePlayer } from '@/store/index'
import VArtPlayer from './VArtPlayer.vue'

const props = withDefaults(
  defineProps<{
    src: string
    autoplay?: boolean
    /** 仅原生 `<video>` 生效；Art 使用自带控制栏 */
    controls?: boolean
  }>(),
  {
    autoplay: true,
    controls: true,
  },
)

const emit = defineEmits<{
  (e: 'mediaElementReady', video: HTMLVideoElement): void
}>()

const nativeVideoRef = ref<HTMLVideoElement | null>(null)
const vArtRef = ref<InstanceType<typeof VArtPlayer> | null>(null)

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
    if (isNativePlayer.value)
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
    />
    <VArtPlayer
      v-else
      ref="vArtRef"
      :src="src"
      :autoplay="autoplay"
      @ready="onArtReady"
    />
  </div>
</template>

<style lang="scss" scoped>
.native-or-art-video {
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
