<script setup lang="ts">
import ContextMenu from '@imengyu/vue3-context-menu'
import { useEventListener } from '@vueuse/core'
import Mousetrap from 'mousetrap'
import { contextMenuTheme } from '@/hooks/use-global-theme'
import { formatTimeHMS } from '@/utils'
import CoverMini from './CoverMini.vue'
import Seekbar from './SeekBar.vue'
import { MusicEvents, useMediaStore } from './utils/media-store'
import { loopModeMap, LoopModeTypeValues, useMusicSettingsStore } from './utils/music-state'

defineEmits(['onCoverClick', 'onTitleClick'])

const PLAYBACK_RATE_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 0.8, label: '0.8x' },
  { value: 1, label: '1x' },
  { value: 1.3, label: '1.3x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
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
    items: LoopModeTypeValues.map((mode) => {
      const info = loopModeMap[mode]
      const selected = mSettingsStore.loopMode === mode
      return {
        label: info.i18nKey,
        icon: selected ? 'mdi mdi-check' : (info.className || ''),
        onClick: () => {
          mSettingsStore.loopMode = mode
          window.$message.info(info.i18nKey)
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
    <div class="progressbar">
      <span class="time text-overflow">{{ formatTimeHMS(mCurrentTime) }}</span>

      <Seekbar
        :max="mediaStore.duration"
        :value="mCurrentTime"
        :disabled="!canSeek"
        @input="progressSeeking"
        @change="progressChange"
      />

      <span class="time text-overflow">{{ formatTimeHMS(mediaStore.duration) }}</span>
    </div>
    <div class="actionbar">
      <CoverMini
        :src="mediaItem.cover"
        :is-video="mediaItem.type === 'video'"
        @click="$emit('onCoverClick')"
      />
      <button class="btn-song-info btn-no-style" @click="$emit('onTitleClick')">
        <span class="title text-overflow">{{ mediaItem.titleDisplay }}</span>
        <span v-show="mediaItem.artist" class="artist text-overflow">{{ mediaItem.artist }}</span>
        <span v-show="mediaItem.album" class="album text-overflow">{{ mediaItem.album }}</span>
      </button>
      <div class="buttons-scroll">
        <button
          class="btn-action btn-no-style icon-wrap"
          title="Previous (right-click: −5s)"
          @click="previous"
          @contextmenu.prevent="jumpBackward"
        >
          <span class="mdi mdi-skip-previous" />
        </button>

        <button
          class="btn-action btn-no-style icon-wrap"
          :title="mediaStore.paused ? `Play` : `Pause`"
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
          class="btn-action btn-no-style icon-wrap"
          title="Next (right-click: +5s)"
          @click="next"
          @contextmenu.prevent="jumpForward"
        >
          <span class="mdi mdi-skip-next" />
        </button>

        <button
          class="btn-action btn-no-style icon-wrap"
          title="Playback speed"
          @click="showSpeedMenu"
        >
          {{ speedMenuButtonLabel(mediaStore.playbackRate) }}
        </button>

        <button
          v-if="currentLoopMode"
          class="btn-action btn-no-style icon-wrap"
          :title="currentLoopMode.i18nKey"
          @click="showLoopMenu"
        >
          <span
            v-if="currentLoopMode.className"
            class="mdi"
            :class="currentLoopMode.className"
          />
          <span v-else>{{ currentLoopMode.i18nKey }}</span>
        </button>

        <el-popover placement="top" trigger="hover" popper-class="popover-volume">
          <template #reference>
            <button
              ref="volumeIconBtnRef"
              class="btn-action btn-no-style icon-wrap"
              title="Volume (scroll wheel to adjust)"
              @click="toggleMute"
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
              :model-value="mSettingsStore.audioVolume"
              :max="100"
              :step="1"
              :min="0"
              :tooltip="false"
              vertical
              height="100px"
              @update:model-value="(v) => mSettingsStore.setAudioVolume(Array.isArray(v) ? v[0]! : v)"
            />
            <span class="popover-volume-label">{{ mSettingsStore.audioVolume }}</span>
          </div>
        </el-popover>
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
  $bottomZIndex: 2100;

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
    height: 25px;
    width: 100%;
    box-sizing: border-box;
    border-top: 1px solid var(--vgo-color-border);
    border-bottom: 1px solid var(--vgo-color-border);
    position: relative;
    z-index: $bottomZIndex;

    .time {
      font-size: 12px;
      width: 62px;
      text-align: center;
    }
  }

  .actionbar {
    display: flex;
    align-items: center;
    height: 50px;
    user-select: none;
    position: relative;
    z-index: $bottomZIndex;

    button {
      border-radius: 0;
    }

    .btn-cover {
      border-radius: 0;
      flex-shrink: 0;
    }

    .btn-song-info {
      height: 100%;
      border-right: 1px solid var(--vgo-color-border);
      text-align: left;
      padding-left: 5px;
      line-height: 1.1;
      flex: 1;
      overflow-x: auto;

      .title {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 2px;
      }

      .artist,
      .album {
        font-size: 10px;
        font-weight: 400;
      }

      & > span {
        display: block;
        width: 100%;
      }
    }

    .buttons-scroll {
      overflow: auto;
      height: 100%;
      flex-wrap: nowrap;
      display: flex;
      align-items: center;

      .mdi {
        font-size: 28px;
      }
      & > button {
        height: 100%;
        width: 55px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        .reverse-x {
          text-shadow: 0 0 5px red;
          color: red;
          transform: rotateX(-180deg);
        }

        &.active {
          color: var(--vgo-primary);
        }

        & + button {
          border-left: 1px solid var(--vgo-color-border);
        }
      }
    }
  }
}
</style>
