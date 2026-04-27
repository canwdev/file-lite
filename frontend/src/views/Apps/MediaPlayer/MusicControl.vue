<script setup lang="ts">
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener } from '@vueuse/core'
import Mousetrap from 'mousetrap'
import { contextMenuTheme } from '@/hooks/use-global-theme'
import { formatTimeHMS } from '@/utils'
import Seekbar from './SeekBar.vue'
import { MusicEvents, useMediaStore } from './utils/media-store'
import { loopModeMap, LoopModeTypeValues, useMusicSettingsStore } from './utils/music-state'

withDefaults(defineProps<{
  playlistOpen?: boolean
  showControls?: boolean
}>(), {
  playlistOpen: false,
  showControls: true,
})

defineEmits(['onCoverClick', 'onTitleClick', 'togglePlaylist'])

const PLAYBACK_RATE_OPTIONS = [
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1.3, label: '1.3x' },
  { value: 1, label: '1x' },
  { value: 0.8, label: '0.8x' },
  { value: 0.5, label: '0.5x' },
] as const

function rateMatches(a: number, b: number) {
  return Math.abs(a - b) < 0.02
}

function speedMenuButtonLabel(rate: number) {
  const hit = PLAYBACK_RATE_OPTIONS.find(o => rateMatches(rate, o.value))
  if (hit)
    return hit.label
  return `${Number(rate.toFixed(2))}×`
}

const storeId = inject<Ref<string>>('storeId')!
const mediaStore = useMediaStore(storeId.value)

const KEY_SPACE = 'space'
const KEY_PREVIOUS = ['left', 'pageup', 'k', 'l']
const KEY_NEXT = ['right', 'pagedown', 'h', 'j']
const KEY_UP = 'up'
const KEY_DOWN = 'down'

const mSettingsStore = useMusicSettingsStore()
const mCurrentTime = ref(0)
const isSeeking = ref(false)

function showSpeedMenu(event: MouseEvent) {
  const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right ?? event.clientX,
    y: rect?.top ?? event.clientY,
    theme: contextMenuTheme.value,
    closeWhenScroll: false, // ← 防止歌词滚动关闭菜单
    items: PLAYBACK_RATE_OPTIONS.map((opt) => {
      const selected = rateMatches(mediaStore.playbackRate, opt.value)
      return {
        label: opt.label,
        icon: selected ? 'mdi mdi-check' : '',
        onClick: () => {
          mediaStore.playbackRate = opt.value
        },
      }
    }),
  })
}

function showLoopMenu(event: MouseEvent) {
  const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right ?? event.clientX,
    y: rect?.top ?? event.clientY,
    theme: contextMenuTheme.value,
    closeWhenScroll: false, // ← 防止歌词滚动关闭菜单
    items: LoopModeTypeValues.map((mode) => {
      const info = loopModeMap[mode]
      const selected = mSettingsStore.loopMode === mode
      return {
        label: info.i18nKey,
        icon: selected ? 'mdi mdi-check' : (info.className || ''),
        onClick: () => {
          mSettingsStore.loopMode = mode
        },
      }
    }),
  })
}

const mousetrapRef = shallowRef()

function togglePlay(e?: Event) {
  e?.preventDefault()
  mediaStore.mediaBus.emit(MusicEvents.ACTION_TOGGLE_PLAY)
}
function previous() {
  mediaStore.playPrev()
}
function next() {
  mediaStore.playNext()
}
function volumeUpFn(e: KeyboardEvent) {
  e.preventDefault()
  mSettingsStore.volumeUp()
}
function volumeDownFn(e: KeyboardEvent) {
  e.preventDefault()
  mSettingsStore.volumeDown()
}

const volumeIconBtnRef = ref<HTMLButtonElement | null>(null)

/** Win11-like: hover volume icon and scroll to adjust (wheel up → louder, down → quieter). */
useEventListener(
  () => volumeIconBtnRef.value,
  'wheel',
  (e: WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (dy === 0)
      return

    let step: number
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      step = 5
    }
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      step = 15
    }
    else {
      step = Math.round(Math.abs(dy) / 20)
      step = Math.min(12, Math.max(2, step || 2))
    }

    if (dy < 0)
      mSettingsStore.volumeUp(step)
    else
      mSettingsStore.volumeDown(step)
  },
  { passive: false },
)

const previousVolume = ref(100)
function toggleMute() {
  if (mSettingsStore.audioVolume === 0) {
    mSettingsStore.audioVolume = previousVolume.value
  }
  else {
    previousVolume.value = mSettingsStore.audioVolume
    mSettingsStore.audioVolume = 0
  }
}

