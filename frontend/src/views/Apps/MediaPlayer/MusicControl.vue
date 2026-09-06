<script setup lang="ts">
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener } from '@vueuse/core'
import { menuThemeOptions } from '@/hooks/use-global-theme'
import { injectShortcutScope, useShortcut } from '@/hooks/use-shortcut'
import { formatTimeHMS } from '@/utils'
import { resolveMenuIcons } from '@/utils/icons'
import Seekbar from './SeekBar.vue'
import { MusicEvents, useMediaStore } from './utils/media-store'
import { loopModeMap, LoopModeTypeValues, useMusicSettingsStore } from './utils/music-state'

const props = withDefaults(defineProps<{
  playlistOpen?: boolean
  showControls?: boolean
}>(), {
  playlistOpen: false,
  showControls: true,
})

defineEmits(['onCoverClick', 'onTitleClick', 'togglePlaylist'])
const shortcutScope = injectShortcutScope()

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

const mSettingsStore = useMusicSettingsStore()
const mCurrentTime = ref(0)
const isSeeking = ref(false)

function showSpeedMenu(event: MouseEvent) {
  const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right ?? event.clientX,
    y: rect?.top ?? event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(PLAYBACK_RATE_OPTIONS.map((opt) => {
      const selected = rateMatches(mediaStore.playbackRate, opt.value)
      return {
        label: opt.label,
        icon: selected ? 'mdi mdi-check' : '',
        onClick: () => {
          mediaStore.playbackRate = opt.value
        },
      }
    })),
  })
}

function showLoopMenu(event: MouseEvent) {
  const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
  const rect = button?.getBoundingClientRect()
  ContextMenu.showContextMenu({
    x: rect?.right ?? event.clientX,
    y: rect?.top ?? event.clientY,
    ...menuThemeOptions,
    items: resolveMenuIcons(LoopModeTypeValues.map((mode) => {
      const info = loopModeMap[mode]
      const selected = mSettingsStore.loopMode === mode
      return {
        label: info.i18nKey,
        icon: selected ? 'mdi mdi-check' : (info.className || ''),
        onClick: () => {
          mSettingsStore.loopMode = mode
        },
      }
    })),
  })
}

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

const controlsDisabled = computed(() => !props.showControls)

useShortcut({
  scope: shortcutScope,
  combo: 'space',
  handler: togglePlay,
  disabled: controlsDisabled,
})

useShortcut({
  scope: shortcutScope,
  combo: ['left', 'pageup', 'k', 'l'],
  handler: previous,
  disabled: controlsDisabled,
})

useShortcut({
  scope: shortcutScope,
  combo: ['right', 'pagedown', 'h', 'j'],
  handler: next,
  disabled: controlsDisabled,
})

useShortcut({
  scope: shortcutScope,
  combo: 'up',
  handler: volumeUpFn,
  disabled: controlsDisabled,
})

useShortcut({
  scope: shortcutScope,
  combo: 'down',
  handler: volumeDownFn,
  disabled: controlsDisabled,
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
      <span class="time vgo-u-text-overflow">{{ formatTimeHMS(mCurrentTime) }}</span>

      <Seekbar
        :max="mediaStore.duration" :value="mCurrentTime" :disabled="!canSeek" @input="progressSeeking"
        @change="progressChange"
      />

      <span class="time vgo-u-text-overflow">{{ formatTimeHMS(mediaStore.duration) }}</span>
    </div>
    <div class="actionbar">
      <div class="now-playing">
        <button
          v-if="showControls" class="vgo-button vgo-button--text vgo-button--round vgo-button--lg" title="Playback speed"
          @click="showSpeedMenu"
        >
          {{ speedMenuButtonLabel(mediaStore.playbackRate) }}
        </button>

        <button
          v-if="currentLoopMode" class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg" :title="currentLoopMode.i18nKey"
          @click="showLoopMenu"
        >
          <MdiIcon
            v-if="currentLoopMode.className"
            :name="currentLoopMode.className"
            :class="{ 'reverse-x': currentLoopMode.className.includes('reverse-x') }"
          />
          <span v-else>{{ currentLoopMode.i18nKey }}</span>
        </button>
      </div>

      <div class="control-center">
        <button
          class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg" title="Previous" @click="previous"
          @contextmenu.prevent="jumpBackward"
        >
          <i-mdi-skip-previous />
        </button>
        <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg" title="Rewind" @click="jumpBackward">
          <i-mdi-rewind-5 />
        </button>

        <button
          class="vgo-button vgo-button--primary vgo-button--icon vgo-button--round vgo-button--lg" :title="mediaStore.paused ? `Play` : `Pause`"
          @click="togglePlay"
        >
          <template v-if="mediaStore.paused">
            <i-mdi-play />
          </template>
          <template v-else>
            <i-mdi-pause />
          </template>
        </button>

        <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg" title="Fast Forward" @click="jumpForward">
          <i-mdi-fast-forward-5 />
        </button>
        <button class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg" title="Next" @click="next">
          <i-mdi-skip-next />
        </button>
      </div>

      <div class="actionbar-right">
        <el-popover v-if="showControls" placement="top" trigger="click" popper-class="popover-volume">
          <template #reference>
            <button
              ref="volumeIconBtnRef" class="vgo-button vgo-button--text vgo-button--icon vgo-button--round vgo-button--lg"
              title="Volume (scroll wheel to adjust)"
            >
              <template v-if="mSettingsStore.audioVolume > 0">
                <i-mdi-volume-high />
              </template>
              <template v-else>
                <i-mdi-volume-variant-off />
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
          class="vgo-button vgo-button--icon vgo-button--round vgo-button--lg"
          :class="playlistOpen ? 'vgo-button--primary' : 'vgo-button--text'"
          title="Playlist"
          @click="$emit('togglePlaylist')"
        >
          <i-mdi-playlist-music />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.popover-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--vgo-space-2);
}

.popover-volume-label {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.actionbar-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--vgo-space-2);

  .progressbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    box-sizing: border-box;
    gap: var(--vgo-space-3);

    .time {
      font-size: var(--vgo-font-sm);
      width: 54px;
      text-align: center;
      color: var(--vgo-text-secondary);
      font-variant-numeric: tabular-nums;
    }
  }

  .actionbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(44px, 1fr);
    align-items: center;
    user-select: none;
    gap: var(--vgo-space-3);

    .now-playing,
    .control-center,
    .actionbar-right {
      flex-wrap: nowrap;
      display: flex;
      align-items: center;
      gap: var(--vgo-space-2);
      flex-shrink: 0;
      justify-content: center;
    }

    .now-playing {
      justify-content: flex-start;
    }

    .actionbar-right {
      justify-content: flex-end;
      overflow: visible;
    }

    .reverse-x {
      color: var(--vgo-primary);
      transform: rotateX(-180deg);
    }
  }
}

@media screen and (max-width: 700px) {
  .actionbar-wrapper {
    .progressbar {
      gap: var(--vgo-space-2);

      .time {
        width: 48px;
      }
    }

    .actionbar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "controls controls"
        "nowplaying right";
      gap: var(--vgo-space-2) var(--vgo-space-3);

      .now-playing {
        grid-area: nowplaying;
      }

      .actionbar-right {
        grid-area: right;
      }

      .control-center {
        grid-area: controls;
        width: 100%;
        justify-content: center;
      }
    }
  }
}
</style>
