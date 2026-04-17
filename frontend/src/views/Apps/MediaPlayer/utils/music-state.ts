import type { LyricLine } from './lrc'
import { watch } from 'vue'
import { guid } from '@/utils'
import { regSupportedAudioFormat } from '@/utils/is'
import { normalizePath } from '@/views/FileManager/utils'

export type MediaType = 'music' | 'video'

export type { LyricLine }

export interface EmbeddedAudioTags {
  title?: string
  artist?: string
  album?: string
  year?: number
  /** Embedded cover; caller creates object URL from raw picture data */
  coverImage?: { data: Uint8Array, mimeType: string }
  lyricsLines?: LyricLine[]
}

export class MediaItem {
  guid: string
  filename: string
  basePath: string
  type: MediaType
  /** Optional cover URL when enriched by the player / metadata (e.g. blob:) */
  cover?: string
  /** Track title from embedded tags; falls back to filename in `titleDisplay` */
  title?: string
  artist?: string
  album?: string
  year?: number
  /** Timed lyrics (e.g. from embedded tags); seconds from track start */
  lyricsLines?: LyricLine[]
  private _coverObjectUrl?: string

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
    const t = this.title?.trim()
    if (t)
      return t
    return this.filename
  }

  /** One-line subtitle for lists (artist / album) */
  get artistsAlbumDisplay() {
    const parts = [this.artist?.trim(), this.album?.trim()].filter(Boolean) as string[]
    if (parts.length === 0)
      return undefined
    return parts.join(' — ')
  }

  /** Replace embedded-tag fields and cover; revokes previous cover blob URL */
  applyEmbeddedTags(tags: EmbeddedAudioTags) {
    this.title = tags.title?.trim() || undefined
    this.artist = tags.artist?.trim() || undefined
    this.album = tags.album?.trim() || undefined
    this.year = tags.year

    this.releaseCoverObjectUrl()
    if (tags.coverImage?.data?.length) {
      const mime = tags.coverImage.mimeType || 'image/jpeg'
      const blob = new Blob([tags.coverImage.data.slice()], { type: mime })
      this._coverObjectUrl = URL.createObjectURL(blob)
      this.cover = this._coverObjectUrl
    }
    else {
      this.cover = undefined
    }

    this.lyricsLines = tags.lyricsLines?.length
      ? tags.lyricsLines.map(l => ({ time: l.time, text: l.text }))
      : undefined
  }

  releaseCoverObjectUrl() {
    if (this._coverObjectUrl) {
      URL.revokeObjectURL(this._coverObjectUrl)
      this._coverObjectUrl = undefined
    }
    this.cover = undefined
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
      // Integer 0–100: avoid float noise (e.g. 20.000000000000004) from IEEE-754 + slider/wheel
      let parsedValue = Math.round(Number(value))
      parsedValue = Math.min(100, Math.max(0, parsedValue))
      audioVolume.value = parsedValue
    }

    function volumeUp(step: number = 5) {
      setAudioVolume(audioVolume.value + step)
    }

    function volumeDown(step: number = 5) {
      setAudioVolume(audioVolume.value - step)
    }

    watch(
      audioVolume,
      (v) => {
        if (!Number.isFinite(v))
          return
        const n = Math.min(100, Math.max(0, Math.round(v)))
        if (Object.is(v, n))
          return
        audioVolume.value = n
      },
      { flush: 'sync' },
    )

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
