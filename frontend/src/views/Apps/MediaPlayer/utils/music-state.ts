import { guid } from '@/utils'
import { regSupportedAudioFormat } from '@/utils/is'
import { normalizePath } from '@/views/FileManager/utils'

export type MediaType = 'music' | 'video'

export class MediaItem {
  guid: string
  filename: string
  basePath: string
  type: MediaType

  constructor(filename: string, basePath: string) {
    this.guid = guid()
    this.filename = filename
    this.basePath = basePath
    this.type = regSupportedAudioFormat.test(filename) ? 'music' : 'video'
  }

  get absPath() {
    return normalizePath(`${this.basePath}/${this.filename}`)
  }

  get titleDisplay() {
    return this.filename
  }
}

export enum LoopModeType {
  NONE = 1, // Play stops after last track
  LOOP_SEQUENCE = 2, // Sequence play
  LOOP_REVERSE = 3, // Reverse play
  LOOP_SINGLE = 4, // Single cycle
  SHUFFLE = 5, // Shuffle next
}

export const LoopModeTypeValues = [
  LoopModeType.NONE,
  LoopModeType.LOOP_SEQUENCE,
  LoopModeType.LOOP_REVERSE,
  LoopModeType.LOOP_SINGLE,
  LoopModeType.SHUFFLE,
]
export const loopModeMap = {
  [LoopModeType.NONE]: {
    value: LoopModeType.NONE,
    i18nKey: 'Play in Order',
    className: 'mdi mdi-shuffle-disabled',
    icon: '➡️',
  },
  [LoopModeType.SHUFFLE]: {
    value: LoopModeType.SHUFFLE,
    i18nKey: 'Shuffle',
    className: 'mdi mdi-shuffle',
    icon: '🔀',
  },
  [LoopModeType.LOOP_SEQUENCE]: {
    value: LoopModeType.LOOP_SEQUENCE,
    icon: '🔁',
    className: 'mdi mdi-repeat',
    i18nKey: 'Sequential Loop',
  },
  [LoopModeType.LOOP_REVERSE]: {
    value: LoopModeType.LOOP_REVERSE,
    icon: '🔁',
    className: 'mdi mdi-repeat-variant reverse-x',
    i18nKey: 'Reverse Loop',
  },
  [LoopModeType.LOOP_SINGLE]: {
    value: LoopModeType.LOOP_SINGLE,
    icon: '🔂',
    className: 'mdi mdi-repeat-once',
    i18nKey: 'Single Cycle',
  },
}

// 使用箭头函数和明确的类型定义
export const useMusicSettingsStore = defineStore(
  'musicSettings',
  () => {
    const loopMode = ref<LoopModeType>(LoopModeType.LOOP_SEQUENCE)
    const audioVolume = ref<number>(100)

    // actions: 使用 `function` 声明，提供清晰的上下文，并进行类型注解
    function setAudioVolume(value: number) {
      let parsedValue = Number(value)

      parsedValue = Math.min(100, Math.max(0, parsedValue))

      audioVolume.value = parsedValue // 使用 `.value` 访问 ref 的值
    }

    function volumeUp(step: number = 5) {
      setAudioVolume(audioVolume.value + step)
    }

    function volumeDown(step: number = 5) {
      setAudioVolume(audioVolume.value - step)
    }

    return {
      loopMode,
      audioVolume,
      setAudioVolume,
      volumeUp,
      volumeDown,
    }
  },
  {
    persist: {
      key: 'file_lite_music_settings',
    },
  },
)
