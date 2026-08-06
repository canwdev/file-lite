import type { AxiosResponse } from 'axios'
import type { ServiceRequestConfig } from '@/utils/service'
import service from '@/utils/service'

const ONE_MB = 1024 * 1024
const DEFAULT_SIZE_MB = 500
const MIN_SIZE_MB = 1
const MAX_SIZE_MB = 2048
const SAMPLE_INTERVAL_MS = 200
const baseURL = `/api/speed-test`

export interface SpeedMetrics {
  bytes: number
  durationMs: number
  currentMBps: number
  currentMbps: number
  avgMBps: number
  avgMbps: number
  maxMBps: number
  maxMbps: number
  minMBps: number
  minMbps: number
}

interface RunSpeedTestOptions {
  sizeMB?: number
  signal?: AbortSignal
  onProgress?: (metrics: SpeedMetrics) => void
}

function clampSizeMB(sizeMB = DEFAULT_SIZE_MB) {
  if (!Number.isFinite(sizeMB)) {
    return DEFAULT_SIZE_MB
  }
  return Math.min(MAX_SIZE_MB, Math.max(MIN_SIZE_MB, Math.floor(sizeMB)))
}

function toMBps(bytes: number, durationMs: number) {
  if (durationMs <= 0) {
    return 0
  }
  return bytes / ONE_MB / (durationMs / 1000)
}

function createMetrics(bytes: number, durationMs: number, currentBytes: number, currentDurationMs: number, maxMBps: number, minMBps: number): SpeedMetrics {
  const currentMBps = toMBps(currentBytes, currentDurationMs)
  const avgMBps = toMBps(bytes, durationMs)
  const normalizedMinMBps = Number.isFinite(minMBps) ? minMBps : currentMBps

  return {
    bytes,
    durationMs,
    currentMBps,
    currentMbps: currentMBps * 8,
    avgMBps,
    avgMbps: avgMBps * 8,
    maxMBps,
    maxMbps: maxMBps * 8,
    minMBps: normalizedMinMBps,
    minMbps: normalizedMinMBps * 8,
  }
}

function createProgressTracker(onProgress?: (metrics: SpeedMetrics) => void) {
  const startedAt = performance.now()
  let lastSampleAt = startedAt
  let lastLoaded = 0
  let maxMBps = 0
  let minMBps = Number.POSITIVE_INFINITY

  function emit(loaded: number, force = false) {
    const now = performance.now()
    const totalDurationMs = Math.max(now - startedAt, 1)
    const sampleDurationMs = Math.max(now - lastSampleAt, 1)
    const sampleBytes = Math.max(loaded - lastLoaded, 0)

    if (!force && sampleDurationMs < SAMPLE_INTERVAL_MS && loaded !== 0) {
      return
    }

    const currentMBps = toMBps(sampleBytes, sampleDurationMs)
    if (sampleBytes > 0) {
      maxMBps = Math.max(maxMBps, currentMBps)
      minMBps = Math.min(minMBps, currentMBps)
    }

    const metrics = createMetrics(loaded, totalDurationMs, sampleBytes, sampleDurationMs, maxMBps, minMBps)
    onProgress?.(metrics)

    lastSampleAt = now
    lastLoaded = loaded
  }

  return {
    emit,
    finish(loaded: number) {
      const now = performance.now()
      const totalDurationMs = Math.max(now - startedAt, 1)
      const sampleDurationMs = Math.max(now - lastSampleAt, 1)
      const sampleBytes = Math.max(loaded - lastLoaded, 0)
      const currentMBps = toMBps(sampleBytes, sampleDurationMs)

      if (sampleBytes > 0) {
        maxMBps = Math.max(maxMBps, currentMBps)
        minMBps = Math.min(minMBps, currentMBps)
      }

      return createMetrics(loaded, totalDurationMs, sampleBytes, sampleDurationMs, maxMBps, minMBps)
    },
  }
}

function buildUrl(path: 'download' | 'upload', sizeMB: number) {
  return `${baseURL}/${path}?sizeMB=${sizeMB}`
}

function createUploadBody(sizeMB: number) {
  const chunk = new Uint8Array(ONE_MB)
  return new Blob(Array.from<BlobPart>({ length: sizeMB }).fill(chunk), {
    type: 'application/octet-stream',
  })
}

export async function runDownloadSpeedTest(options: RunSpeedTestOptions = {}) {
  const sizeMB = clampSizeMB(options.sizeMB)
  const tracker = createProgressTracker(options.onProgress)
  let loaded = 0

  tracker.emit(0, true)

  const response = await service.get(buildUrl('download', sizeMB), {
    signal: options.signal,
    responseType: 'blob',
    isToast: false,
    isRawResponse: true,
    onDownloadProgress(event) {
      loaded = event.loaded ?? loaded
      tracker.emit(loaded)
    },
  } satisfies ServiceRequestConfig) as AxiosResponse<Blob>

  return tracker.finish(Number(response.headers['content-length']) || response.data.size || loaded)
}

export async function runUploadSpeedTest(options: RunSpeedTestOptions = {}) {
  const sizeMB = clampSizeMB(options.sizeMB)
  const tracker = createProgressTracker(options.onProgress)
  const body = createUploadBody(sizeMB)

  tracker.emit(0, true)

  await service.post(buildUrl('upload', sizeMB), body, {
    headers: { 'Content-Type': 'application/octet-stream' },
    signal: options.signal,
    isToast: false,
    onUploadProgress(event) {
      tracker.emit(event.loaded ?? 0)
    },
  } satisfies ServiceRequestConfig)

  return tracker.finish(body.size)
}
