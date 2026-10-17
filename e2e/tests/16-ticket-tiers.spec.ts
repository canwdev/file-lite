import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, PORT } from '../scripts/fixture.mjs'
import { login } from './helpers'

/**
 * Ticket tiers and temporary sessions.
 *
 * Waiting for a real 15-minute tier would blow the suite budget. The expiry
 * case mints a fixed token with a six-second `exp` using the server's signing
 * key, so the frontend timer and the non-renewable path are exercised for real.
 * The tier/ignore cases create their tickets through the IP page and redeem
 * them in fresh browser contexts.
 */

const AUTH_COOKIE = 'file_lite_auth_token'
const SESSION_COOKIE = 'file_lite_session'
const ORIGIN = `http://127.0.0.1:${PORT}`

interface JwtPayload {
  exp?: number
  norenew?: boolean
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function readJwtPayload(token: string): JwtPayload {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as JwtPayload
}

function mintFixedAuthToken(ttlSeconds: number): string {
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
    iat: now,
    exp: now + ttlSeconds,
    rexp: now + ttlSeconds,
    liat: now,
    rem: true,
    norenew: true,
  }))
  const signature = createHmac('sha256', config.jwtToken)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function readAuthToken(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find(item => item.name === AUTH_COOKIE)
  if (!cookie) {
    throw new Error('auth cookie is missing')
  }
  return cookie.value
}

/** Replace the HttpOnly auth cookie, keeping the readable CSRF session value. */
async function useAuthCookie(context: BrowserContext, token: string) {
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

async function openIpPage(page: Page) {
  await page.goto('/ip')
  const tier = page.getByRole('combobox')
  await expect(tier).toHaveValue('1h')
  await expect(page.locator('.ws-status-display')).toHaveCount(0)
  return tier
}

test('remember login is unchecked by default', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('checkbox', { name: 'Remember login status' })).not.toBeChecked()
})

test('IP page selects a ticket tier, does not open a socket, and ignores its ticket when signed in', async ({ page, context, browser }) => {
  await login(page)

  // A brand-new page in the same context goes straight to /ip: it must not
  // mount the file-manager shell, so there is no WebSocket and no status pill.
  const ipPage = await context.newPage()
  const wsRequests: string[] = []
  ipPage.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/ws') {
      wsRequests.push(request.url())
    }
  })
  const tier = await openIpPage(ipPage)
  await ipPage.waitForTimeout(400)
  expect(wsRequests).toHaveLength(0)
  await expect(ipPage.locator('.ws-status-display')).toHaveCount(0)

  const ticketResponse = ipPage.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/session/tickets',
  )
  await tier.selectOption('15m')
  expect((await ticketResponse).status()).toBe(201)
  await expect(tier).toHaveValue('15m')
  await expect(tier.locator('option[value="15m"]')).toHaveText('15 minutes')
  const ticketUrl = await ipPage.locator('textarea').inputValue()
  expect(ticketUrl).toMatch(/[?&]ticket=/)
  await ipPage.close()

  // The ticket is ignored, not burned, while the original page is signed in:
  // the persistent token must stay in place (a redeemed 15m ticket would carry
  // `norenew`). The server may rotate the access token while the app boots, so
  // only the persistent claim is asserted, not the exact token value.
  await page.goto(ticketUrl)
  await expect(page).not.toHaveURL(/[?&]ticket=/)
  const after = readJwtPayload(await readAuthToken(context))
  expect(after.norenew).not.toBe(true)

  // The same ticket still works in a fresh context, proving the ignore path did
  // not consume it.
  const fixedContext = await browser.newContext()
  const fixedPage = await fixedContext.newPage()
  await fixedPage.goto(ticketUrl)
  await fixedPage.locator('.explorer-wrap').waitFor()
  const fixed = readJwtPayload(await readAuthToken(fixedContext))
  expect(fixed.norenew).toBe(true)
  expect((fixed.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeGreaterThan(13 * 60)
  // The top bar shows the remaining time next to the (optional) page title.
  await expect(fixedPage.locator('.explorer-top-bar__title')).toContainText(/\d+[hm]/)

  // A temporary session cannot re-share: the menu entry is gone and opening
  // /ip directly shows the explanation instead of a tier picker or QR code.
  await fixedPage.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(fixedPage.getByText(/IP Chooser/)).toHaveCount(0)
  await fixedPage.keyboard.press('Escape')
  await fixedPage.goto('/ip')
  await expect(fixedPage.getByText(/This is a temporary session/)).toBeVisible()
  await expect(fixedPage.getByRole('combobox')).toHaveCount(0)
  await fixedContext.close()
})

test('a fixed ticket session logs out when its token expires', async ({ page, context }) => {
  await login(page)

  const token = mintFixedAuthToken(8)
  await useAuthCookie(context, token)
  await page.reload()
  await expect(page.locator('.explorer-top-bar__title')).toContainText(/\d+[hm]/)
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
})