function switchLoopMode() {
  let index = LoopModeTypeValues.findIndex(i => i === mSettingsStore.loopMode)
  ++index
  if (index > LoopModeTypeValues.length - 1) {
    index = 0
  }
  if (LoopModeTypeValues[index]) {
    mSettingsStore.loopMode = LoopModeTypeValues[index]
    window.$message.info(currentLoopMode.value.i18nKey)
  }
}

function progressSeeking(value: string | number) {
  isSeeking.value = true
  mCurrentTime.value = Number(value)
}
function progressChange(value: string | number) {
  value = Number(value)
  mediaStore.mediaBus.emit(MusicEvents.ACTION_CHANGE_CURRENT_TIME, value)
  isSeeking.value = false
}

const currentLoopMode = computed(() => {
  return loopModeMap[mSettingsStore.loopMode]
})

onMounted(() => {
  const mousetrap = new Mousetrap()
  mousetrap.bind(KEY_SPACE, togglePlay)
  mousetrap.bind(KEY_PREVIOUS, previous)
  mousetrap.bind(KEY_NEXT, next)
  mousetrap.bind('ctrl+x', switchLoopMode)
  mousetrap.bind(KEY_UP, volumeUpFn)
  mousetrap.bind(KEY_DOWN, volumeDownFn)

  mousetrapRef.value = mousetrap
})

onBeforeUnmount(() => {
  if (mousetrapRef.value) {
    mousetrapRef.value.reset()
  }
})

watch(
  () => mediaStore.currentTime,
  (val) => {
    if (!isSeeking.value) {
      mCurrentTime.value = val
    }
  },
)

const mediaItem = computed(() => mediaStore.mediaItem)

const canSeek = computed(() => {
  const d = mediaStore.duration
  return d > 0 && Number.isFinite(d)
})

function clampSeekTime(t: number) {
  const d = mediaStore.duration
  if (!Number.isFinite(d) || d <= 0) {
    return Math.max(0, t)
  }
  return Math.min(d, Math.max(0, t))
}

function jumpForward() {
  mediaStore.mediaBus.emit(
    MusicEvents.ACTION_CHANGE_CURRENT_TIME,
    clampSeekTime(mediaStore.currentTime + 5),
  )
}
function jumpBackward() {
  mediaStore.mediaBus.emit(
    MusicEvents.ACTION_CHANGE_CURRENT_TIME,
    clampSeekTime(mediaStore.currentTime - 5),
  )
}
</script>

<template>
  <div v-if="mediaItem" class="actionbar-wrapper">
    <div v-if="showControls" class="progressbar">
      <span class="time text-overflow">{{ formatTimeHMS(mCurrentTime) }}</span>

      <Seekbar
        :max="mediaStore.duration" :value="mCurrentTime" :disabled="!canSeek" @input="progressSeeking"
        @change="progressChange"
      />

      <span class="time text-overflow">{{ formatTimeHMS(mediaStore.duration) }}</span>
    </div>
    <div class="actionbar">
      <div class="now-playing">
        <button v-if="showControls" class="btn-action btn-no-style icon-wrap" title="Playback speed" @click="showSpeedMenu">
          {{ speedMenuButtonLabel(mediaStore.playbackRate) }}
        </button>

        <button
          v-if="currentLoopMode" class="btn-action btn-no-style icon-wrap" :title="currentLoopMode.i18nKey"
          @click="showLoopMenu"
        >
          <span v-if="currentLoopMode.className" class="mdi" :class="currentLoopMode.className" />
          <span v-else>{{ currentLoopMode.i18nKey }}</span>
        </button>
      </div>

      <div v-if="!showControls" class="control-center" />
      <div v-else class="control-center">
        <button
          class="btn-action btn-no-style icon-wrap" title="Previous" @click="previous"
          @contextmenu.prevent="jumpBackward"
        >
          <span class="mdi mdi-skip-previous" />
        </button>
        <button
          class="btn-action btn-no-style icon-wrap" title="Rewind"
          @click="jumpBackward"
        >
          <span class="mdi mdi-rewind-5" />
        </button>

        <button
          class="btn-action btn-no-style icon-wrap btn-play-pause" :title="mediaStore.paused ? `Play` : `Pause`"
          @click="togglePlay"
        >
          <template v-if="mediaStore.paused">
            <span class="mdi mdi-play" />
          </template>
          <template v-else>
            <span class="mdi mdi-pause" />
          </template>
        </button>

        <button
          class="btn-action btn-no-style icon-wrap" title="Fast Forward"
          @click="jumpForward"
        >
          <span class="mdi mdi-fast-forward-5" />
        </button>
        <button
          class="btn-action btn-no-style icon-wrap" title="Next" @click="next"
        >
          <span class="mdi mdi-skip-next" />
        </button>
      </div>

      <div class="actionbar-right">
        <el-popover v-if="showControls" placement="top" trigger="click" popper-class="popover-volume">
          <template #reference>
            <button
              ref="volumeIconBtnRef" class="btn-action btn-no-style icon-wrap"
              title="Volume (scroll wheel to adjust)"
            >
              <template v-if="mSettingsStore.audioVolume > 0">
                <span class="mdi mdi-volume-high" />
              </template>
              <template v-else>
                <span class="mdi mdi-volume-variant-off" />
              </template>
            </button>
          </template>
          <div class="popover-col popover-col--volume">
            <el-slider
              :model-value="mSettingsStore.audioVolume" :max="100" :step="1" :min="0" :tooltip="false" vertical
              height="100px" @update:model-value="(v) => mSettingsStore.setAudioVolume(Array.isArray(v) ? v[0]! : v)"
            />
            <span class="popover-volume-label" @click="toggleMute">{{ mSettingsStore.audioVolume }}</span>
          </div>
        </el-popover>
        <button
          class="btn-action btn-no-style playlist-toggle" :class="{ active: playlistOpen }" title="Playlist"
          @click="$emit('togglePlaylist')"
        >
          <span class="mdi mdi-playlist-music" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.popover-volume {
  min-width: 60px !important;
  width: 60px !important;
}
</style>

