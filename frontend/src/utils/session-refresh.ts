import axios from 'axios'
import { readAuthSession } from '@/store/auth'

const CSRF_HEADER = 'X-File-Lite-CSRF'
const REFRESH_URL = '/api/session/refresh'

/**
 * The outcome of a renewal attempt.
 *
 * `rejected` means the server refused the credential (401/403) and the session
 * is gone. `unavailable` means no verdict was reached (network failure, 5xx),
 * so the caller must keep the session and may retry later.
 */
export type SessionRefreshResult = 'renewed' | 'rejected' | 'unavailable'

let inFlight: Promise<SessionRefreshResult> | null = null

/**
 * Exchange the current cookie pair for a fresh access token.
 *
 * Uses bare axios on purpose: going through `service` would re-enter the 401
 * interceptor. Concurrent callers share one request, and the backend never
 * rotates the readable session cookie, so the CSRF value stays valid.
 */
export function refreshSessionOnce(): Promise<SessionRefreshResult> {
  if (inFlight) {
    return inFlight
  }

  const session = readAuthSession()
  if (!session) {
    return Promise.resolve('rejected')
  }

  inFlight = axios
    .post(REFRESH_URL, null, {
      headers: { [CSRF_HEADER]: session },
    })
    .then(() => 'renewed' as const)
    .catch((error) => {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      return status === 401 || status === 403 ? 'rejected' as const : 'unavailable' as const
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * Fetch a same-origin resource and renew the access token once if the server
 * answers 401.
 *
 * Use it for safe, replayable requests only (GET / HEAD / media reads): a
 * request body that is a stream cannot be sent twice. Auth middleware rejects
 * before the handler runs, so replaying a rejected request has no side effects.
 */
export async function fetchWithSessionRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status !== 401) {
    return response
  }
  // A body that is a stream cannot be replayed; this helper is only for
  // idempotent reads. Reject anything that is not GET/HEAD, including a Request
  // object whose method lives on the object rather than in init.
  let method = init?.method
  if (!method && typeof Request !== 'undefined' && input instanceof Request) {
    method = input.method
  }
  const upper = (method ?? 'GET').toUpperCase()
  if (upper !== 'GET' && upper !== 'HEAD') {
    return response
  }
  const result = await refreshSessionOnce()
  if (result !== 'renewed') {
    return response
  }
  return await fetch(input, init)
}
