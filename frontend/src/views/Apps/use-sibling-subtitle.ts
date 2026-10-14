import type { MaybeRefOrGetter } from 'vue'
import { findSiblingFile } from './sibling-lookup'
import { SUBTITLE_EXTENSIONS } from './video-subtitle'

/**
 * 跟着视频路径找同名字幕。
 *
 * 播放器 App 与 MediaPlayer 共用：传入路径的 ref / getter，换片时自动重找；找不到就是
 * 空字符串——自动加载是尽力而为，不该因为一个不存在的字幕打扰用户。返回值直接接到
 * `NativeOrArtVideo` 的 `subtitle-path`，剩下两个播放器各自处理。
 */
export function useSiblingSubtitle(videoPath: MaybeRefOrGetter<string>) {
  const subtitlePath = ref('')
  /** 换片时旧请求可能后返回，用序号让它在途作废。 */
  let request = 0

  watch(() => toValue(videoPath), async (path) => {
    const current = ++request
    subtitlePath.value = ''
    if (!path)
      return
    const found = await findSiblingFile(path, SUBTITLE_EXTENSIONS)
    if (current !== request)
      return
    subtitlePath.value = found ?? ''
  }, { immediate: true })

  return subtitlePath
}
