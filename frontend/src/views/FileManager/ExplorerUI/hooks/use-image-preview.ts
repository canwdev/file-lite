/**
 * 图片预览 / 文件夹子缩略图 —— 缩略图缓存逻辑 hooks。
 *
 * 两个 composable:
 * - `useImagePreview()`:单个文件图标(grid/列表行)的预览源,
 *   封装并发队列、取消(Abort)、objectURL 的 revoke 与直连回退;
 * - `useFolderImagePreviews(items)`:文件夹图标里 2×2 子项的缩略图,
 *   随 `items` 变化自动 reconcile,统一管理取消与回收。
 *
 * 共同规则:
 * - 大图(> IMAGE_THUMB_SMALL_DIRECT_MAX 且有修改时间指纹)缓存优先,命中即显示;
 * - 未命中:允许下载(streamUrl 非空,受 Preview Size 限制)才生成;不允许则仅当
 *   命中缓存时显示 —— 即“文件超出 Preview Size 上限但已有缓存 → 仍显示缓存图”;
 * - 小图直接显示原图流,不入缓存;
 * - 任何失败都只影响当前这一次解析(回退直连或显示类型图标),不抛错。
 */
import type { ComputedRef, Ref } from 'vue'
import { onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import {
  getCachedImageThumbUrl,
  resolveImageThumb,
} from '@/utils/image-thumb-cache'
import { requestPreviewLoad } from '../preview-load-queue'

export interface ImagePreviewCandidate {
  /** 显示 key:文件夹子格为子项名,单文件预览为 absPath */
  name: string
  /** 缓存主键:服务端绝对路径 */
  key: string
  /**
   * 允许下载原图的流地址。
   * 为空表示 cacheOnly:只允许命中已有缓存(超出 Preview Size 上限时用来尊重限制)。
   */
  streamUrl: string
  size: number
  lastModified: number
  /** 是否参与缩略图缓存(大图且指纹可用);false 时小图直接显示 streamUrl */
  cacheEnabled: boolean
}

function revokeBlobUrl(url: string | null) {
  if (url?.startsWith('blob:'))
    URL.revokeObjectURL(url)
}

/**
 * 解析候选的最终显示地址(命中缓存 / 直连 / 生成)。
 * 返回 null 表示“无图可显示”(cacheOnly 未命中、小图无流、被取消)。
 */
async function resolvePreviewUrl(candidate: ImagePreviewCandidate, signal: AbortSignal): Promise<string | null> {
  // 小图:直连原图流
  if (!candidate.cacheEnabled)
    return candidate.streamUrl || null

  // 大图:命中缓存直接返回
  const hit = await getCachedImageThumbUrl({
    key: candidate.key,
    size: candidate.size,
    lastModified: candidate.lastModified,
  })
  if (hit)
    return hit

  if (signal.aborted)
    return null

  // 未命中:仅当允许下载时才生成(生成失败返回 null,由调用方回退)
  if (!candidate.streamUrl)
    return null

  return await resolveImageThumb({
    key: candidate.key,
    streamUrl: candidate.streamUrl,
    size: candidate.size,
    lastModified: candidate.lastModified,
    signal,
  })
}

export interface ImagePreviewController {
  /** 当前应显示的地址(objectURL 或直连流地址;空串表示无预览) */
  url: Ref<string>
  /**
   * 加载候选(自动取消上一次未完成的解析);传 null 表示取消并清空。
   * 大图缓存未命中且允许下载时,生成失败会回退直连 streamUrl。
   */
  request: (candidate: ImagePreviewCandidate | null) => void
  /** 图片 load / error 后调用,释放并发队列占位(仅占用网络/解码的任务需要) */
  settle: () => void
}

export function useImagePreview(): ImagePreviewController {
  const url = shallowRef('')
  let currentBlobUrl: string | null = null
  let seq = 0
  let abortController: AbortController | null = null
  let stopQueueTask: (() => void) | null = null
  /** 本实例内生成失败过的 key:避免反复重试(与直连回退并存) */
  const skipKeys = new Set<string>()

  function commit(nextUrl: string) {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
    if (nextUrl && nextUrl.startsWith('blob:'))
      currentBlobUrl = nextUrl
    url.value = nextUrl
  }

  function releaseQueueSlot() {
    stopQueueTask?.()
    stopQueueTask = null
  }

  function request(candidate: ImagePreviewCandidate | null) {
    // 取代上一次请求
    seq += 1
    abortController?.abort()
    abortController = null
    releaseQueueSlot()

    if (!candidate) {
      commit('')
      return
    }

    const { key, streamUrl, cacheEnabled } = candidate
    const mySeq = seq
    const abort = new AbortController()
    abortController = abort

    if (!cacheEnabled) {
      // 小图直连(无网络并发压力,不入队列)
      commit(streamUrl || '')
      return
    }

    stopQueueTask = requestPreviewLoad(() => {
      void (async () => {
        let finalUrl: string | null = null
        try {
          if (skipKeys.has(key)) {
            finalUrl = streamUrl || null
          }
          else {
            finalUrl = await resolvePreviewUrl(candidate, abort.signal)
            if (finalUrl === null && !abort.signal.aborted && cacheEnabled && streamUrl) {
              // 生成失败(如解码不支持):回退直连原图,并记住不再反复生成
              skipKeys.add(key)
              finalUrl = streamUrl
            }
          }
        }
        catch {
          finalUrl = null
        }
        if (mySeq !== seq || abort.signal.aborted) {
          // 已被取代/取消:释放占位,回收可能已生成的 objectURL
          releaseQueueSlot()
          revokeBlobUrl(finalUrl)
          return
        }
        // blob(缓存缩略图)或空结果立即释放占位;
        // 直连原图流由 <img> 加载,占用队列直到 settle()(load/error),与旧行为一致
        if (!finalUrl || finalUrl.startsWith('blob:'))
          releaseQueueSlot()
        commit(finalUrl ?? '')
      })()
    })
  }

  function settle() {
    releaseQueueSlot()
  }

  onScopeDispose(() => {
    seq += 1
    abortController?.abort()
    releaseQueueSlot()
    commit('')
  })

  return { url, request, settle }
}

export interface FolderImagePreviewsController {
  /** 子项名 -> 当前显示地址 */
  srcs: Map<string, string>
  /** 加载/解码失败过、当前显示类型图标的子项名 */
  failedNames: Ref<string[]>
  /** 子项 `<img>` 加载错误时调用(小图直连 404 等) */
  markError: (name: string) => void
  /** 文件夹切换/列表刷新时重置(取消在途解析、清空并回收) */
  reset: () => void
}

/**
 * 文件夹 2×2 预览:监听候选列表,为图片子项解析缩略图。
 * - 大图子项:命中缓存即显示;未命中且允许下载则生成;仅 cacheOnly 时未命中显示图标;
 * - 生成失败/仅 cacheOnly 未命中 → 该格显示类型图标(不做整图回退,避免反复全量下载);
 * - 组件卸载(onScopeDispose)自动取消并回收全部 objectURL。
 */
export function useFolderImagePreviews(items: ComputedRef<ImagePreviewCandidate[]>): FolderImagePreviewsController {
  const srcs = reactive(new Map<string, string>())
  const failedNames = ref<string[]>([])
  const skipKeys = new Set<string>()
  let seq = 0
  let abortController: AbortController | null = null

  function markError(name: string) {
    const prev = srcs.get(name)
    revokeBlobUrl(prev ?? null)
    srcs.delete(name)
    if (!failedNames.value.includes(name))
      failedNames.value = [...failedNames.value, name]
  }

  function reset() {
    seq += 1
    abortController?.abort()
    abortController = null
    skipKeys.clear()
    for (const url of srcs.values())
      revokeBlobUrl(url)
    srcs.clear()
    failedNames.value = []
  }

  watch(items, (list) => {
    seq += 1
    abortController?.abort()
    const abort = new AbortController()
    abortController = abort
    const mySeq = seq

    // 移除已不在列表中的名字
    const aliveNames = new Set(list.map(item => item.name))
    for (const name of [...srcs.keys()]) {
      if (!aliveNames.has(name)) {
        const prev = srcs.get(name)
        revokeBlobUrl(prev ?? null)
        srcs.delete(name)
      }
    }

    for (const item of list) {
      const { name, key } = item
      // 非图片(无 key)/ Disabled 场景 → 该格显示类型图标
      if (!key)
        continue

      if (!item.cacheEnabled) {
        // 小图直连
        if (item.streamUrl)
          srcs.set(name, item.streamUrl)
        continue
      }

      if (skipKeys.has(key) || failedNames.value.includes(name))
        continue

      let stopTask: (() => void) | null = null
      stopTask = requestPreviewLoad(() => {
        void (async () => {
          let finalUrl: string | null = null
          try {
            finalUrl = await resolvePreviewUrl(item, abort.signal)
            if (finalUrl === null && !abort.signal.aborted && item.cacheEnabled && item.streamUrl)
              skipKeys.add(key) // 生成失败:本会话该文件直接显示图标,避免反复全量重拉
          }
          finally {
            stopTask?.()
          }
          if (mySeq !== seq || abort.signal.aborted) {
            revokeBlobUrl(finalUrl)
            return
          }
          if (finalUrl) {
            const prev = srcs.get(name)
            revokeBlobUrl(prev ?? null)
            srcs.set(name, finalUrl)
          }
          else {
            // cacheOnly 未命中或生成失败 → 图标
            revokeBlobUrl(finalUrl)
            markError(name)
          }
        })()
      })
    }
  }, { immediate: true })

  onScopeDispose(() => {
    reset()
  })

  return { srcs, failedNames, markError, reset }
}
