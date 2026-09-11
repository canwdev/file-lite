/**
 * 图片缩略图 IndexedDB 缓存(image-thumb-cache)
 *
 * 缩略图字节有两个来源,共用同一套指纹与 LRU:
 * - `server`:后端 `/api/files/thumbnail` 生成(Go 能解码的格式,见 regServerThumbFormat);
 * - `client`:浏览器 canvas 阶梯降采样(后端解不了的 avif/heic,见 regClientCanvasThumbFormat)。
 *
 * - 命中:按 `(size, lastModified, 生成版本)` 指纹比对,文件改动后自动失效重新生成;
 * - 未命中:server 直接拉缩略图接口;client 拉一次原图流 → 降采样;
 * - 容量:LRU 淘汰,默认上限 1GB(meta 与 blob 分离存储,淘汰/统计不加载 blob);
 * - 失败区分原因(`unsupported` / `rejected` / `failed` / `aborted`),调用方据此
 *   回退直连原图或显示类型图标,不在这里替调用方做决定。
 */
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'

export const IMAGE_THUMB_MAX_EDGE = 512
/** 小于该体积的图片不值得入缓存,直接显示原图 */
export const IMAGE_THUMB_SMALL_DIRECT_MAX = 256 * 1024
/**
 * 需要前端自己下载原图的预览路径的**源文件体积上限**:后端白名单之外的格式
 * (avif/heic/heif/svg/ico 等),以及后端 415 之后回退原图直连的那条路。
 * 超过就只显示类型图标,绝不下载。
 *
 * 后端白名单格式不受此限制:它们下载的是后端生成的 ≤512px 缩略图,与源文件体积无关。
 * 这里的上限只为浏览器解码内存兜底 —— 注意字节数只是像素数的弱代理(AVIF 压缩率极高,
 * 20MB 也可能是上亿像素),真正的兜底是 createImageBitmap 失败后回退图标。
 */
export const IMAGE_PREVIEW_RAW_MAX_BYTES = 20 * 1024 * 1024
/** 缓存总字节上限:1GB */
export const IMAGE_THUMB_CACHE_MAX_BYTES = 1024 ** 3

/**
 * 缩略图「生成参数」版本。
 * 后端调整了缩放滤镜 / JPEG 质量 / 输出格式,或前端改了降采样策略时递增,
 * 旧缓存就会自然失效(比清空整库温和,也比依赖 app 版本号精准)。
 */
export const THUMB_CACHE_VERSION = 1

const DB_NAME = 'file-lite-image-cache'
/** v2:字节改由后端生成(JPEG/PNG)并新增 client 降采样,旧库直接丢弃 */
const DB_VERSION = 2
const META_STORE = 'meta'
const BLOB_STORE = 'blobs'
/** 命中时更新 lastUsed 的最小间隔,避免高频写 meta */
const LAST_USED_TOUCH_MS = 30_000
/** 解码阶段全局并发上限(解码位图是内存大头,仅 client 路径占用) */
const DECODE_CONCURRENCY = 2

/**
 * 缓存主键规范化:统一 `/` 分隔符并合并连续 `/`。
 * 同一文件可能经不同路径拼接进入(如列表项 absPath 带尾斜杠 → `//file.jpg`,
 * 而文件夹子项走 normalizeListingPath → `file.jpg`),不规范化会重复入缓存。
 */
function normalizeThumbKey(key: string) {
  return key.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function thumbFingerprint(size: number, lastModified: number) {
  return `${THUMB_CACHE_VERSION}:${size}:${lastModified}`
}

interface ThumbMeta {
  key: string
  /** 指纹,用于判断文件是否已变化 */
  fp: string
  /** blob 实际字节数 */
  byteSize: number
  storedAt: number
  lastUsed: number
}

interface ThumbDb extends DBSchema {
  meta: {
    key: string
    value: ThumbMeta
    indexes: { byLastUsed: number }
  }
  blobs: {
    key: string
    value: Blob
  }
}

let dbPromise: Promise<IDBPDatabase<ThumbDb>> | null = null
let readyPromise: Promise<void> | null = null
let ready = false

/** 内存记账,用于快速淘汰判断(允许少量漂移;统计展示走真实游标) */
let totalBytes = 0
let totalEntries = 0

/** 同一 key 的并发生成去重 */
const inflightGenerations = new Map<string, Promise<ThumbResolveResult>>()

function openThumbDb() {
  dbPromise ??= openDB<ThumbDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const metaStore = db.createObjectStore(META_STORE, { keyPath: 'key' })
      metaStore.createIndex('byLastUsed', 'lastUsed')
      db.createObjectStore(BLOB_STORE)
    },
  })
  return dbPromise
}

