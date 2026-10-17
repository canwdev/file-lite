import type { Ref } from 'vue'
import { onBeforeUnmount, watch } from 'vue'
import { refreshSessionOnce } from '@/utils/session-refresh'

/**
 * Media elements are fetched by the browser, not by the service interceptor, so
 * a 401 after the tab was suspended cannot be recovered by the normal request
 * retry. This hook renews the session once and reloads the same source, then
 * restores the playback position and resumes if it was playing.
 *
 * A media element does not always emit `error` for a rejected range request: it
 * may retry internally and then sit at `readyState = 0` (or stall mid-playback)
 * without reporting anything. Two watchdogs cover that:
 *
 * - no `loadedmetadata` within METADATA_TIMEOUT_MS after a load starts;
 * - no playback progress within STALL_TIMEOUT_MS after `waiting` / `stalled` /
 *   `seeking` while the element wants data.
 *
 * A broken file also costs one renewal attempt. Failure is remembered per source
 * so a file that cannot be decoded does not refresh in a loop; switching to a
 * different source clears it.
 */

/** No metadata after a load starts: the request likely never succeeded. */
const METADATA_TIMEOUT_MS = 8_000
/** No progress after the element said it needs data. */
const STALL_TIMEOUT_MS = 5_000
/** A reload that never reaches metadata is a failure, not a hang. */
const RELOAD_TIMEOUT_MS = 8_000
/** Do not renew the same source twice in this window. */
const RECOVERY_COOLDOWN_MS = 10_000

