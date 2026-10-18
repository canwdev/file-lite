import type { Ref } from 'vue'
import { onBeforeUnmount, watch } from 'vue'
import { refreshSessionOnce } from '@/utils/session-refresh'

/**
 * Media elements are fetched by the browser, not by the service interceptor, so
 * a request the server rejects cannot be recovered by the normal 401 retry. This
 * hook repairs that:
 *
 * - a request rejected because the session ended is renewed once and the same
 *   source is reloaded at the same position;
 * - a load that never reports an error but makes no progress is given one more
 *   chance, because the browser may sit at `readyState = 0` without telling us.
 *
 * Two rules keep the repair from making things worse:
 *
 * - A renewal is only attempted when the server says the session is the reason.
 *   A slow disk, a dropped connection or a file the browser cannot decode is not
 *   an auth failure, and a POST per stall is both useless and noisy. The hook
 *   probes the same URL with a cheap HEAD first and renews only on 401.
 * - A paused element never makes progress, so it is never considered stalled:
 *   reloading it would only throw away the buffer and the position while the
 *   user is away.
 *
 * A failure is remembered per source so a file that cannot be decoded does not
 * reload in a loop, but pressing play is an explicit retry: it clears the
 * remembered failure instead of leaving the player permanently dead.
 */

/** No metadata after a load starts: the request likely never succeeded. */
const METADATA_TIMEOUT_MS = 10_000
/** No progress after the element said it needs data. */
const STALL_TIMEOUT_MS = 5_000
/** The transfer may simply be slow: probe the session, then wait some more. */
const STALL_GRACE_MS = 15_000
/** A reload that never reaches metadata is a failure, not a hang. */
const RELOAD_TIMEOUT_MS = 15_000
/** Do not reload the same source twice in this window. */
const RECOVERY_COOLDOWN_MS = 10_000
/**
 * After a failed recovery the element can be left in a hard error state that
 * `play()` rejects without even firing `play`, so a click could not retry it.
 * Try again on our own, twice, then leave it to a new source.
 */
const RETRY_DELAYS_MS = [30_000, 120_000]

/**
 * Ask the server whether the URL is still acceptable. A 401 means the access
 * token is the reason the media element failed; any other answer (including a
 * network error, which gives no verdict) means a renewal would not help.
 */
async function mediaRejectedBySession(src: string): Promise<boolean> {
  // Local files never involve the session.
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    return false
  }
  try {
    const response = await fetch(src, {
      method: 'HEAD',
      credentials: 'include',
      cache: 'no-store',
    })
    // The auth middleware answers 401 before the handler runs, so this probes
    // exactly the same credential the media request used.
    return response.status === 401
  }
  catch {
    return false
  }
}

