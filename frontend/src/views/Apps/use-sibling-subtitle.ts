import type { MaybeRefOrGetter } from 'vue'
import type { SubtitleSource } from './video-subtitle'
import { findSiblingFiles, SUBTITLE_DIR_NAMES } from './sibling-lookup'
import { SUBTITLE_EXTENSIONS, subtitleLabel } from './video-subtitle'

/**
 * 跟着视频路径找同名字幕，连同 `SRT/` 之类的字幕目录一起扫。
 *
 * 播放器 App 与 MediaPlayer 共用：传入路径的 ref / getter，换片时自动重找；找不到就是
 * 空数组——自动加载是尽力而为，不该因为一个不存在的字幕打扰用户。返回值直接接到
 * `NativeOrArtVideo` 的 `subtitles`，剩下两个播放器各自处理多份字幕。
 */
export function useSiblingSubtitles(videoPath: MaybeRefOrGetter<string>) {
  const subtitles = ref<SubtitleSource[]>([])
  /** 换片时旧请求可能后返回，用序号让它在途作废。 */
  let request = 0

  watch(() => toValue(videoPath), async (path) => {
    const current = ++request
    subtitles.value = []
    if (!path)
      return
    const found = await findSiblingFiles(path, SUBTITLE_EXTENSIONS, SUBTITLE_DIR_NAMES)
    if (current !== request)
      return
    subtitles.value = found.map(subtitlePath => ({
      path: subtitlePath,
      label: subtitleLabel(path, subtitlePath) || $t('file_lite_i18n.default'),
    }))
  }, { immediate: true })

  return subtitles
}