function requestPersistentStorage() {
  try {
    // 尽力争取持久化配额,避免浏览器存储压力下整库被清空
    void navigator.storage?.persist?.()
  }
  catch {
    // ignore
  }
}

async function ensureReady() {
  if (ready)
    return
  readyPromise ??= (async () => {
    try {
      const db = await openThumbDb()
      let cursor = await db.transaction(META_STORE).store.openCursor()
      while (cursor) {
        totalBytes += cursor.value.byteSize
        totalEntries += 1
        cursor = await cursor.continue()
      }
      ready = true
      requestPersistentStorage()
    }
    catch {
      // 缓存不可用(隐私模式/配额策略等):ready 保持 false,resolve 一律失败 → 调用方回退
      dbPromise = null
    }
  })()
  await readyPromise
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * 从最久未使用开始删除,直到 totalBytes <= targetTotalBytes。
 * 用索引的 count 查询挑最旧的一批 key,再取 meta 修正记账后单事务删除
 * (不持有半开光标,避免事务悬挂;每轮只删少量条目,循环收敛)。
 */
async function evictOldest(db: IDBPDatabase<ThumbDb>, targetTotalBytes: number) {
  while (totalBytes > targetTotalBytes) {
    const remaining = totalBytes - targetTotalBytes
    const averageSize = totalEntries > 0 ? totalBytes / totalEntries : 0
    // 预估需要删多少条(按平均大小,加少量余量),一轮不足则下一轮自适应
    const count = Math.min(totalEntries, Math.ceil(remaining / Math.max(1, averageSize)) + 2)

    const readTx = db.transaction(META_STORE, 'readonly')
    const keys = await readTx.store.index('byLastUsed').getAllKeys(undefined, count)
    await readTx.done
    if (keys.length === 0) {
      totalBytes = targetTotalBytes // 记账与实际已不一致,避免死循环
      break
    }

    const metas: ThumbMeta[] = []
    for (const key of keys) {
      const meta = await db.get(META_STORE, key)
      if (meta)
        metas.push(meta)
    }
    if (metas.length === 0) {
      totalBytes = targetTotalBytes
      break
    }

    const deleteTx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
    for (const meta of metas) {
      deleteTx.objectStore(META_STORE).delete(meta.key)
      deleteTx.objectStore(BLOB_STORE).delete(meta.key)
    }
    await deleteTx.done

    const freed = metas.reduce((sum, meta) => sum + meta.byteSize, 0)
    totalBytes = Math.max(0, totalBytes - freed)
    totalEntries = Math.max(0, totalEntries - metas.length)
  }
}

async function putEntry(db: IDBPDatabase<ThumbDb>, key: string, blob: Blob, meta: ThumbMeta) {
  const doPut = () => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
    tx.objectStore(META_STORE).put(meta)
    tx.objectStore(BLOB_STORE).put(blob, key)
    return tx.done
  }

  // 先淘汰到「写入后总占用仍不超上限」
  await evictOldest(db, IMAGE_THUMB_CACHE_MAX_BYTES - blob.size)

  try {
    await doPut()
  }
  catch (error) {
    if (!isQuotaError(error))
      throw error
    // 配额不足:额外清掉一半后重试一次,仍失败则放弃本次写入
    await evictOldest(db, IMAGE_THUMB_CACHE_MAX_BYTES * 0.5)
    await doPut()
  }
  totalBytes += blob.size
  totalEntries += 1
}

async function storeBlob(key: string, fp: string, blob: Blob) {
  const db = await openThumbDb()
  const meta: ThumbMeta = {
    key,
    fp,
    byteSize: blob.size,
    storedAt: Date.now(),
    lastUsed: Date.now(),
  }
  await putEntry(db, key, blob, meta)
}

/**
 * 阶梯降采样:先按 1/2 逐级缩小,最后一步到位,避免大图单步缩小产生锯齿。
 * 仅后端解不了的格式(avif/heic/heif)走这里。
 */
