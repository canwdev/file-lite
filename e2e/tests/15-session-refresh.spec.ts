import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, filesDir, PORT } from '../scripts/fixture.mjs'
import { login, openFolder, row } from './helpers'

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
 * A <video> request is made by the browser and bypasses the service interceptor.
 * When it gets a 401 the media element errors; the recovery hook must renew the
 * session once, reload the same source and reach metadata again.
 *
 * The 401 is simulated with a route instead of waiting for a real token to
 * expire. The route keeps rejecting until it sees the renewal request, so the
 * retry can only succeed through the recovery path.
 */
test('a media element renews once and reloads after a 401', async ({ page }) => {
  await login(page)
  await openFolder(page, 'source')

  const isRefresh = (url: string) => new URL(url).pathname === '/api/session/refresh'
  let denied = 0
  let allowContent = false
  let refreshSeen = false

  page.on('request', (request) => {
    if (denied > 0 && request.method() === 'POST' && isRefresh(request.url())) {
      refreshSeen = true
      allowContent = true
    }
  })

  await page.route(url => url.pathname.includes('tiny.webm'), async (route) => {
    if (!allowContent) {
      denied += 1
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"message":"Unauthorized"}',
      })
      return
    }
    await route.continue()
  })

  const refreshResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && isRefresh(response.url()),
  )
  const retriedContent = page.waitForResponse(response =>
    response.url().includes('tiny.webm') && (response.status() === 200 || response.status() === 206),
  )

  await row(page, 'tiny.webm').dblclick()

  const video = page.locator('.app-window video').first()
  await expect(video).toBeVisible()
  expect((await refreshResponse).status()).toBe(204)
  await retriedContent
  await expect.poll(() =>
    video.evaluate(el => (el as HTMLVideoElement).readyState),
  ).toBeGreaterThanOrEqual(1)

  expect(refreshSeen).toBe(true)
  expect(denied).toBeGreaterThan(0)
})
