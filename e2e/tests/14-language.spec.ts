import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { PASSWORD } from './helpers'

/**
 * Interface language: what the app picks on a first visit, and whether a choice
 * made in Settings survives a reload.
 *
 * The settings store lives on the server and every browser context in this run
 * shares it, so each case first puts the key into a known state. The order still
 * matters for the first case: it needs the server to have no language at all, so
 * it clears the key itself instead of trusting what ran before.
 */

const SETTINGS_KEY = 'file_lite_settings_store'
const CSRF_HEADER = 'X-File-Lite-CSRF'

/** Cookies of a single real login, injected into every context below. */
let authCookies: { name: string, value: string }[] = []

function withAuth(cookies: { name: string, value: string }[], baseURL: string) {
  return cookies.map(cookie => ({ ...cookie, url: baseURL }))
}

/** A fresh context already authenticated, optionally with a browser locale. */
async function openContext(browser: Browser, baseURL: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ baseURL, ...options })
  await context.addCookies(withAuth(authCookies, baseURL))
  return context
}

async function csrfHeaders(context: BrowserContext) {
  const cookies = await context.cookies()
  const session = cookies.find(cookie => cookie.name === 'file_lite_session_http')
  return { [CSRF_HEADER]: session?.value ?? '' }
}

/**
 * Read the stored settings' language; null when the server has no settings yet.
 * Never throws: it is polled while the app writes the value back.
 */
async function readStoredLanguage(context: BrowserContext): Promise<string | null> {
  try {
    const response = await context.request.get(`/api/settings/${SETTINGS_KEY}`)
    if (!response.ok()) {
      return null
    }
    const body = await response.json() as { value?: { language?: string } | null }
    return body.value?.language ?? null
  }
  catch {
    return null
  }
}

/** Write a known settings value, or clear the key entirely with `null`. */
async function setStoredSettings(context: BrowserContext, value: unknown) {
  const headers = await csrfHeaders(context)
  const response = value === null
    ? await context.request.delete(`/api/settings/${SETTINGS_KEY}`, { headers })
    : await context.request.put(`/api/settings/${SETTINGS_KEY}`, { headers, data: { value } })
  expect(response.ok()).toBeTruthy()
}

/**
 * Open the Settings window with Ctrl+,.
 *
 * The shortcut is resolved through the focused element's `[data-shortcut-scope]`,
 * and after a page load the focus sits on `<body>`, where the combo is swallowed
 * silently; focus the explorer shell first (same trap as 11-path-contract).
 */
async function openSettings(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.explorer-wrap[data-shortcut-scope]')?.focus()
  })
  await page.keyboard.press('Control+,')
  await expect(page.locator('.app-window .settings')).toBeVisible()
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const response = await context.request.post('/api/session', {
    data: { password: PASSWORD, remember: false },
  })
  expect(response.ok()).toBeTruthy()
  authCookies = (await context.cookies()).map(({ name, value }) => ({ name, value }))
  await context.close()
})

test.afterAll(async ({ browser, baseURL }) => {
  // Leave the shared server in the base language for whatever runs next.
  if (!authCookies.length) {
    return
  }
  const context = await openContext(browser, baseURL)
  await setStoredSettings(context, { language: 'en-US' })
  await context.close()
})

test.describe('界面语言', () => {
  test('first visit detects the browser language and saves it to the server', async ({ browser, baseURL }) => {
    const context = await openContext(browser, baseURL, { locale: 'zh-CN' })
    try {
      // Simulate a first visit: the server has no language setting at all.
      await setStoredSettings(context, null)

      const page = await context.newPage()
      await page.goto('/')

      await expect(page.locator('.explorer-sidebar')).toContainText('位置')
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

      // The detected value is written back, so it no longer depends on the browser.
      await expect.poll(() => readStoredLanguage(context)).toBe('zh-CN')
    }
    finally {
      await context.close()
    }
  })

  test('a saved language wins over a different browser language', async ({ browser, baseURL }) => {
    const context = await openContext(browser, baseURL, { locale: 'ja-JP' })
    try {
      await setStoredSettings(context, { language: 'zh-CN' })

      const page = await context.newPage()
      await page.goto('/')

      // The browser prefers Japanese; the language saved on the server is Chinese.
      await expect(page.locator('.explorer-sidebar')).toContainText('位置')
      await expect(page.locator('.explorer-sidebar')).not.toContainText('場所')
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    }
    finally {
      await context.close()
    }
  })

  test('switching the language in Settings persists across a reload', async ({ browser, baseURL }) => {
    const context = await openContext(browser, baseURL, { locale: 'en-US' })
    try {
      await setStoredSettings(context, { language: 'zh-CN' })

      const page = await context.newPage()
      await page.goto('/')
      await expect(page.locator('.explorer-sidebar')).toContainText('位置')

      await openSettings(page)
      const languageRow = page.locator('.app-window .settings .vgo-option-item__child[data-key="language"]')
      await languageRow.locator('.el-select').click()
      await languageRow.locator('.el-select-dropdown__item', { hasText: '日本語' }).click()

      // The running UI switches right away...
      await expect(page.locator('.explorer-sidebar')).toContainText('場所')
      await expect.poll(() => readStoredLanguage(context)).toBe('ja-JP')

      // ...and the choice comes back after a reload, even though the browser is en-US.
      await page.reload()
      await expect(page.locator('.explorer-sidebar')).toContainText('場所')
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP')
    }
    finally {
      await context.close()
    }
  })
})
