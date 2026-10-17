import { onMounted, onUnmounted } from 'vue'
import { authSession } from '@/store/auth'
import { refreshSessionOnce } from '@/utils/session-refresh'

/** Renew every five minutes: the access token is short-lived, the tab may be idle. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Keep the short-lived access token fresh while the app is open.
 *
 * The server also renews on use, so this only covers idle periods. Timers in a
 * hidden tab are throttled to about once a minute, still far below the access
 * lifetime. Waking from sleep is covered by the visibility/focus events and by
 * the 401 retry in the service interceptor.
 */
export function useSessionAutoRefresh() {
  let timer: ReturnType<typeof setInterval> | null = null

  const refresh = () => {
    if (authSession.value) {
      void refreshSessionOnce()
    }
  }

  const onVisibilityChange = () => {
    if (!document.hidden) {
      refresh()
    }
  }

  onMounted(() => {
    timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('pageshow', refresh)
  })

  onUnmounted(() => {
    if (timer) {
      clearInterval(timer)
    }
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    window.removeEventListener('pageshow', refresh)
  })
}
