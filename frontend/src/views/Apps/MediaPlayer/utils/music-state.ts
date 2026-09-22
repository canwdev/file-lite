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
  lyricsLines?: LyricLine[]
}

export class MediaItem {
  guid: string
  filename: string
  basePath: string
  type: MediaType
  /**
   * 封面地址（`blob:`）。统一由缩略图缓存给出：`resolveAudioCover` 的结果是
   * ≤512px 的降采样图，不再是内嵌标签里的原始分辨率图片。
   */
  cover?: string
  /** 文件字节数；封面缓存指纹的一半，来自文件列表条目 */
  size: number
  /** 最后修改时间；封面缓存指纹的另一半 */
  lastModified: number
  /** Track title from embedded tags; falls back to filename in `titleDisplay` */
  title?: string
  artist?: string
  album?: string
  year?: number
  /** Timed lyrics (e.g. from embedded tags); seconds from track start */
  lyricsLines?: LyricLine[]
  private _coverObjectUrl?: string

  constructor(filename: string, basePath: string, size = 0, lastModified = 0) {
    this.guid = guid()
    this.filename = filename
    this.basePath = basePath
    this.size = size
    this.lastModified = lastModified
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

  /**
   * 替换内嵌标签字段。**不碰封面**：封面由缩略图缓存统一解析（`setCoverBlobUrl`），
   * 在这里回收它会在标签解析完成时把已经显示的封面擦掉。
   */
  applyEmbeddedTags(tags: EmbeddedAudioTags) {
    this.title = tags.title?.trim() || undefined
    this.artist = tags.artist?.trim() || undefined
    this.album = tags.album?.trim() || undefined
    this.year = tags.year

    this.lyricsLines = tags.lyricsLines?.length
      ? tags.lyricsLines.map(l => ({ time: l.time, text: l.text }))
      : undefined
  }

  /** 设置封面地址；旧地址立刻回收，保证同一时间只有一个封面 URL。 */
  setCoverBlobUrl(url: string) {
    this.releaseCoverObjectUrl()
    this._coverObjectUrl = url
    this.cover = url
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
