import type { Emitter } from 'mitt'
import type { MediaItem } from './music-state'
import mitt from 'mitt'
import { defineStore } from 'pinia'
import { getRandomInt } from '@/utils'
import { LoopModeType, useMusicSettingsStore } from './music-state'

export const MusicEvents = {
  ACTION_PLAY: 'ACTION_PLAY',
  ACTION_PAUSE: 'ACTION_PAUSE',
  ACTION_TOGGLE_PLAY: 'ACTION_TOGGLE_PLAY',
  ACTION_CHANGE_CURRENT_TIME: 'ACTION_CHANGE_CURRENT_TIME',
  ACTION_LOCATE_FILE: 'ACTION_LOCATE_FILE',
}

type MediaBus = Emitter<Record<string, unknown>>

interface MediaStoreState {
  mediaBus: MediaBus
  mediaItem: MediaItem | null
  playingList: MediaItem[]
  playingIndex: number
  paused: boolean
  currentTime: number
  duration: number
  playbackRate: number
  stopCountdown: null
  isPlayEnded: boolean
  isLoadedAutoplay: boolean
}

export function useMediaStore(uniqueStoreName = 'mediaStore') {
  return defineStore(uniqueStoreName, {
    state: (): MediaStoreState => ({
      mediaBus: mitt(),
      mediaItem: null,
      playingList: [],
      playingIndex: 0,
      paused: true,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      stopCountdown: null,
      isPlayEnded: false,
      isLoadedAutoplay: true,
    }),
    getters: {
      isVideo(state): boolean {
        return !!(state.mediaItem && state.mediaItem.type === 'video')
      },
    },
    actions: {
      playFromList(list: MediaItem[] = [], index = 0) {
        const playItem = list[index]
        if (!playItem) {
          window.$message.error(`No media at index ${index}`)
          return
        }

        this.playingList = list
        this.playingIndex = index
        this.mediaItem = playItem
        this.isLoadedAutoplay = true
      },

      playPrev() {
        let index = this.playingIndex - 1
        if (index < 0) {
          index = this.playingList.length - 1
        }
        this.playByIndex(index)
      },

      playShuffle() {
        const getRandomIndex = (array: MediaItem[], excludedIndex: number) => {
          const availableIndexes = array.reduce((acc, _, i) => {
            if (i !== excludedIndex) {
              acc.push(i)
            }
            return acc
          }, [] as number[])
          if (availableIndexes.length === 0) {
            return excludedIndex
          }
          const randomIndex = getRandomInt(0, availableIndexes.length - 1)
          return availableIndexes[randomIndex]!
        }

        this.playByIndex(getRandomIndex(this.playingList, this.playingIndex))
      },

      playNext() {
        const mSettingsStore = useMusicSettingsStore()
        if (mSettingsStore.loopMode === LoopModeType.SHUFFLE) {
          this.playShuffle()
          return
        }
        let index = this.playingIndex + 1
        if (index > this.playingList.length - 1) {
          if (mSettingsStore.loopMode === LoopModeType.LOOP_SEQUENCE) {
            index = 0
          }
          else {
            return
          }
        }
        this.playByIndex(index)
      },

      handlePlayEnded() {
        const mSettingsStore = useMusicSettingsStore()
        this.isPlayEnded = true
        if (mSettingsStore.loopMode === LoopModeType.LOOP_SINGLE) {
          this.mediaBus.emit(MusicEvents.ACTION_PLAY)
          return
        }
        if (mSettingsStore.loopMode === LoopModeType.LOOP_REVERSE) {
          this.playPrev()
          return
        }
        if (mSettingsStore.loopMode === LoopModeType.SHUFFLE) {
          this.playShuffle()
          return
        }
        this.playNext()
      },

      playByIndex(index: number) {
        this.mediaItem = this.playingList[index]
        this.playingIndex = index
        if (import.meta.env.DEV) {
          console.debug('[playByIndex]', index, this.mediaItem)
        }
        setTimeout(() => {
          if (this.isPlayEnded) {
            this.mediaBus.emit(MusicEvents.ACTION_PLAY)
            this.isPlayEnded = false
          }
          else if (this.paused) {
            this.mediaBus.emit(MusicEvents.ACTION_PLAY)
          }
        }, 100)
      },

      reset() {
        this.mediaBus.emit(MusicEvents.ACTION_PAUSE)
        for (const item of this.playingList) {
          item.releaseCoverObjectUrl()
        }
        this.mediaItem = null
        this.playingList = []
        this.playingIndex = 0
        this.paused = true
        this.currentTime = 0
        this.duration = 0
        this.isPlayEnded = false
      },
    },
  })()
}

export function useBusOn(
  mediaBus: Emitter<Record<string, unknown>>,
  event: string,
  fn: (...args: unknown[]) => void,
) {
  onMounted(() => {
    mediaBus.on(event, fn)
  })
  onBeforeUnmount(() => {
    mediaBus.off(event, fn)
  })
}
