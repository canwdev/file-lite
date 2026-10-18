import { onMounted, onUnmounted, watch } from 'vue'
import { authSession, authSessionExpiresAt, authSessionRemainingSeconds, authSessionRenewable } from '@/store/auth'
import { refreshSessionOnce } from '@/utils/session-refresh'

/** Renew every five minutes: the access token is short-lived, the tab may be idle. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
/**
 * Switching windows fires focus/visibility several times a minute. A renewal
 * that just happened cannot be stale, so those events do not each need a POST.
 */
const WAKE_REFRESH_MIN_GAP_MS = 60 * 1000
/** The temporary-session badge only needs a coarse countdown. */
const REMAINING_TICK_MS = 30 * 1000

/**
 * Keep a renewable access token fresh while the app is open, and log a fixed
 * ticket session out exactly when its token expires.
 *
 * A renewable session still relies on the server renewing on use; this covers
 * idle periods. Timers in a hidden tab are throttled, so visibility/focus also
 * check the deadline (and the service interceptor's 401 remains the fallback).
 */
export function useSessionAutoRefresh() {
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let lastRefreshAt = 0
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let remainingTimer: ReturnType<typeof setInterval> | null = null

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  const clearExpiryTimers = () => {
    if (expiryTimer) {
      clearTimeout(expiryTimer)
      expiryTimer = null
    }
    if (remainingTimer) {
      clearInterval(remainingTimer)
      remainingTimer = null
    }
  }

  const updateRemaining = () => {
    const expiresAt = authSessionExpiresAt.value
    authSessionRemainingSeconds.value = expiresAt > 0
      ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      : 0
  }

  const logout = () => {
    if (!authSession.value) {
      return
    }
    authSessionRemainingSeconds.value = 0
    window.$logout?.(false)
  }

  const refresh = () => {
    if (!authSession.value) {
      return
    }
    lastRefreshAt = Date.now()
    void refreshSessionOnce().then((result) => {
      if (result === 'rejected') {
        logout()
      }
    })
  }

  const scheduleExpiry = () => {
    clearExpiryTimers()
    updateRemaining()
    remainingTimer = setInterval(updateRemaining, REMAINING_TICK_MS)
    const delay = authSessionExpiresAt.value - Date.now()
    if (delay <= 0) {
      logout()
      return
    }
    expiryTimer = setTimeout(logout, delay)
  }

  const schedule = () => {
    clearRefreshTimer()
    clearExpiryTimers()
    if (!authSession.value) {
      authSessionRemainingSeconds.value = 0
      return
    }
    // A fixed tier must not heartbeat; the refresh endpoint would only no-op.
    // Without a deadline (old server / partial payload) keep the heartbeat as a
    // fallback so a 401 still signs the user out at the server's deadline.
    if (!authSessionRenewable.value && authSessionExpiresAt.value > 0) {
      scheduleExpiry()
      return
    }
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS)
  }

  const onWake = () => {
    if (!authSession.value) {
      return
    }
    if (!authSessionRenewable.value && authSessionExpiresAt.value > 0) {
      updateRemaining()
      if (Date.now() >= authSessionExpiresAt.value) {
        logout()
        return
      }
      // Re-arm the timeout: a throttled hidden-tab timer may have been delayed.
      scheduleExpiry()
      return
    }
    // The heartbeat already keeps an active tab fresh, so an alt-tab does not
    // need its own renewal.
    if (Date.now() - lastRefreshAt < WAKE_REFRESH_MIN_GAP_MS) {
      return
    }
    refresh()
  }

  const onVisibilityChange = () => {
    if (!document.hidden) {
      onWake()
    }
  }

  /** The network came back: a failed renewal may just have been offline. */
  const onOnline = () => {
    lastRefreshAt = 0
    onWake()
  }

  onMounted(() => {
    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onWake)
  })

  watch([authSession, authSessionRenewable, authSessionExpiresAt], schedule)

  onUnmounted(() => {
    clearRefreshTimer()
    clearExpiryTimers()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onWake)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('pageshow', onWake)
  })
}
