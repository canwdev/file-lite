<script setup lang="ts">
import type { MediaItem } from '../utils/music-state'
import { MusicEvents, useMediaStore } from '../utils/media-store'
import PlaylistItem from './PlaylistItem.vue'

const emit = defineEmits<{
  (e: 'locateItem', name: string): void
}>()
const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)
const filterText = ref('')
const filterTextDebounced = ref('')
let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(filterText, (value) => {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer)
  }
  filterDebounceTimer = setTimeout(() => {
    filterTextDebounced.value = value
  }, 500)
})

onBeforeUnmount(() => {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer)
  }
})

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function handleItemClick(item: MediaItem) {
  const idx = mediaStore.playingList.findIndex((i: MediaItem) => i.guid === item.guid)
  if (idx === -1) {
    console.error('idx not found!')
    return
  }
  if (idx === mediaStore.playingIndex) {
    mediaStore.mediaBus.emit(MusicEvents.ACTION_TOGGLE_PLAY)
    return
  }
  mediaStore.playByIndex(idx)
}

const playlistFiltered = computed(() => {
  if (!filterTextDebounced.value.trim()) {
    return mediaStore.playingList
  }

  const reg = new RegExp(escapeRegExp(filterTextDebounced.value.trim()), 'gi')
  return mediaStore.playingList.filter((item: MediaItem) => {
    return reg.test(item.titleDisplay) || reg.test(item.artistsAlbumDisplay ?? '')
  })
})

const isPlaylistEmpty = computed(() => mediaStore.playingList.length === 0)
const isFilterEmpty = computed(
  () => !!filterTextDebounced.value.trim() && playlistFiltered.value.length === 0,
)

const listRef = ref<HTMLElement>()

function scrollToCurrent() {
  const el = listRef.value?.querySelector('.playlist-item.active')
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
</script>

<template>
  <div class="music-play-list">
    <div class="playlist-action-bar">
      <div class="playlist-search-row">
        <span class="mdi mdi-magnify search-icon" />
        <input v-model="filterText" class="vgo-input playlist-search" placeholder="Search music">
        <button class="btn-no-style locate-current-btn" title="Scroll to current" @click="scrollToCurrent">
          <span class="mdi mdi-crosshairs-gps" />
        </button>
      </div>
    </div>
    <div ref="listRef" class="music-list scrollbar-mini">
      <template v-if="isPlaylistEmpty">
        <div class="playlist-empty">
          No media in this list
        </div>
      </template>
      <template v-else-if="isFilterEmpty">
        <div class="playlist-empty">
          No matches for filter
        </div>
      </template>
      <template v-else>
        <PlaylistItem
          v-for="item in playlistFiltered"
          :key="item.guid"
          :item="item"
          @click="handleItemClick(item)"
          @locate-item="(name: string) => emit('locateItem', name)"
        />
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.music-play-list {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  position: relative;
  padding: 10px 8px 10px 10px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.22)),
    transparent;
  box-shadow: none;

  .playlist-action-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    font-size: 12px;
    padding: 0 4px 10px;
    margin-bottom: 2px;

    .playlist-search-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      border-radius: 999px;
      padding: 4px 6px 4px 10px;
      background: rgba(0, 0, 0, 0.055);
    }

    .search-icon {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
    }

    .playlist-search {
      flex: 1;
      min-width: 0;
      height: 24px;
      border: 0;
      background: transparent;
      padding: 0;
      box-shadow: none;
    }

    .locate-current-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--el-text-color-secondary);

      &:hover {
        color: var(--vgo-primary);
        background: var(--vgo-primary-opacity);
      }
    }
  }

  .number-display {
    flex-shrink: 0;
    color: var(--el-text-color-secondary, inherit);
    white-space: nowrap;
  }

  .music-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 3px 10px 0;
  }

  .playlist-empty {
    margin: 18px 8px;
    padding: 24px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--el-text-color-secondary, inherit);
    border-radius: 14px;
    background: rgba(128, 128, 128, 0.08);
  }

  .media-open-actions {
    padding: 8px;
  }
}

:global(.dark) {
  .music-play-list {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.025)),
      transparent;

    .playlist-search-row {
      background: rgba(128, 128, 128, 0.14);
    }
  }
}

@media screen and (max-width: 700px) {
  .music-play-list {
    padding: 8px;

    .playlist-action-bar {
      padding: 0 0 8px;
    }
  }
}
</style>
