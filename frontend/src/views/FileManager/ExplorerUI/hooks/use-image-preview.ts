/**
 * 图片预览 / 文件夹子缩略图 —— 缩略图解析 hooks。
 *
 * 两个 composable:
 * - `useImagePreview()`:单个文件图标(grid/列表行)的预览源,
 *   封装并发队列、取消(Abort)、objectURL 的 revoke 与失败回退;
 * - `useFolderImagePreviews(items)`:文件夹图标里 2×2 子项的缩略图,
 *   随 `items` 变化自动 reconcile,统一管理取消与回收。
 *
 * 候选由 `mode` 决定取图方式(见 ImagePreviewCandidate),共同规则:
 * - `direct`:直连原图流(小图、后端不支持的矢量/图标格式),不入缓存;
 * - `server` / `client`:IndexedDB 缓存优先,未命中才生成;
 * - 失败回退:415(后端不支持)→ 回退原图直连(单文件预览);422/网络失败 → 类型图标;
 * - 任何失败都只影响当前这一次解析,不抛错。
 */
import type { ComputedRef, Ref } from 'vue'
import type { ThumbResolveResult } from '@/utils/image-thumb-cache'
import { onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import {
  IMAGE_PREVIEW_RAW_MAX_BYTES,
  resolveImageThumb,
} from '@/utils/image-thumb-cache'
import { requestPreviewLoad } from '../preview-load-queue'

/**
 * 取图方式：
 * - `direct` 直连原图流，不进 IndexedDB；
 * - `server` 后端 `/api/files/thumbnail` 生成（图片缩略图 / ffmpeg 视频封面）；
 * - `client` 前端 canvas 降采样（后端解不了的图片格式），进 IndexedDB；
 * - `audio` 前端从音频内嵌标签里抽封面再降采样，进 IndexedDB。
 */
export type ImagePreviewMode
  = | 'direct'
    | 'server'
    | 'client'
    | 'audio'

export interface ImagePreviewCandidate {
  /** 显示 key:文件夹子格为子项名,单文件预览为 absPath */
  name: string
  /** 缓存主键:服务端绝对路径 */
  key: string
  mode: ImagePreviewMode
  /**
   * 取图地址:
   * - `direct` / `client` → 原图流地址
   * - `server` → 缩略图接口地址
   */
  url: string
  /** `server` 模式在后端 415 时回退用的原图流地址 */
  fallbackUrl?: string
  size: number
  lastModified: number
}

/** 本实例内对某个 key 的定论:direct = 走原图流,icon = 显示类型图标 */
type SettledMode = 'direct' | 'icon'

function revokeBlobUrl(url: string | null) {
  if (url?.startsWith('blob:'))
    URL.revokeObjectURL(url)
}

function isBlobUrl(url: string | null): boolean {
  return !!url?.startsWith('blob:')
}

/**
 * 解析候选的最终显示地址。
 * `direct` 直接返回；其余交给 resolveImageThumb —— 它内部已经先查缓存再生成，
 * 这里不要再单独查一次（那会白白多做一次 IndexedDB 事务）。
 */
async function resolvePreviewUrl(candidate: ImagePreviewCandidate, signal: AbortSignal): Promise<ThumbResolveResult> {
  if (candidate.mode === 'direct')
    return { ok: true, url: candidate.url }

  return await resolveImageThumb({
    key: candidate.key,
    size: candidate.size,
    lastModified: candidate.lastModified,
    source: candidate.mode === 'server'
      ? { kind: 'server', url: candidate.url }
      : candidate.mode === 'audio'
        ? { kind: 'audio', url: candidate.url }
        : { kind: 'client', url: candidate.url },
    signal,
  })
}

export interface ImagePreviewController {
  /** 当前应显示的地址(objectURL 或直连流地址;空串表示无预览) */
  url: Ref<string>
  /**
   * 加载候选(自动取消上一次未完成的解析);传 null 表示取消并清空。
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
  /** 本实例内已定论的 key:避免对同一个文件反复重试(与回退并存) */
  const decided = new Map<string, SettledMode>()

  function commit(nextUrl: string) {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
    if (isBlobUrl(nextUrl))
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

    const { key, mode } = candidate
    const mySeq = seq
    const abort = new AbortController()
    abortController = abort

    const settled = decided.get(key)
    if (settled === 'icon') {
      commit('')
      return
    }
    if (settled === 'direct') {
      commit(candidate.fallbackUrl ?? candidate.url)
      return
    }

    if (mode === 'direct') {
      // 直连(小图 / svg / ico):不走网络队列,也不入缓存
      commit(candidate.url)
      return
    }

    stopQueueTask = requestPreviewLoad(() => {
      void (async () => {
        let finalUrl: string | null = null
        let outcome: SettledMode | null = null
        try {
          const result = await resolvePreviewUrl(candidate, abort.signal)
          if (result.ok) {
            finalUrl = result.url
          }
          else if (result.reason === 'unsupported') {
            // 415:后端解不了,但浏览器可能能显示(典型是动画 WebP 与多页 TIFF)。
            // 回退同样受原图体积上限约束,否则一个超大动画 WebP 仍会被整份下载。
            if (candidate.fallbackUrl && candidate.size <= IMAGE_PREVIEW_RAW_MAX_BYTES) {
              finalUrl = candidate.fallbackUrl
              outcome = 'direct'
            }
            else {
              outcome = 'icon'
            }
          }
          else if (result.reason === 'busy') {
            // 503 服务端暂时繁忙：本次显示图标，但**不记进 decided**，
            // 下次滚动回来还会重试 —— 一次拥塞不该让这批图在整个会话里都变成图标。
          }
          else if (result.reason !== 'aborted') {
            // 422 超限 / 网络失败 / 配额：显示类型图标，本会话不再重试
            outcome = 'icon'
          }
        }
        catch {
          outcome = 'icon'
        }

        if (mySeq !== seq || abort.signal.aborted) {
          // 已被取代/取消:释放占位,回收可能已生成的 objectURL
          releaseQueueSlot()
          revokeBlobUrl(finalUrl)
          return
        }
        if (outcome)
          decided.set(key, outcome)
        // blob(缓存缩略图)或空结果立即释放占位;
        // 直连原图流由 <img> 加载,占用队列直到 settle()(load/error)
        if (!finalUrl || isBlobUrl(finalUrl))
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
  /** 子项 `<img>` 加载错误时调用(直连原图 404 等) */
  markError: (name: string) => void
  /** 文件夹切换/列表刷新时重置(取消在途解析、清空并回收) */
  reset: () => void
}

/**
 * 文件夹 2×2 预览:监听候选列表,为图片子项解析缩略图。
 * - `direct` 子项直连原图(小图 / svg / ico);
 * - `server` / `client` 子项缓存优先,未命中则生成;
 * - 生成失败/被拒 → 该格显示类型图标,**不做整图回退**:4 个格子各下一张原图代价太大;
 * - 组件卸载(onScopeDispose)自动取消并回收全部 objectURL。
 */
export function useFolderImagePreviews(items: ComputedRef<ImagePreviewCandidate[]>): FolderImagePreviewsController {
  const srcs = reactive(new Map<string, string>())
  const failedNames = ref<string[]>([])
  const decided = new Map<string, SettledMode>()
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
    decided.clear()
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
      // 非图片(无 key) → 该格显示类型图标
      if (!key)
        continue
      if (failedNames.value.includes(name))
        continue

      const settled = decided.get(key)
      if (settled === 'icon')
        continue

      // 直连(小图 / svg / ico / 已定论回退):不占队列、不入缓存
      if (item.mode === 'direct' || settled === 'direct') {
        const directUrl = item.mode === 'direct' ? item.url : item.fallbackUrl
        if (directUrl)
          srcs.set(name, directUrl)
        continue
      }

      let stopTask: (() => void) | null = null
      stopTask = requestPreviewLoad(() => {
        void (async () => {
          let finalUrl: string | null = null
          let failed = false
          try {
            const result = await resolvePreviewUrl(item, abort.signal)
            if (result.ok)
              finalUrl = result.url
            // busy(503) 是可重试失败：这一格暂时显示图标，但不算作失败
            else if (result.reason !== 'aborted' && result.reason !== 'busy')
              failed = true
          }
          catch {
            failed = true
          }
          finally {
            stopTask?.()
          }

          if (mySeq !== seq || abort.signal.aborted) {
            revokeBlobUrl(finalUrl)
            return
          }
          if (failed) {
            decided.set(key, 'icon')
            revokeBlobUrl(finalUrl)
            markError(name)
            return
          }
          if (finalUrl) {
            const prev = srcs.get(name)
            revokeBlobUrl(prev ?? null)
            srcs.set(name, finalUrl)
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