<style lang="scss" scoped>
.popover-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.popover-volume-label {
  font-size: 12px;
  color: var(--el-text-color-secondary, inherit);
}

.actionbar-wrapper {
  width: 100%;
  height: 100%;
  $bottomZIndex: 2100;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
  backdrop-filter: none;

  .icon-wrap {
    font-size: 18px;

    &._lg {
      font-size: 28px;
    }
  }

  .progressbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 18px;
    width: 100%;
    box-sizing: border-box;
    position: relative;
    z-index: $bottomZIndex;
    gap: 10px;

    .time {
      font-size: 11px;
      width: 54px;
      text-align: center;
      color: var(--el-text-color-secondary);
      font-variant-numeric: tabular-nums;
    }
  }

  .actionbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(44px, 1fr);
    align-items: center;
    height: 48px;
    user-select: none;
    position: relative;
    z-index: $bottomZIndex;
    gap: 10px;

    button {
      border-radius: 999px;
    }

    .btn-cover {
      width: 48px;
      height: 48px;
      border-radius: 13px;
      flex-shrink: 0;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
    }

    .now-playing,
    .control-center,
    .actionbar-right {
      height: 100%;
      flex-wrap: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      justify-content: center;

      .mdi {
        font-size: 23px;
      }
    }

    .now-playing {
      display: flex;
      justify-content: flex-start;
    }

    .actionbar-right {
      justify-content: flex-end;
      overflow: visible;
    }

    .btn-action {
      height: 38px;
      min-width: 38px;
      padding: 0 10px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--el-text-color-regular);
      background: rgba(255, 255, 255, 0.62);
      box-shadow:
        0 8px 22px rgba(35, 35, 45, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.72);
      transition: transform 0.14s ease, background-color 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;

      &:hover {
        filter: brightness(1.2) contrast(1.2);
      }

      &.btn-play-pause {
        width: 46px;
        height: 46px;
        color: #fff;
        background: linear-gradient(135deg, #ff2d55, #ff375f);
        box-shadow: 0 10px 24px rgba(255, 45, 85, 0.28);

        .mdi {
          font-size: 28px;
        }
      }

      &.playlist-toggle {
        min-width: 42px;

        &.active {
          color: #fff;
          background: linear-gradient(135deg, #ff2d55, #ff6a88);
          box-shadow: 0 10px 24px rgba(255, 45, 85, 0.26);
        }
      }

      .reverse-x {
        color: #ff2d55;
        transform: rotateX(-180deg);
      }

    }

  }
}

@media screen and (max-width: 700px) {
  .actionbar-wrapper {
    padding: 9px;
    border-radius: 18px;

    .progressbar {
      gap: 6px;

      .time {
        width: 48px;
        font-size: 10px;
      }
    }

    .actionbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "controls controls"
        "nowplaying right";
      height: auto;
      gap: 8px 10px;

      .now-playing {
        grid-area: nowplaying;
      }

      .btn-cover {
        width: 44px;
        height: 44px;
      }

      .actionbar-right {
        grid-area: right;
      }

      .control-center {
        grid-area: controls;
        width: 100%;
        justify-content: center;
        padding-bottom: 2px;

        &>button {
          min-width: 36px;
          height: 36px;
        }
      }
    }
  }
}
</style>

<style lang="scss">
.dark .media-player-wrap .actionbar-wrapper {
  .btn-action {
    color: var(--el-text-color-regular);
    background: rgba(255, 255, 255, 0.12);
    box-shadow: none;

    &.btn-play-pause {
      color: #fff;
      background: linear-gradient(135deg, #ff2d55, #ff375f);
      box-shadow: 0 10px 24px rgba(255, 45, 85, 0.28);
    }
  }

}
</style>
