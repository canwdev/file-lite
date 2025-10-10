import type { MediaItem } from '../utils/music-state'
import mitt from 'mitt'
import { defineStore } from 'pinia'
import { getRandomInt } from '@/utils'
import { LoopModeType, useMusicSettingsStore } from '../utils/music-state'

export const MusicEvents = {
  ACTION_PLAY: 'ACTION_PLAY',
  ACTION_PAUSE: 'ACTION_PAUSE',
  ACTION_TOGGLE_PLAY: 'ACTION_TOGGLE_PLAY',
  ACTION_CHANGE_CURRENT_TIME: 'ACTION_CHANGE_CURRENT_TIME',
  ACTION_LOCATE_FILE: 'ACTION_LOCATE_FILE',
}
// 创建多个实例的store
export function useMediaStore(uniqueStoreName = 'mediaStore') {
  const Store = defineStore(uniqueStoreName, {
    state: () => {
      // State
      const state = reactive<IStore>({
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
      })

      // Getters
      const isVideo = computed(() => {
        return state.mediaItem && state.mediaItem.type === 'video'
      })

      // Actions
      function playFromList(list: MediaItem[] = [], index = 0) {
        const playItem = list[index]
        if (!playItem) {
          window.$message.error(`index=${index} not found`) // 替换成你的消息提示组件
          return
        }

        state.playingList = list
        state.playingIndex = index
        state.mediaItem = playItem
        state.isLoadedAutoplay = true
      }

      function playPrev() {
        let index = state.playingIndex - 1
        if (index < 0) {
          index = state.playingList.length - 1
        }
        playByIndex(index)
      }

      function playShuffle() {
        function getRandomIndex(array: any[], excludedIndex: number) {
          const availableIndexes = array.reduce((acc, _, index) => {
            if (index !== excludedIndex) {
              acc.push(index)
            }
            return acc
          }, [] as number[])
          const randomIndex = getRandomInt(0, availableIndexes.length - 1)
          return availableIndexes[randomIndex]
        }

        playByIndex(getRandomIndex(state.playingList, state.playingIndex))
      }

      function playNext() {
        const mSettingsStore = useMusicSettingsStore()
        if (mSettingsStore.loopMode === LoopModeType.SHUFFLE) {
          playShuffle()
          return
        }
        let index = state.playingIndex + 1
        if (index > state.playingList.length - 1) {
          if (mSettingsStore.loopMode === LoopModeType.LOOP_SEQUENCE) {
            index = 0
          }
          else {
            return
          }
        }
        playByIndex(index)
      }

      function handlePlayEnded() {
        const mSettingsStore = useMusicSettingsStore()
        state.isPlayEnded = true
        if (mSettingsStore.loopMode === LoopModeType.LOOP_SINGLE) {
          state.mediaBus.emit(MusicEvents.ACTION_PLAY)
          return
        }
        if (mSettingsStore.loopMode === LoopModeType.LOOP_REVERSE) {
          playPrev()
          return
        }
        if (mSettingsStore.loopMode === LoopModeType.SHUFFLE) {
          playShuffle()
          return
        }
        playNext()
      }

      function playByIndex(index: number) {
        state.mediaItem = state.playingList[index]
        state.playingIndex = index
        console.log('[playByIndex]', index, state.mediaItem)
        setTimeout(() => {
          if (state.isPlayEnded) {
            state.mediaBus.emit(MusicEvents.ACTION_PLAY)
            state.isPlayEnded = false
          }
          else if (state.paused) {
            state.mediaBus.emit(MusicEvents.ACTION_PLAY)
          }
        }, 100)
      }

      function reset() {
        state.mediaBus.emit(MusicEvents.ACTION_PAUSE)
        state.mediaItem = null
        state.playingList = []
        state.playingIndex = 0 // 重置index
        state.paused = true // 重置播放状态
        state.currentTime = 0 // 重置播放时间
        state.duration = 0 // 重置duration
        state.isPlayEnded = false // 重置播放结束状态
      }

      // Return
      return {
        ...toRefs(state),
        isVideo,
        playFromList,
        playPrev,
        playShuffle,
        playNext,
        handlePlayEnded,
        playByIndex,
        reset,
      }
    },
  })

  return new Store()
}
export function useBusOn(mediaBus, event: string, fn: any) {
  onMounted(() => {
    mediaBus.on(event, fn)
  })
  onBeforeUnmount(() => {
    mediaBus.off(event, fn)
  })
}
