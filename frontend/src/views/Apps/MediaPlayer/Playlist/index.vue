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

function scrollToCurrent(behavior: 'smooth' | 'auto' = 'smooth') {
  const list = listRef.value
  const activeItem = list?.querySelector<HTMLElement>('.playlist-item.is-active')
  if (!list || !activeItem)
    return

  const targetTop = activeItem.offsetTop - (list.clientHeight - activeItem.offsetHeight) / 2
  const maxScrollTop = list.scrollHeight - list.clientHeight
  const top = Math.min(Math.max(targetTop, 0), maxScrollTop)

  list.scrollTo({ top, behavior })
}
onMounted(async () => {
  await nextTick()
  scrollToCurrent('auto')
})
</script>

<template>
  <div class="music-play-list">
    <div class="playlist-action-bar">
      <div class="playlist-search-row">
        <i-mdi-magnify class="search-icon" />
        <input v-model="filterText" class="vgo-input playlist-search" placeholder="Search music">
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--sm"
          title="Scroll to current"
          @click="() => scrollToCurrent()"
        >
          <i-mdi-crosshairs-gps />
        </button>
      </div>
    </div>
    <div ref="listRef" class="music-list vgo-u-scrollbar">
      <template v-if="isPlaylistEmpty">
        <div class="vgo-empty">
          <div class="vgo-empty__desc">
            No media in this list
          </div>
        </div>
      </template>
      <template v-else-if="isFilterEmpty">
        <div class="vgo-empty">
          <div class="vgo-empty__desc">
            No matches for filter
          </div>
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
  padding: var(--vgo-space-2);

  .playlist-action-bar {
    position: sticky;
    top: 0;
    z-index: var(--vgo-z-sticky);
    display: flex;
    flex-direction: column;
    font-size: var(--vgo-font-sm);
    margin-bottom: 2px;

    .playlist-search-row {
      display: flex;
      align-items: center;
      gap: var(--vgo-space-2);
      min-width: 0;
      border-radius: var(--vgo-radius-pill);
      padding: 2px var(--vgo-space-1) 2px var(--vgo-space-3);
      background-color: var(--vgo-hover);
    }

    .search-icon {
      flex-shrink: 0;
      color: var(--vgo-text-secondary);
    }

    .playlist-search {
      flex: 1;
      min-width: 0;
      height: var(--vgo-control-md);
      border: 0;
      background: transparent;
      padding: 0;
      box-shadow: none;
    }
  }

  .music-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--vgo-space-1);
    padding-bottom: var(--vgo-space-3);
  }
}
</style>