async function downscaleToBlob(bitmap: ImageBitmap, maxEdge: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / bitmap.width, maxEdge / bitmap.height)
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

  const draw = (
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    width: number,
    height: number,
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx)
      throw new Error('canvas 2d context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height)
    return canvas
  }

  let width = bitmap.width
  let height = bitmap.height
  let current: CanvasImageSource = bitmap
  while (width > targetWidth * 2 || height > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.round(width / 2))
    const nextHeight = Math.max(targetHeight, Math.round(height / 2))
    const next = draw(current, width, height, nextWidth, nextHeight)
    current = next
    width = nextWidth
    height = nextHeight
  }

  const canvas = draw(current, width, height, targetWidth, targetHeight)
  // 不支持 webp 编码的环境 canvas.toBlob 会回退输出 png(保留透明通道)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else
        reject(new Error('canvas.toBlob failed'))
    }, 'image/webp', 0.82)
  })
}

/** 拉取原图流并生成 <= maxEdge 的缩略 blob;失败返回 null */
async function downloadAndDownscale(streamUrl: string, maxEdge: number, signal?: AbortSignal) {
  if (typeof createImageBitmap !== 'function')
    return null

  const response = await fetch(streamUrl, { signal, credentials: 'same-origin' })
  if (!response.ok)
    return null
  const sourceBlob = await response.blob()

  const bitmap = await createImageBitmap(sourceBlob)
  try {
    if (bitmap.width <= maxEdge && bitmap.height <= maxEdge) {
      // 原图本身已足够小:直接复用原 blob,避免二次有损压缩
      return sourceBlob
    }
    return await downscaleToBlob(bitmap, maxEdge)
  }
  finally {
    bitmap.close()
  }
}

/** 解码/降采样阶段的全局并发信号量(仅 client 路径) */
let decodeRunning = 0
const decodeWaiters: Array<() => void> = []

async function runWithDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (decodeRunning >= DECODE_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      decodeWaiters.push(resolve)
    })
  }
  decodeRunning += 1
  try {
    return await task()
  }
  finally {
    decodeRunning = Math.max(0, decodeRunning - 1)
    decodeWaiters.shift()?.()
  }
}

async function lookupCached(db: IDBPDatabase<ThumbDb>, key: string, fp: string): Promise<Blob | null> {
  const meta = await db.get(META_STORE, key)
  if (!meta || meta.fp !== fp)
    return null
  const blob = await db.get(BLOB_STORE, key)
  if (!blob) {
    await db.delete(META_STORE, key)
    return null
  }
  // 轻量 LRU touch(限制写频率)
  if (Date.now() - meta.lastUsed > LAST_USED_TOUCH_MS) {
    meta.lastUsed = Date.now()
    await db.put(META_STORE, meta)
  }
  return blob
}

/**
 * 缩略图字节的来源：
 * - `server` 后端生成的缩略图接口；
 * - `client` 原图流地址，由前端 canvas 降采样。
 */
export type ThumbSource
  = | { kind: 'server', url: string }
    | { kind: 'client', url: string }

/**
 * 生成失败的原因，决定调用方的回退动作：
 * - `aborted` 请求被取消（组件卸载 / 滚动出视野）；
 * - `unsupported` 后端不支持该格式（HTTP 415）：调用方应回退原图直连；
 * - `rejected` 后端拒绝，源图超过上限（HTTP 422）：调用方应显示类型图标；
 * - `busy` 服务端暂时繁忙（HTTP 503）：显示图标，但**不要**记住这次失败，下次还能重试；
 * - `failed` 网络 / 配额 / 解码失败：调用方应显示类型图标。
 */
export type ThumbFailureReason
  = | 'aborted'
    | 'unsupported'
    | 'rejected'
    | 'busy'
    | 'failed'

export type ThumbResolveResult
  = | { ok: true, url: string }
    | { ok: false, reason: ThumbFailureReason }

async function fetchThumbBlob(source: ThumbSource, signal?: AbortSignal): Promise<Blob> {
  if (source.kind === 'client') {
    const blob = await runWithDecodeSlot(() => downloadAndDownscale(source.url, IMAGE_THUMB_MAX_EDGE, signal))
    if (!blob)
      throw new Error('client downscale failed')
    return blob
  }

  const response = await fetch(source.url, { signal, credentials: 'same-origin' })
  if (response.status === 415)
    throw new UnsupportedFormatError()
  if (response.status === 422)
    throw new RejectedImageError()
  if (response.status === 503)
    throw new TransientThumbError()
  if (!response.ok)
    throw new Error(`thumbnail request failed: ${response.status}`)
  return await response.blob()
}

