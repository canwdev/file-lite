<script setup lang="ts">
import SteamCard from '../components/SteamCard.vue'
import defaultCoverUrl from './assets/default-cover.webp'
import { MusicEvents, useMediaStore } from './utils/media-store'

const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)

const item = computed(() => mediaStore.mediaItem)
const lyricLines = computed(() => item.value?.lyricsLines ?? [])

const activeLineIndex = computed(() => {
  const lines = lyricLines.value
  const t = mediaStore.currentTime
  if (!lines.length)
    return -1
  let idx = -1
  let lastTime = -1
  for (let i = 0; i < lines.length; i++) {
    const lineTime = lines[i]!.time
    // 跳过与上一行相同时间戳的行（翻译行），以第一行（原文）为准
    if (Math.abs(lineTime - lastTime) < 0.001)
      continue
    if (lineTime <= t + 0.025) {
      idx = i
      lastTime = lineTime
    }
    else {
      break
    }
  }
  return idx
})

const lyricScrollRef = ref<HTMLElement | null>(null)

/**
 * Plain Map — must NOT be reactive. Ref callbacks run every render; mutating a ref<Map>
 * re-triggers render → infinite recursion (“Maximum recursive updates exceeded”).
 */
let lineElMap = new Map<number, HTMLElement>()

function setLineEl(i: number, el: unknown) {
  if (el instanceof HTMLElement) {
    if (lineElMap.get(i) === el)
      return
    lineElMap.set(i, el)
  }
  else {
    lineElMap.delete(i)
  }
}

/** Pause auto center-scroll while user explores lyrics (AMLL-style courtesy). */
const userScrollLockUntil = ref(0)
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null

function notifyUserScroll() {
  userScrollLockUntil.value = performance.now() + 2600
  if (scrollLockTimer)
    clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(() => {
    userScrollLockUntil.value = 0
  }, 3200)
}

function autoScrollAllowed() {
  return performance.now() > userScrollLockUntil.value
}

function scrollToLineEl(el: HTMLElement, behavior: ScrollBehavior) {
  const container = lyricScrollRef.value!
  const elRect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const absoluteTop = container.scrollTop + (elRect.top - containerRect.top)
  const targetTop = absoluteTop - containerRect.height / 2 + elRect.height / 2

  container.scrollTo({ top: targetTop, behavior })
}

function scrollActiveLineIntoView(behavior: ScrollBehavior) {
  const idx = activeLineIndex.value
  const container = lyricScrollRef.value
  if (idx < 0 || !autoScrollAllowed() || !container)
    return
  const el = lineElMap.get(idx)
  if (!el)
    return
  scrollToLineEl(el, behavior)
}

watch(
  activeLineIndex,
  (idx) => {
    if (idx < 0 || !autoScrollAllowed())
      return
    nextTick(() => {
      scrollActiveLineIntoView('smooth')
    })
  },
  { flush: 'post' },
)

watch(
  () => item.value?.guid,
  () => {
    userScrollLockUntil.value = 0
    lineElMap = new Map()
    nextTick(() => {
      nextTick(() => {
        scrollActiveLineIntoView('auto')
      })
    })
  },
)

/** Lyrics may appear after metadata parse (same guid); ensure first auto-scroll when lines mount. */
watch(
  () => lyricLines.value.length,
  (len, prev) => {
    if (len > 0 && prev === 0) {
      nextTick(() => {
        scrollActiveLineIntoView('auto')
      })
    }
  },
  { flush: 'post' },
)

function lineState(i: number): 'active' | 'near' | 'far' | 'dim' {
  const cur = activeLineIndex.value
  if (cur < 0)
    return 'dim'
  const d = i - cur
  if (d === 0)
    return 'active'
  if (d === 1 || d === -1)
    return 'near'
  if (d === 2 || d === -2)
    return 'far'
  return 'dim'
}

function seekToTime(time: number, index: number) {
  mediaStore.mediaBus.emit(MusicEvents.ACTION_CHANGE_CURRENT_TIME, time)
  const el = lineElMap.get(index)
  if (!el)
    return
  scrollToLineEl(el, 'smooth')
}

onBeforeUnmount(() => {
  if (scrollLockTimer)
    clearTimeout(scrollLockTimer)
})
</script>