export function useMediaSessionRecovery(
  element: Ref<HTMLMediaElement | null>,
  onFailure?: () => void,
) {
  let current: HTMLMediaElement | null = null
  let abort: AbortController | null = null
  let loadTimer = 0
  let stallTimer = 0
  let stallStartTime = 0
  let lastAttemptSrc = ''
  let lastAttemptAt = 0
  let failedSrc = ''
  let recovering = false

  const failure = onFailure ?? (() => window.$message?.error($t('file_lite_i18n.failed')))

  function sourceOf(el: HTMLMediaElement): string {
    return el.currentSrc || el.src || ''
  }

  function clearTimers() {
    window.clearTimeout(loadTimer)
    window.clearTimeout(stallTimer)
    loadTimer = 0
    stallTimer = 0
  }

  function noteSource(src: string) {
    if (src !== lastAttemptSrc) {
      failedSrc = ''
      lastAttemptAt = 0
    }
  }

  function scheduleLoadWatchdog(el: HTMLMediaElement) {
    window.clearTimeout(loadTimer)
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return
    }
    const src = sourceOf(el)
    if (!src) {
      return
    }
    loadTimer = window.setTimeout(() => {
      loadTimer = 0
      if (el !== current || el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return
      }
      void attemptRecovery(el, src)
    }, METADATA_TIMEOUT_MS)
  }

  function scheduleStallWatchdog(el: HTMLMediaElement) {
    window.clearTimeout(stallTimer)
    stallStartTime = el.currentTime
    stallTimer = window.setTimeout(() => {
      stallTimer = 0
      if (el !== current) {
        return
      }
      const advanced = el.currentTime > stallStartTime + 0.1
      if (advanced || el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        return
      }
      void attemptRecovery(el, sourceOf(el))
    }, STALL_TIMEOUT_MS)
  }

  async function reload(el: HTMLMediaElement, currentTime: number, wasPlaying: boolean): Promise<boolean> {
    const loaded = await new Promise<boolean>((resolve) => {
      let settled = false
      let timer = 0
      function finish(ok: boolean) {
        if (settled) {
          return
        }
        settled = true
        el.removeEventListener('loadedmetadata', onMetadata)
        el.removeEventListener('error', onError)
        window.clearTimeout(timer)
        resolve(ok)
      }
      function onMetadata() {
        finish(true)
      }
      function onError() {
        finish(false)
      }
      timer = window.setTimeout(finish, RELOAD_TIMEOUT_MS, false)
      el.addEventListener('loadedmetadata', onMetadata)
      el.addEventListener('error', onError)
      try {
        el.load()
      }
      catch {
        finish(false)
      }
    })

    if (!loaded || el !== current) {
      return false
    }

    if (Number.isFinite(currentTime) && currentTime > 0) {
      try {
        el.currentTime = currentTime
      }
      catch {
        // Some formats reject a seek before their seekable range exists.
      }
    }
    if (wasPlaying) {
      await el.play().catch(() => {})
    }
    return true
  }

  async function recover(el: HTMLMediaElement, src: string) {
    const time = Number.isFinite(el.currentTime) ? el.currentTime : 0
    const wasPlaying = !el.paused

    const result = await refreshSessionOnce()
    if (result !== 'renewed') {
      failedSrc = src
      failure()
      return
    }
    if (el !== current || sourceOf(el) !== src) {
      // The viewer switched media while the renewal was in flight.
      return
    }

    const ok = await reload(el, time, wasPlaying)
    if (!ok && el === current) {
      failedSrc = src
      failure()
    }
  }

  async function attemptRecovery(el: HTMLMediaElement, src: string) {
    if (!src || recovering || src === failedSrc) {
      return
    }

    noteSource(src)
    const now = Date.now()
    if (src === lastAttemptSrc && now - lastAttemptAt < RECOVERY_COOLDOWN_MS) {
      failure()
      return
    }

    lastAttemptSrc = src
    lastAttemptAt = now
    recovering = true
    try {
      await recover(el, src)
    }
    finally {
      recovering = false
    }
  }

  function onLoadStart() {
    const el = current
    if (!el) {
      return
    }
    noteSource(sourceOf(el))
    window.clearTimeout(stallTimer)
    stallTimer = 0
    scheduleLoadWatchdog(el)
  }

  // `canplay` already implies enough metadata for the load watchdog.
  function onMetadata() {
    window.clearTimeout(loadTimer)
    loadTimer = 0
    failedSrc = ''
  }

  function onProgress() {
    window.clearTimeout(stallTimer)
    stallTimer = 0
    failedSrc = ''
  }

  function onNeedsData() {
    const el = current
    // Before metadata the load watchdog owns the timeout; a slow first load
    // must not be mistaken for a stalled seek.
    if (!el || el.readyState < HTMLMediaElement.HAVE_METADATA) {
      return
    }
    scheduleStallWatchdog(el)
  }

  function onSeeking() {
    const el = current
    if (!el || el.readyState < HTMLMediaElement.HAVE_METADATA) {
      return
    }
    window.clearTimeout(stallTimer)
    scheduleStallWatchdog(el)
  }

  function onError() {
    const el = current
    if (!el) {
      return
    }
    const src = sourceOf(el)
    noteSource(src)
    clearTimers()
    void attemptRecovery(el, src)
  }

  watch(element, (el) => {
    abort?.abort()
    abort = null
    clearTimers()
    current = el ?? null
    failedSrc = ''
    lastAttemptSrc = ''
    lastAttemptAt = 0
    if (!current) {
      return
    }

    abort = new AbortController()
    const opts = { signal: abort.signal }
    current.addEventListener('loadstart', onLoadStart, opts)
    current.addEventListener('loadedmetadata', onMetadata, opts)
    current.addEventListener('canplay', onMetadata, opts)
    current.addEventListener('playing', onProgress, opts)
    current.addEventListener('timeupdate', onProgress, opts)
    current.addEventListener('waiting', onNeedsData, opts)
    current.addEventListener('stalled', onNeedsData, opts)
    current.addEventListener('seeking', onSeeking, opts)
    current.addEventListener('seeked', onProgress, opts)
    current.addEventListener('error', onError, opts)

    // The source may have been set before this hook attached (the element is
    // created by the template or by Artplayer). A load that is already stuck —
    // including one whose `loadstart` fired before attachment — still needs a
    // watchdog, so do not depend on networkState here.
    if (sourceOf(current) && current.readyState < HTMLMediaElement.HAVE_METADATA) {
      scheduleLoadWatchdog(current)
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    clearTimers()
    abort?.abort()
    abort = null
    current = null
  })
}