/** 格式/内容问题：重试也还是这个结果 */
class UnsupportedFormatError extends Error {}
/** 后端按上限拒绝：文件本身的问题，重试无意义 */
class RejectedImageError extends Error {}
/** 服务端暂时繁忙（解码槽位排队超时）：属于可重试失败，调用方不应记成永久结果 */
class TransientThumbError extends Error {}

async function generateAndStore(
  key: string,
  fp: string,
  source: ThumbSource,
  signal?: AbortSignal,
  persist = true,
): Promise<ThumbResolveResult> {
  const existing = inflightGenerations.get(key)
  if (existing)
    return existing

  const generation = (async (): Promise<ThumbResolveResult> => {
    try {
      const blob = await fetchThumbBlob(source, signal)
      if (persist) {
        // 写缓存失败(配额/事务异常)不影响这一次预览
        try {
          await storeBlob(key, fp, blob)
        }
        catch {
          // ignore
        }
      }
      return { ok: true, url: URL.createObjectURL(blob) }
    }
    catch (error) {
      if (isAbortError(error))
        return { ok: false, reason: 'aborted' }
      if (error instanceof UnsupportedFormatError)
        return { ok: false, reason: 'unsupported' }
      if (error instanceof RejectedImageError)
        return { ok: false, reason: 'rejected' }
      if (error instanceof TransientThumbError)
        return { ok: false, reason: 'busy' }
      return { ok: false, reason: 'failed' }
    }
  })()

  inflightGenerations.set(key, generation)
  try {
    return await generation
  }
  finally {
    inflightGenerations.delete(key)
  }
}

export interface ResolveThumbOptions {
  /** 缓存主键:服务端绝对路径 */
  key: string
  /** 文件字节数(指纹的一部分) */
  size: number
  /** 文件最后修改时间(指纹的一部分) */
  lastModified: number
  /** 缩略图字节来源 */
  source: ThumbSource
  signal?: AbortSignal
}

/**
 * 解析缩略图 objectURL。
 * 命中缓存 → 直接返回;未命中 → 按 source 取字节、入库后返回。
 * 失败时返回带原因的结果,由调用方决定回退直连原图还是显示类型图标。
 */
export async function resolveImageThumb(options: ResolveThumbOptions): Promise<ThumbResolveResult> {
  try {
    await ensureReady()

    const key = normalizeThumbKey(options.key)
    const fp = thumbFingerprint(options.size, options.lastModified)

    if (ready) {
      const db = await openThumbDb()
      const hit = await lookupCached(db, key, fp)
      if (hit)
        return { ok: true, url: URL.createObjectURL(hit) }
    }

    if (options.signal?.aborted)
      return { ok: false, reason: 'aborted' }

    // 缓存不可用(隐私模式 / 配额策略)时照常取缩略图,只是不入库 ——
    // 不能因为存储不可用就退化成类型图标。
    return await generateAndStore(key, fp, options.source, options.signal, ready)
  }
  catch {
    return { ok: false, reason: 'failed' }
  }
}

/**
 * 仅查缓存(不下载、不生成):指纹匹配则返回 objectURL,否则返回 null。
 */
export async function getCachedImageThumbUrl(options: { key: string, size: number, lastModified: number }): Promise<string | null> {
  try {
    await ensureReady()
    if (!ready)
      return null
    const db = await openThumbDb()
    const key = normalizeThumbKey(options.key)
    const fp = thumbFingerprint(options.size, options.lastModified)
    const blob = await lookupCached(db, key, fp)
    return blob ? URL.createObjectURL(blob) : null
  }
  catch {
    return null
  }
}

/** 当前缓存真实占用(只读 meta,不加载 blob) */
export async function getImageThumbCacheStats(): Promise<{ entries: number, bytes: number }> {
  try {
    const db = await openThumbDb()
    let cursor = await db.transaction(META_STORE).store.openCursor()
    let entries = 0
    let bytes = 0
    while (cursor) {
      entries += 1
      bytes += cursor.value.byteSize
      cursor = await cursor.continue()
    }
    return { entries, bytes }
  }
  catch {
    return { entries: 0, bytes: 0 }
  }
}

/** 清空整库 */
export async function clearImageThumbCache(): Promise<void> {
  try {
    const db = await openThumbDb()
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
    tx.objectStore(META_STORE).clear()
    tx.objectStore(BLOB_STORE).clear()
    await tx.done
  }
  catch {
    // ignore
  }
  totalBytes = 0
  totalEntries = 0
}
