import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, filesDir, PORT } from '../scripts/fixture.mjs'
import { login, openFolder, row, sourceDir } from './helpers'

/**
 * Short-lived access token renewal.
 *
 * Waiting fifteen minutes for a real token to expire would put the suite far
 * over its budget, so these cases mint a token with the server's own signing key
 * and a one-minute-old `exp` but a live `rexp`. The backend treats it exactly
 * like a token that expired while the tab was idle, which is the path under
 * test: the frontend sees 401, exchanges the cookie pair at
 * POST /api/session/refresh, and retries the original request.
 */

const AUTH_COOKIE = 'file_lite_auth_token_http'
const SESSION_COOKIE = 'file_lite_session_http'
const ORIGIN = `http://127.0.0.1:${PORT}`

interface AuthCookie {
  value: string
  exp: number
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

/**
 * Mint a real HS256 JWT with an expired access window and a live renewal
 * window. The claims must match `authClaims` in backend-go/config/config.go.
 */
function mintExpiredAuthToken(): string {
  const configPath = path.join(dataDir, 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { jwtToken?: string }
  if (!config.jwtToken) {
    throw new Error(`jwtToken is missing from ${configPath}`)
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    sub: 'file-lite-user',
    typ: 'access',
    ver: 2,
    iat: now - 16 * 60,
    exp: now - 60,
    rexp: now + 30 * 24 * 60 * 60,
    liat: now - 16 * 60,
    rem: true,
  }))
  const signature = createHmac('sha256', config.jwtToken)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function readAuthCookie(context: BrowserContext): Promise<AuthCookie> {
  const cookie = (await context.cookies()).find(item => item.name === AUTH_COOKIE)
  if (!cookie) {
    throw new Error('auth cookie is missing')
  }
  const payload = JSON.parse(
    Buffer.from(cookie.value.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { exp?: number }
  if (typeof payload.exp !== 'number') {
    throw new Error('auth cookie has no exp claim')
  }
  return { value: cookie.value, exp: payload.exp }
}

/** Replace the HttpOnly auth cookie, keeping the readable CSRF session value. */
async function useExpiredAuthCookie(context: BrowserContext, token: string) {
  const session = (await context.cookies()).find(item => item.name === SESSION_COOKIE)
  if (!session) {
    throw new Error('session cookie is missing')
  }
  await context.addCookies([
    {
      name: AUTH_COOKIE,
      value: token,
      url: ORIGIN,
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      expires: -1,
    },
    {
      name: SESSION_COOKIE,
      value: session.value,
      url: ORIGIN,
      httpOnly: false,
      secure: false,
      sameSite: 'Strict',
      expires: -1,
    },
  ])
}

function isRefreshRequest(request: { method(): string, url(): string }): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === '/api/session/refresh'
}

test('an expired access token refreshes on page load and retries the request', async ({ page, context }) => {
  await login(page)

  const expired = mintExpiredAuthToken()
  await useExpiredAuthCookie(context, expired)

  // Set the waiters up before the navigation: the renewal happens while the app
  // boots, not after the load event.
  const refreshRequest = page.waitForRequest(isRefreshRequest)
  const refreshResponse = page.waitForResponse(response => isRefreshRequest(response.request()))

  await page.reload()

  // The file list only renders after GET /api/session succeeded, which requires
  // the 401 -> refresh -> retry path to have completed.
  await expect(row(page, 'source')).toBeVisible()
  expect((await refreshResponse).status()).toBe(204)
  await refreshRequest

  const renewed = await readAuthCookie(context)
  expect(renewed.value).not.toBe(expired)
  expect(renewed.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  await expect(page).not.toHaveURL(/\/login/)
})

test('an expired access token refreshes on a classic /ie navigation', async ({ page, context }) => {
  await login(page)

  const expired = mintExpiredAuthToken()
  await useExpiredAuthCookie(context, expired)

  const response = await page.goto(`/ie/browse?path=${encodeURIComponent(filesDir)}`)
  expect(response?.status()).toBe(200)
  // A redirect to /ie/login would render the login form and never show the
  // fixture directory.
  await expect(page.getByRole('link', { name: 'source/' })).toBeVisible()

  const renewed = await readAuthCookie(context)
  expect(renewed.value).not.toBe(expired)
  expect(renewed.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
})

/**
 * Browser-driven reads — a video's Range request, a thumbnail, a direct
 * download — are issued by the user agent, which cannot run the SPA refresh
 * dance and cannot replay a 401. The server therefore renews an expired access
 * token in place on the read itself, exactly like the classic /ie pages, and
 * the client-side media recovery is gone.
 *
 * Swapping in an expired-but-renewable token and then reading the file must
 * succeed and renew the cookie: no 401 on the content URL and no client-side
 * HEAD probe. A JSON call made while opening the video (the sibling-subtitle
 * lookup) may still refresh on its own, so the refresh endpoint is not
 * forbidden outright here.
 */
test('browser-driven reads renew an expired access token in place', async ({ page, context }) => {
  await login(page)
  await openFolder(page, 'source')

  // A browser-driven read that hit the strict API would show up as a 401 on the
  // content URL. The removed client recovery used to answer that with a HEAD
  // probe; neither may happen now.
  const contentDenied: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/fs/content/') && response.status() === 401) {
      contentDenied.push(response.url())
    }
  })
  const contentProbes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'HEAD' && new URL(request.url()).pathname.startsWith('/api/fs/content/')) {
      contentProbes.push(request.url())
    }
  })

  const videoPath = path.join(sourceDir, 'tiny.webm')

  // A thumbnail is fetched by <img>, which also cannot retry a 401.
  const thumbExpired = mintExpiredAuthToken()
  await useExpiredAuthCookie(context, thumbExpired)
  const thumbStatus = await page.evaluate(async (target) => {
    const response = await fetch(`/api/fs/thumbnail/${encodeURIComponent(target)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    return response.status
  }, videoPath)
  // 200, or a status that means "no thumbnail for this file": never a 401.
  expect([200, 415, 422, 501]).toContain(thumbStatus)
  expect((await readAuthCookie(context)).value).not.toBe(thumbExpired)

  // A direct download is a plain file read.
  const downloadExpired = mintExpiredAuthToken()
  await useExpiredAuthCookie(context, downloadExpired)
  const downloadStatus = await page.evaluate(async (target) => {
    const response = await fetch(`/api/fs/downloads?paths=${encodeURIComponent(target)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    return response.status
  }, videoPath)
  expect(downloadStatus).toBe(200)
  expect((await readAuthCookie(context)).value).not.toBe(downloadExpired)

  // Isolate the media read: opening the video looks up sibling subtitles through
  // a strict JSON directory listing, which would refresh on its own, and the app
  // may ask for a poster/thumbnail. Neither is the read under test, so answer
  // them without touching the session.
  await page.route('**/api/fs/directories/**', route =>
    route.fulfill({ status: 404, json: { code: 'path_not_found', message: 'not found' } }))
  await page.route('**/api/fs/thumbnail/**', route =>
    route.fulfill({ status: 404, json: { code: 'path_not_found', message: 'not found' } }))

  let refreshesAfterSwap = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/session/refresh') {
      refreshesAfterSwap += 1
    }
  })

  // The media element's Range request must reach metadata without a 401 and
  // without any client-side recovery.
  const mediaExpired = mintExpiredAuthToken()
  await useExpiredAuthCookie(context, mediaExpired)
  const beforeRead = await readAuthCookie(context)
  const contentResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.startsWith('/api/fs/content/')
      && url.pathname.includes('tiny.webm')
      && (response.status() === 200 || response.status() === 206)
  })
  await row(page, 'tiny.webm').dblclick()

  const video = page.locator('.app-window video').first()
  await expect(video).toBeVisible()
  const response = await contentResponse
  await expect.poll(() =>
    video.evaluate(el => (el as HTMLVideoElement).readyState),
  ).toBeGreaterThanOrEqual(1)

  // Authenticated content is browser-only cacheable (a renewal carries Set-Cookie).
  expect(response.headers()['cache-control']).toBe('private, max-age=0, must-revalidate')
  // The cookie changed while no other renewing request was possible: the
  // content read itself did the renewal, not some other request racing it.
  expect(beforeRead.value).toBe(mediaExpired)
  const renewed = await readAuthCookie(context)
  expect(renewed.value).not.toBe(mediaExpired)
  expect(renewed.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  expect(refreshesAfterSwap).toBe(0)
  expect(contentDenied).toEqual([])
  expect(contentProbes).toEqual([])
})
