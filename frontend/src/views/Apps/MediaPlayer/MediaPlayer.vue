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
    class="media-player-wrap media-player-scope"
    :class="{ 'is-video-mode': mediaStore.isVideo, 'has-cover-bg': mediaStore.mediaItem?.cover }"
    :style="coverBackgroundStyle"
  >
    <div v-if="mediaStore.mediaItem?.cover" class="app-cover-bg" />
    <div class="music-above">
      <div class="media-detail">
        <PlayerCore />
      </div>
    </div>

    <Transition name="playlist-panel">
      <div v-if="showPlaylist" class="playlist-overlay">
        <div class="playlist-backdrop" />
        <aside class="playlist-panel">
          <div class="playlist-panel-header">
            <div class="playlist-panel-title">
              <h2>Playing Queue</h2>
              <span class="playlist-panel-count">
                {{ mediaStore.playingList.length ? mediaStore.playingIndex + 1 : 0 }}/{{ mediaStore.playingList.length }}
              </span>
            </div>
            <button class="playlist-close btn-no-style" title="Close playlist" @click="showPlaylist = false">
              <span class="mdi mdi-close" />
            </button>
          </div>
          <MusicPlaylist @locate-item="(name: string) => emit('locateItem', name)" />
        </aside>
      </div>
    </Transition>

    <!-- 视频模式无底部控制条，音量/倍速不与 VArt 内持久化抢写 Pinia -->
    <div v-if="!mediaStore.isVideo" class="music-below">
      <MusicControl :playlist-open="showPlaylist" @toggle-playlist="showPlaylist = !showPlaylist" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
$music-control-bar-height: 96px;

.media-player-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  contain: paint;
  color: var(--el-text-color-primary);
  background:
    radial-gradient(circle at 14% 8%, rgba(255, 45, 85, 0.10), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(64, 156, 255, 0.12), transparent 32%),
    linear-gradient(145deg, #fff, #f4f4f7 58%, #ececf1);

  &.has-cover-bg {
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
    opacity: 0.18;
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
    border-radius: 24px;
    background: transparent;
  }

  .music-below {
    height: $music-control-bar-height;
    flex-shrink: 0;
    padding: 10px 14px 14px;
    position: relative;
    z-index: 3;
  }

  &.is-video-mode {
    .music-above {
      padding-bottom: 10px;
    }
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
  top: 14px;
  right: 14px;
  bottom: calc(#{$music-control-bar-height} + 18px);
  width: min(360px, calc(100vw - 28px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  pointer-events: auto;
  border-radius: 26px;
  padding: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 248, 251, 0.86)),
    rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow:
    0 28px 80px rgba(40, 40, 50, 0.20),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(28px) saturate(1.25);

  :deep(.music-play-list) {
    flex: 1;
    min-height: 0;
    padding: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
}

.playlist-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 12px;
}

.playlist-panel-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;

  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.04em;
  }
}

.playlist-panel-count {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.playlist-close {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }
}

:global(.dark) .media-player-scope {
  background:
    radial-gradient(circle at 12% 8%, rgba(255, 45, 85, 0.12), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(var(--vgo-primary-rgb), 0.16), transparent 32%),
    linear-gradient(145deg, #141416, #1b1b20 58%, #101014);

  &.has-cover-bg {
    background:
      linear-gradient(135deg, rgba(18, 18, 20, 0.58), rgba(18, 18, 20, 0.86)),
      radial-gradient(circle at 18% 8%, rgba(255, 45, 85, 0.18), transparent 30%),
      #141416;
  }

  .playlist-panel {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.07)),
      rgba(22, 22, 24, 0.82);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow:
      0 28px 80px rgba(0, 0, 0, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  .playlist-close {
    background: rgba(255, 255, 255, 0.1);

    &:hover {
      background: rgba(255, 255, 255, 0.18);
    }
  }
}

.playlist-panel-enter-active,
.playlist-panel-leave-active {
  transition: opacity 0.22s ease;

  .playlist-panel,
  .playlist-backdrop {
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease;
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
  $music-control-bar-height-mobile: 148px;

  .media-player-wrap {
    .music-above {
      padding: 10px 10px 0;
    }

    .media-detail {
      border-radius: 20px;
    }

    .music-below {
      height: $music-control-bar-height-mobile;
      padding: 8px;
    }
  }

  .playlist-panel {
    top: 10px;
    right: 10px;
    left: 10px;
    bottom: calc(#{$music-control-bar-height-mobile} + 12px);
    width: auto;
    border-radius: 22px;
  }
}
</style>