<template>
  <div class="music-detail-root scrollbar-mini">
    <div v-if="item" class="music-detail-body" :class="{ 'has-lyrics': lyricLines.length > 0 }">
      <!-- With lyrics: two-column AMLL / Apple Music–like -->
      <template v-if="lyricLines.length > 0">
        <div class="meta-side">
          <SteamCard :src="item.cover || defaultCoverUrl" />
          <div class="meta-text">
            <h1 class="track-title">
              {{ item.titleDisplay }}
            </h1>
            <p v-if="item.artist?.trim()" class="track-artist">
              {{ item.artist }}
            </p>
            <p v-if="item.album?.trim()" class="track-album">
              {{ item.album }}
            </p>
          </div>
        </div>
        <section class="lyrics-side">
          <div
            ref="lyricScrollRef"
            class="lyrics-scroll"
            @wheel.passive="notifyUserScroll"
            @pointerdown="notifyUserScroll"
          >
            <ul class="lyrics-list">
              <li
                v-for="(ln, i) in lyricLines"
                :key="`${item.guid}-${i}-${ln.time}`"
                :ref="(el) => setLineEl(i, el)"
                class="lyric-line"
                :data-state="lineState(i)"
                @click="seekToTime(ln.time, i)"
              >
                {{ ln.text }}
              </li>
            </ul>
          </div>
        </section>
      </template>

      <!-- No lyrics: original centered layout -->
      <div v-else class="music-detail-inner">
        <SteamCard :src="item.cover || defaultCoverUrl" />
        <div class="text-column">
          <h1 class="track-title">
            {{ item.titleDisplay }}
          </h1>
          <p v-if="item.artist?.trim()" class="track-artist">
            {{ item.artist }}
          </p>
          <p v-if="item.album?.trim()" class="track-album">
            {{ item.album }}
          </p>
        </div>
      </div>
    </div>

    <div v-else class="music-detail-empty">
      <p class="empty-hint" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.music-detail-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: clamp(12px, 4vw, 52px);
  box-sizing: border-box;
  overflow: auto;
  scrollbar-width: none;

  background: transparent;
}

/* 确保内容在背景层之上 */
.music-detail-body,
.music-detail-empty {
  position: relative;
  z-index: 1;
}

.music-detail-body {
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  &.has-lyrics {
    align-items: stretch;
    max-width: 1120px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(200px, 42%) minmax(0, 1fr);
    gap: clamp(20px, 4vw, 48px);
  }
}

@media (max-width: 719px) {
  .music-detail-body.has-lyrics {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(220px, 42vh);
    align-items: stretch;
  }
}

.meta-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(14px, 2.5vh, 24px);
  text-align: center;
  min-width: 0;
}

@media (min-width: 720px) {
  .meta-side {
    align-self: center;
  }
}

.meta-text {
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35em;
}

.lyrics-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.lyrics-scroll {
  flex: 1;
  min-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black min(12%, 48px),
    black max(88%, calc(100% - 48px)),
    transparent 100%
  );
  mask-size: 100% 100%;
  mask-repeat: no-repeat;
  scrollbar-width: none;
}

.lyrics-list {
  list-style: none;
  margin: 0;
  padding: min(32vh, 100px) 20px min(36vh, 120px);
}

.lyric-line {
  margin: 0;
  padding: 0.42em 0;
  text-align: center;
  line-height: 1.45;
  letter-spacing: -0.02em;
  transition:
    transform 0.38s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.32s ease,
    font-size 0.32s ease,
    font-weight 0.25s ease;

  &:hover {
    cursor: pointer;
    filter: brightness(1.5);
  }

  &[data-state='active'] {
    font-size: clamp(1.2rem, 3.2vw, 1.55rem);
    font-weight: 650;
    opacity: 1;
    transform: scale(1.03);
    text-shadow: 0 1px 18px rgba(0, 0, 0, 0.35);
  }

  &[data-state='near'] {
    font-size: clamp(1.02rem, 2.6vw, 1.18rem);
    font-weight: 500;
    opacity: 0.78;
    transform: scale(1);
  }

  &[data-state='far'] {
    font-size: clamp(0.95rem, 2.2vw, 1.05rem);
    font-weight: 450;
    opacity: 0.48;
  }

  &[data-state='dim'] {
    font-size: clamp(0.88rem, 2vw, 0.98rem);
    font-weight: 400;
    opacity: 0.26;
  }
}

@media (min-width: 720px) {
  .lyric-line {
    text-align: left;
    padding-left: 4px;
    padding-right: 12px;
  }
}

/* ——— layout without lyrics (legacy) ——— */
.music-detail-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(20px, 4vh, 36px);
  width: 100%;
  max-width: 960px;
  margin: auto;
}

@media (min-width: 720px) {
  .music-detail-inner {
    flex-direction: row;
    gap: clamp(28px, 4vw, 42px);
    text-align: left;
  }

  .music-detail-inner .text-column {
    align-items: flex-start;
    text-align: left;
  }
}

.meta-side .steam-card-container {
  max-width: min(64vmin, 320px);
}

.text-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35em;
}

.track-title {
  margin: 0;
  font-size: clamp(1.35rem, 4.2vw, 2.125rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.15;
  text-wrap: balance;
  max-width: 100%;
}

.track-artist {
  margin: 0.15em 0 0;
  font-size: clamp(1.05rem, 2.8vw, 1.35rem);
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--el-text-color-regular, rgba(245, 245, 247, 0.88));
  max-width: 100%;
}

.track-album {
  margin: 0;
  font-size: clamp(0.9rem, 2.2vw, 1.05rem);
  font-weight: 400;
  letter-spacing: -0.01em;
  color: var(--el-text-color-secondary, rgba(245, 245, 247, 0.55));
  max-width: 100%;
}

.music-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  opacity: 0.75;
  margin: auto;
}

.empty-hint {
  margin: 0;
  font-size: 0.95rem;
  color: var(--el-text-color-secondary);
}
</style>
