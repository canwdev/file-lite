<script setup lang="ts">
import Mousetrap from 'mousetrap'
import { formatTimeHMS } from '@/utils'
import CoverMini from './CoverMini.vue'
import Seekbar from './SeekBar.vue'
import { MusicEvents, useMediaStore } from './utils/media-store'
import { loopModeMap, LoopModeTypeValues, useMusicSettingsStore } from './utils/music-state'

defineEmits(['onCoverClick', 'onTitleClick'])
// interface Props {}
// const props = withDefaults(defineProps<Props>(), {})

const storeId = inject('storeId')
const mediaStore = useMediaStore(storeId.value)

const KEY_SPACE = 'space'
const KEY_PREVIOUS = ['left', 'pageup', 'k', 'l']
const KEY_NEXT = ['right', 'pagedown', 'h', 'j']
const KEY_UP = 'up'
const KEY_DOWN = 'down'

const mSettingsStore = useMusicSettingsStore()
const mCurrentTime = ref(0)
const isSeeking = ref(false)
const isDisabled = ref(false)

const mousetrapRef = shallowRef()

function togglePlay(e) {
  e.preventDefault()
  mediaStore.mediaBus.emit(MusicEvents.ACTION_TOGGLE_PLAY)
}
function previous() {
  mediaStore.playPrev()
}
function next() {
  mediaStore.playNext()
}
function volumeUpFn(e) {
  e.preventDefault()
  mSettingsStore.volumeUp()
}
function volumeDownFn(e) {
  e.preventDefault()
  mSettingsStore.volumeDown()
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

function progressSeeking(value) {
  isSeeking.value = true
  mCurrentTime.value = Number(value)
}
function progressChange(value) {
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

function jumpForward() {
  mediaStore.mediaBus.emit(MusicEvents.ACTION_CHANGE_CURRENT_TIME, (mediaStore.currentTime += 5))
}
function jumpBackward() {
  mediaStore.mediaBus.emit(MusicEvents.ACTION_CHANGE_CURRENT_TIME, (mediaStore.currentTime -= 5))
}
</script>

<template>
  <div v-if="mediaItem" class="actionbar-wrapper">
    <div class="progressbar">
      <span class="time text-overflow">{{ formatTimeHMS(mCurrentTime) }}</span>

      <Seekbar
        :max="mediaStore.duration"
        :value="mCurrentTime"
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
          :disabled="isDisabled"
          class="btn-action btn-no-style icon-wrap"
          title="Previous"
          @click="previous"
          @contextmenu.prevent="jumpBackward"
        >
          <span class="mdi mdi-skip-previous" />
        </button>

        <button
          :disabled="isDisabled"
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
          :disabled="isDisabled"
          class="btn-action btn-no-style icon-wrap"
          title="Next"
          @click="next"
          @contextmenu.prevent="jumpForward"
        >
          <span class="mdi mdi-skip-next" />
        </button>

        <el-popover placement="top" trigger="hover">
          <template #reference>
            <button class="btn-action btn-no-style icon-wrap" title="Playback Speed">
              {{ mediaStore.playbackRate }}x
            </button>
          </template>

          <div class="flex-row-center-gap">
            <button class="vgo-button" @click="mediaStore.playbackRate = Number(1)">
              Reset
            </button>
            <el-slider
              v-model="mediaStore.playbackRate"
              style="width: 150px"
              :max="2"
              :min="0.1"
              :step="0.1"
            />
          </div>
        </el-popover>

        <button
          v-if="currentLoopMode"
          class="btn-action btn-no-style icon-wrap"
          :title="currentLoopMode.i18nKey"
          @click="switchLoopMode"
        >
          <span
            v-if="currentLoopMode.icon || currentLoopMode.className"
            class="material-icons"
            :class="currentLoopMode.className"
          >
            <!-- {{ currentLoopMode.icon }} -->
          </span>
          <span v-else>{{ currentLoopMode.i18nKey }}</span>
        </button>

        <el-popover placement="top" trigger="hover">
          <template #reference>
            <button class="btn-action btn-no-style icon-wrap" title="Volume">
              <template v-if="mSettingsStore.audioVolume > 0">
                <span class="mdi mdi-volume-high" />
              </template>
              <template v-else>
                <span class="mdi mdi-volume-variant-off" />
              </template>
            </button>
          </template>
          <div style="display: flex; align-items: center; flex-direction: column">
            <el-slider
              v-model="mSettingsStore.audioVolume"
              style="width: 100px"
              :max="100"
              :step="1"
              :min="0"
              :tooltip="false"
            />
            <span style="font-size: 12px">{{ mSettingsStore.audioVolume }}</span>
          </div>
        </el-popover>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
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
