<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { guid } from '@/utils'
import { isSupportedMediaFormat } from '@/utils/is'
import MusicControl from './MusicControl.vue'
import PlayerCore from './PlayerCore.vue'
import MusicPlaylist from './Playlist/index.vue'
import { useMediaStore } from './utils/media-store'
import { MediaItem } from './utils/music-state'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)
const emit = defineEmits<{
  (e: 'locateItem', name: string): void
  (e: 'setTitle', val: string): void
}>()

// const {params} = toRefs(props)

const storeId = ref(`mediaStore_${guid()}`)
// 向所有子组件传参
provide('storeId', storeId)

const mediaStore = useMediaStore(storeId.value)
const showPlaylist = ref(false)

const coverBackgroundStyle = computed(() => {
  const cover = mediaStore.mediaItem?.cover
  return cover ? { '--media-cover-bg': `url(${cover})` } : {}
})

// 应用启动传参
watch(
  () => props.appParams,
  () => {
    if (!props.appParams) {
      return
    }
    const { item, list, basePath } = props.appParams
    const medias = list
      .map(i => new MediaItem(i.name, basePath))
      .filter((i) => {
        return isSupportedMediaFormat(i.filename)
      })
    const idx = medias.findIndex(i => i.filename === item.name)

    mediaStore.playFromList(medias, idx)
  },
  { immediate: true },
)
</script>

<template>
  <div
    class="media-player-wrap"
    :class="{ 'is-video-mode': mediaStore.isVideo, 'has-cover-bg': mediaStore.mediaItem?.cover }"
    :style="coverBackgroundStyle"
  >
    <div v-if="mediaStore.mediaItem?.cover" class="app-cover-bg" />
    <div class="music-above">
      <div class="media-detail">
        <PlayerCore @set-title="(val: string) => emit('setTitle', val)" />
      </div>
    </div>

    <Transition name="playlist-panel">
      <div v-if="showPlaylist" class="playlist-overlay">
        <div class="playlist-backdrop" />
        <aside class="playlist-panel vgo-panel">
          <div class="playlist-panel-header">
            <div class="playlist-panel-title">
              <h2>Playing Queue</h2>
              <span class="playlist-panel-count">
                {{ mediaStore.playingList.length ? mediaStore.playingIndex + 1 : 0 }}/{{ mediaStore.playingList.length }}
              </span>
            </div>
            <button
              class="vgo-button vgo-button--text vgo-button--icon"
              title="Close playlist"
              @click="showPlaylist = false"
            >
              <i-mdi-close />
            </button>
          </div>
          <MusicPlaylist @locate-item="(name: string) => emit('locateItem', name)" />
        </aside>
      </div>
    </Transition>

    <div class="music-below">
      <MusicControl :playlist-open="showPlaylist" :show-controls="!mediaStore.isVideo" @toggle-playlist="showPlaylist = !showPlaylist" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.media-player-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  contain: paint;
  // vgo-allow: 播放器氛围底，刻意保留的渐变
  background:
    radial-gradient(circle at 14% 8%, rgba(255, 45, 85, 0.10), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(64, 156, 255, 0.12), transparent 32%),
    linear-gradient(145deg, #fff, #f4f4f7 58%, #ececf1);

  &.has-cover-bg {
    // vgo-allow: 同上，封面模式下的氛围底
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(246, 246, 249, 0.88)),
      radial-gradient(circle at 18% 8%, rgba(255, 45, 85, 0.12), transparent 30%),
      #f6f6f9;
  }

  .app-cover-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-image: var(--media-cover-bg);
    background-size: cover;
    background-position: center;
    filter: blur(54px) saturate(1.08);
    opacity: 0.2;
    transform: scale(1.12);
    pointer-events: none;
  }

  .music-above {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
    z-index: 1;
  }

  .media-detail {
    overflow: hidden;
    height: 100%;
    position: relative;
    background: transparent;
  }

  .music-below {
    flex-shrink: 0;
    padding: var(--vgo-space-3) var(--vgo-space-4) var(--vgo-space-4);
    position: relative;
    z-index: 3;
  }
}

.dark .media-player-wrap {
  // vgo-allow: 暗色下的氛围底，同属豁免范围
  background:
    radial-gradient(circle at 12% 8%, rgba(255, 45, 85, 0.12), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(var(--vgo-primary-rgb), 0.16), transparent 32%),
    linear-gradient(145deg, #141416, #1b1b20 58%, #101014);

  &.has-cover-bg {
    // vgo-allow: 同上，封面模式下的氛围底
    background:
      linear-gradient(135deg, rgba(18, 18, 20, 0.58), rgba(18, 18, 20, 0.86)),
      radial-gradient(circle at 18% 8%, rgba(255, 45, 85, 0.18), transparent 30%),
      #141416;
  }
}

.playlist-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.playlist-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.playlist-panel {
  position: absolute;
  top: var(--vgo-space-4);
  right: var(--vgo-space-4);
  bottom: 100px;
  width: min(360px, calc(100vw - 28px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  pointer-events: auto;
  padding: var(--vgo-space-2);
  padding-bottom: 0;

  :deep(.music-play-list) {
    flex: 1;
    min-height: 0;
    padding: 0;
  }
}

.playlist-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vgo-space-3);
  padding: var(--vgo-space-1);
}

.playlist-panel-title {
  display: flex;
  align-items: baseline;
  gap: var(--vgo-space-2);
  min-width: 0;

  h2 {
    margin: 0;
    font-size: var(--vgo-font-lg);
  }
}

.playlist-panel-count {
  flex-shrink: 0;
  color: var(--vgo-text-secondary);
  font-size: var(--vgo-font-sm);
  font-variant-numeric: tabular-nums;
}

.playlist-panel-enter-active,
.playlist-panel-leave-active {
  transition: opacity var(--vgo-duration-base) ease;

  .playlist-panel,
  .playlist-backdrop {
    transition:
      transform var(--vgo-duration-base) ease,
      opacity var(--vgo-duration-base) ease;
  }
}

.playlist-panel-enter-from,
.playlist-panel-leave-to {
  opacity: 0;

  .playlist-backdrop {
    opacity: 0;
  }

  .playlist-panel {
    opacity: 0;
    transform: translateX(26px) scale(0.98);
  }
}

@media screen and (max-width: 700px) {
  .media-player-wrap .music-below {
    padding: var(--vgo-space-2);
  }

  .playlist-panel {
    top: var(--vgo-space-3);
    right: var(--vgo-space-3);
    left: var(--vgo-space-3);
    width: auto;
  }
}
</style>
