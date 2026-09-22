/**
 * 播放器封面的统一加载器。
 *
 * 封面不再由播放器自己解析标签拿原始分辨率图片，而是走 `resolveAudioCover` ——
 * 与文件管理器网格缩略图**同一条缓存**（IndexedDB、同一套指纹与 LRU）和同一个并发
 * 队列。命中就是一次 IndexedDB 读，未命中才按 Range 解析标签并降采样，结果统一是
 * ≤512px 的图：既省内存也省解码（原始内嵌封面动辄几千像素）。
 *
 * 生命周期：
 * - 当前曲目立刻请求（详情大图 / 背景 / 系统媒体面板都要它），不必等歌单可见；
 * - 歌单每一行由自己的 IntersectionObserver 在进入可视区时请求（见 PlaylistItem）；
 * - `Disable Preview` 打开时完全不取图并回收已有封面；重新打开时补当前曲目，
 *   可见的行由各自的 observer 重新请求；
 * - 换列表（`playFromList`）/ 关窗时回收 objectURL。
 *
 * 每个窗口（storeId）一份控制器，objectURL 不跨窗口共享 —— 两个窗口同时显示同一张图
 * 时共享 URL 会被先销毁的一方 revoke 掉（与 image-thumb-cache 的单飞表同样的理由）。
 */
import type { useMediaStore } from './media-store'
import type { MediaItem } from './music-state'
import { watch } from 'vue'
import { localSettingsStore } from '@/store'
import { fs } from '@/utils/fs'
import { resolveAudioCover } from '@/utils/image-thumb-cache'
import { requestPreviewLoad } from '@/utils/preview-load-queue'

type MediaStore = ReturnType<typeof useMediaStore>

export interface MediaCoverController {
  /** 请求某一项的封面；重复调用 / 已有封面 / 正在解析 / 已确定没有封面都会被忽略 */
  request: (item: MediaItem | null | undefined) => void
  /** 中止在途解析并回收本窗口所有封面 objectURL */
  releaseAll: () => void
}

export function useMediaCoverController(mediaStore: MediaStore): MediaCoverController {
  /** 在途解析：按绝对路径去重 */
  const inflight = new Map<string, { abort: AbortController, stopQueue: () => void }>()
  /** 已确定「文件里没有内嵌封面」的路径：本窗口内不再重复探测 */
  const noCover = new Set<string>()

  function releaseAll() {
    for (const { abort, stopQueue } of inflight.values()) {
      abort.abort()
      stopQueue()
    }
    inflight.clear()
    noCover.clear()
    // mediaItem 一定来自 playingList，重复释放是幂等的
    for (const item of mediaStore.playingList) {
      item.releaseCoverObjectUrl()
    }
    mediaStore.mediaItem?.releaseCoverObjectUrl()
  }

  function request(item: MediaItem | null | undefined) {
    // 视频封面不走这条路（播放器里仍是类型图标）
    if (!item || item.type !== 'music') {
      return
    }
    if (localSettingsStore.value.disablePreview) {
      return
    }
    if (item.cover || noCover.has(item.absPath) || inflight.has(item.absPath)) {
      return
    }
    // 没有 lastModified 就没有可用指纹，入缓存会在文件改动后一直命中旧封面
    if (!(item.lastModified > 0)) {
      return
    }

    const key = item.absPath
    const abort = new AbortController()
    let stopQueue: (() => void) | null = null

    stopQueue = requestPreviewLoad(() => {
      void (async () => {
        let url: string | null = null
        let missing = false
        try {
          const result = await resolveAudioCover({
            key,
            size: item.size,
            lastModified: item.lastModified,
            streamUrl: fs.url(key),
            signal: abort.signal,
          })
          if (result.ok) {
            url = result.url
          }
          else if (result.reason === 'empty') {
            missing = true
          }
          // 其余失败（网络 / 解码 / 配额）只影响这一次：显示图标，不记成永久结果
        }
        catch {
          // 同上，静默回退图标
        }
        finally {
          // 只有自己还是当前那一条时才摘掉：releaseAll 之后同一个 key 可能已经起了新请求
          if (inflight.get(key)?.abort === abort) {
            inflight.delete(key)
          }
          stopQueue?.()
        }

        if (abort.signal.aborted) {
          if (url) {
            URL.revokeObjectURL(url)
          }
          return
        }
        if (missing) {
          noCover.add(key)
          return
        }
        if (url) {
          item.setCoverBlobUrl(url)
        }
      })()
    })

    inflight.set(key, { abort, stopQueue })
  }

  // 当前曲目：详情大图 / 背景 / 系统媒体面板都要它，不等歌单打开
  watch(
    () => mediaStore.mediaItem,
    item => request(item),
    { immediate: true },
  )

  // Disable Preview：立刻收起所有封面；重新打开时补当前曲目
  watch(
    () => localSettingsStore.value.disablePreview,
    (disabled) => {
      if (disabled) {
        releaseAll()
        return
      }
      request(mediaStore.mediaItem)
    },
  )

  return { request, releaseAll }
}