export function useMediaSessionRecovery(
  element: Ref<HTMLMediaElement | null>,
  onFailure?: () => void,
) {
  let current: HTMLMediaElement | null = null
  let abort: AbortController | null = null
  let loadTimer = 0
  let stallTimer = 0
  let retryTimer = 0
  let retryCount = 0
  let failureNoticeSrc = ''
  let stallActive = false
  let stallStartTime = 0
  let lastAttemptSrc = ''
  let lastAttemptAt = 0
  /** Where the viewer was before a reload threw the element's position away. */
  let lastPosition = 0
  let lastPositionSrc = ''
  /**
   * Whether the viewer wanted playback, independent of the element's `paused`
   * flag: a media error can clear that flag's state without a pause event, and
   * a recovery must not turn a playing video into a paused one (or the other
   * way round).
   */
  let lastPlayIntent = false
  /** A `play`/`pause` event was seen, so `lastPlayIntent` is authoritative. */
  let intentKnown = false
  let failedSrc = ''
  let recovering = false

  const failure = onFailure ?? (() => window.$message?.error($t('file_lite_i18n.failed')))

  function sourceOf(el: HTMLMediaElement): string {
    return el.currentSrc || el.src || ''
  }

  function clearTimers() {
    window.clearTimeout(loadTimer)
    window.clearTimeout(stallTimer)
    window.clearTimeout(retryTimer)
    loadTimer = 0
    stallTimer = 0
    retryTimer = 0
    stallActive = false
  }

  function resetRetries() {
    window.clearTimeout(retryTimer)
    retryTimer = 0
    retryCount = 0
    failureNoticeSrc = ''
  }

  function noteSource(src: string) {
    if (src !== lastAttemptSrc) {
      failedSrc = ''
      lastAttemptAt = 0
      resetRetries()
    }
    if (src !== lastPositionSrc) {
      lastPosition = 0
      lastPositionSrc = src
      lastPlayIntent = false
      intentKnown = false
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
    stallActive = true
    stallStartTime = el.currentTime
    stallTimer = window.setTimeout(() => {
      void checkStall(el)
    }, STALL_TIMEOUT_MS)
  }

  /**
   * Decide what a lack of progress means.
   *
   * The first check happens after five seconds. If the session is the reason,
   * recover at once. Otherwise the transfer is probably just slow: keep waiting
   * (without touching the buffer), and only reload if the element is still stuck
   * after the grace period. Nothing here applies while paused.
   */
  async function checkStall(el: HTMLMediaElement) {
    stallTimer = 0
    if (el !== current || el.paused || !needsData(el)) {
      stallActive = false
      return
    }
    const src = sourceOf(el)
    if (src && await mediaRejectedBySession(src)) {
      await attemptRecovery(el, src, { authRejected: true, force: true })
      return
    }
    // The probe took a while; re-check before arming the grace period.
    if (el !== current || el.paused || !needsData(el)) {
      stallActive = false
      return
    }
    window.clearTimeout(stallTimer)
    stallTimer = window.setTimeout(() => {
      stallTimer = 0
      stallActive = false
      if (el !== current || el.paused || !needsData(el)) {
        return
      }
      void attemptRecovery(el, sourceOf(el))
    }, STALL_GRACE_MS)
  }

  /** True while a playing element is still waiting for data it needs. */
  function needsData(el: HTMLMediaElement): boolean {
    return el.currentTime <= stallStartTime + 0.1 && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
  }

  async function reload(
    el: HTMLMediaElement,
    currentTime: number,
    wasPlaying: boolean,
    shouldStayPaused: boolean,
  ): Promise<boolean> {
    let guardTimer = 0
    /**
     * A paused reload must not start playing: Artplayer leaves the `autoplay`
     * attribute on the element, and the load algorithm honours it once enough
     * data arrives, even though the viewer had paused.
     */
    function keepPaused() {
      // The element cannot tell its own autoplay apart from a user play, so a
      // paused recovery always pauses here; the position and the paused state
      // are what a recovery promised to preserve.
      if (el === current) {
        el.pause()
      }
      cancelKeepPaused()
    }
    function cancelKeepPaused() {
      el.removeEventListener('canplay', keepPaused)
      window.clearTimeout(guardTimer)
      guardTimer = 0
    }

    const loaded = await new Promise<boolean>((resolve) => {
      let settled = false
      let timer = 0
      function finish(ok: boolean) {
        if (settled) {
          return
        }
        settled = true
        el.removeEventListener('loadedmetadata', onMetadata)
        window.removeEventListener('error', onError, { capture: true })
        window.clearTimeout(timer)
        resolve(ok)
      }
      function onMetadata() {
        finish(true)
      }
      function onError(event: Event) {
        // The hook intercepts media errors in the capture phase, so the reload
        // counts its own failure there as well.
        if (event.target === el) {
          finish(false)
        }
      }
      timer = window.setTimeout(finish, RELOAD_TIMEOUT_MS, false)
      el.addEventListener('loadedmetadata', onMetadata)
      window.addEventListener('error', onError, { capture: true })
      if (shouldStayPaused) {
        el.addEventListener('canplay', keepPaused)
        // A source that never becomes playable must not keep a stale guard
        // that would pause the next, user-initiated play.
        guardTimer = window.setTimeout(cancelKeepPaused, 3_000)
      }
      try {
        el.load()
      }
      catch {
        finish(false)
      }
    })

    if (!loaded || el !== current) {
      cancelKeepPaused()
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
      cancelKeepPaused()
      await el.play().catch(() => {})
    }
    else if (shouldStayPaused) {
      // `canplay` may already have fired; pause again so an autoplay element
      // does not start itself behind the user's back.
      el.pause()
    }
    // With no play/pause event yet the viewer has not expressed an intent (a
    // freshly opened video), so the element's own autoplay decides.
    return true
  }

  /**
   * Renew the session when it is the reason, then reload the same source.
   *
   * `authRejected` lets a caller that already probed the URL skip the HEAD.
   */
  async function recover(el: HTMLMediaElement, src: string, authRejected?: boolean) {
    // A failed reload resets the element to 0; the position the viewer had is
    // remembered so a retry does not silently restart the file.
    const elementTime = Number.isFinite(el.currentTime) ? el.currentTime : 0
    const time = elementTime > 0
      ? elementTime
      : (lastPositionSrc === src ? lastPosition : 0)
    const wasPlaying = intentKnown && lastPlayIntent
    const shouldStayPaused = intentKnown && !lastPlayIntent
    const rejected = authRejected ?? await mediaRejectedBySession(src)

    if (rejected) {
      const result = await refreshSessionOnce()
      if (result !== 'renewed') {
        failedSrc = src
        if (failureNoticeSrc !== src) {
          failureNoticeSrc = src
          failure()
        }
        scheduleRetry(el, src)
        return
      }
    }
    if (el !== current || sourceOf(el) !== src) {
      // The viewer switched media while the probe/renewal was in flight.
      return
    }

    const ok = await reload(el, time, wasPlaying, shouldStayPaused)
    if (!ok && el === current) {
      failedSrc = src
      if (failureNoticeSrc !== src) {
        failureNoticeSrc = src
        failure()
      }
      scheduleRetry(el, src)
    }
  }

  /** One more attempt after a bounded delay; false when the budget is spent. */
  function scheduleRetry(el: HTMLMediaElement, src: string): boolean {
    const delay = RETRY_DELAYS_MS[retryCount]
    if (delay === undefined || el !== current) {
      return false
    }
    retryCount += 1
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      if (el !== current || sourceOf(el) !== src || recovering) {
        return
      }
      void attemptRecovery(el, src, { force: true })
    }, delay)
    return true
  }

  interface RecoveryOptions {
    /** The caller already probed the URL and knows the session rejected it. */
    authRejected?: boolean
    /** Try again even though the previous attempt for this source failed. */
    force?: boolean
    /** An explicit user retry: it gets a fresh backoff budget of its own. */
    resetBackoff?: boolean
  }

  /**
   * Run one recovery for a source.
   *
   * A source whose previous attempt failed is normally left alone, so a file the
   * browser cannot decode does not reload in a loop. `force` lifts that for the
   * bounded retries and for the viewer pressing play.
   */
  async function attemptRecovery(
    el: HTMLMediaElement,
    src: string,
    options: RecoveryOptions = {},
  ) {
    const { authRejected, force = false, resetBackoff = false } = options
    if (!src || recovering) {
      return
    }
    if (src === failedSrc && !force) {
      return
    }

    noteSource(src)
    const now = Date.now()
    if (!force && src === lastAttemptSrc && now - lastAttemptAt < RECOVERY_COOLDOWN_MS) {
      return
    }

    if (resetBackoff) {
      failedSrc = ''
      resetRetries()
    }
    lastAttemptSrc = src
    lastAttemptAt = now
    recovering = true
    try {
      await recover(el, src, authRejected)
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
    stallActive = false
    scheduleLoadWatchdog(el)
  }

  // `canplay` already implies enough metadata for the load watchdog.
  function onMetadata() {
    window.clearTimeout(loadTimer)
    loadTimer = 0
    stallActive = false
    failedSrc = ''
    resetRetries()
  }

  function onProgress() {
    const el = current
    window.clearTimeout(stallTimer)
    stallTimer = 0
    stallActive = false
    failedSrc = ''
    if (retryTimer || retryCount || failureNoticeSrc) {
      resetRetries()
    }
    if (el && el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      lastPosition = el.currentTime
      lastPositionSrc = sourceOf(el)
    }
  }

  function onNeedsData() {
    const el = current
    // A paused element has no progress to make; the load watchdog owns the time
    // before metadata. Only a playing element can really be stalled.
    if (!el || el.paused || el.readyState < HTMLMediaElement.HAVE_METADATA) {
      return
    }
    if (stallActive) {
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

  function onPause() {
    lastPlayIntent = false
    intentKnown = true
  }

  /**
   * Coming back to the tab is a good moment to retry a source the bounded
   * backoff has given up on: the element can be in a hard error state where
   * `play()` rejects without firing an event, so a click alone cannot do it.
   */
  function onWake() {
    if (document.hidden || recovering) {
      return
    }
    const el = current
    const src = el ? sourceOf(el) : ''
    if (!el || !src || src !== failedSrc) {
      return
    }
    void attemptRecovery(el, src, { force: true })
  }

  function onPlay() {
    const el = current
    if (!el) {
      return
    }
    lastPlayIntent = true
    intentKnown = true
    const src = sourceOf(el)
    if (!src) {
      return
    }
    // Pressing play is an explicit request to try again: a source whose earlier
    // recovery failed must not stay dead until the viewer picks another file.
    if (src === failedSrc || el.error) {
      void attemptRecovery(el, src, { force: true, resetBackoff: true })
      return
    }
    if (!stallActive && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      scheduleStallWatchdog(el)
    }
  }

  /**
   * The hook owns recovery for its element, so the error is intercepted in the
   * capture phase, before the element's own listeners.
   *
   * Artplayer also listens for `error` and answers by reconnecting the source
   * from the beginning, up to five times. That would undo the position the
   * reload is about to restore (and a long pause would restart the film), so it
   * must not run in addition to this recovery.
   */
  function onErrorCapture(event: Event) {
    const el = current
    if (!el || event.target !== el) {
      return
    }
    event.stopPropagation()
    const src = sourceOf(el)
    noteSource(src)
    clearTimers()
    void attemptRecovery(el, src)
  }

  watch(element, (el) => {
    abort?.abort()
    abort = null
    clearTimers()
    resetRetries()
    current = el ?? null
    failedSrc = ''
    lastAttemptSrc = ''
    lastAttemptAt = 0
    lastPosition = 0
    lastPositionSrc = ''
    lastPlayIntent = false
    intentKnown = false
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
    current.addEventListener('play', onPlay, opts)
    current.addEventListener('pause', onPause, opts)
    window.addEventListener('error', onErrorCapture, { capture: true, signal: abort.signal })
    document.addEventListener('visibilitychange', onWake, opts)
    window.addEventListener('focus', onWake, opts)

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
