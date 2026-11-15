import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { PORT } from '../scripts/fixture.mjs'
import { filesDir, PASSWORD, row } from './helpers'

/**
 * Update interaction: the check runs from the browser, while the backend still
 * does the GitHub request. Every check is mocked so the suite neither depends on
 * GitHub nor installs anything.
 *
 * The e2e config leaves `allowSelfUpdate` off, so these cases also cover the
 * decoupling: checking and installing GitHub updates does not require it.
 */

const ORIGIN = `http://127.0.0.1:${PORT}`
const SETTINGS_KEY = 'file_lite_settings_store'
const CSRF_HEADER = 'X-File-Lite-CSRF'

const UPDATE_INFO = {
  current: 'v1.6.1',
  latest: 'v1.7.0',
  available: true,
  tag: 'v1.7.0',
  notesUrl: 'https://github.com/canwdev/file-lite/releases/tag/v1.7.0',
  publishedAt: '2026-11-15T00:00:00Z',
  prerelease: false,
  asset: {
    name: 'file-lite-windows_amd64-v1.7.0.zip',
    size: 18_000_000,
    digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  },
}

let authCookies: { name: string, value: string }[] = []

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  const response = await context.request.post(`${ORIGIN}/api/session`, {
    data: { password: PASSWORD, remember: false },
  })
  expect(response.ok()).toBeTruthy()
  authCookies = (await context.cookies()).map(({ name, value }) => ({ name, value }))
  await context.close()
})

test.afterAll(async ({ browser }) => {
  if (!authCookies.length)
    return
  const context = await openContext(browser)
  // Leave the shared server with automatic checks off for whatever runs next.
  await setStoredSettings(context, { language: 'en-US', updateAutoCheck: false })
  await context.close()
})

async function openContext(browser: Browser) {
  const context = await browser.newContext()
  await context.addCookies(authCookies.map(cookie => ({ ...cookie, url: ORIGIN })))
  // The fixture directory is the only location, so the app opens it as the root.
  await context.route('**/api/volumes', route =>
    route.fulfill({ json: [{ label: 'Files', path: filesDir, kind: 'volume' }] }))
  return context
}

async function csrfHeaders(context: BrowserContext) {
  const cookies = await context.cookies()
  const session = cookies.find(cookie => cookie.name === 'file_lite_session_http')
  return { [CSRF_HEADER]: session?.value ?? '' }
}

async function setStoredSettings(context: BrowserContext, value: unknown) {
  const response = await context.request.put(`${ORIGIN}/api/settings/${SETTINGS_KEY}`, {
    headers: await csrfHeaders(context),
    data: { value },
  })
  expect(response.ok()).toBeTruthy()
}

/** Never throws: it is polled while the app writes its own settings. */
async function readStoredSettings(context: BrowserContext): Promise<Record<string, unknown> | null> {
  try {
    const response = await context.request.get(`${ORIGIN}/api/settings/${SETTINGS_KEY}`)
    if (!response.ok())
      return null
    const body = await response.json() as { value?: Record<string, unknown> | null }
    return body.value ?? null
  }
  catch {
    return null
  }
}

/**
 * Answer the GitHub check locally. The status endpoint stays silent, and an
 * install request is rejected instead of reaching the real updater.
 */
async function mockUpdate(page: Page, available: boolean) {
  await page.route('**/api/server/update**', (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/server/update')
      return route.fulfill({ json: { ...UPDATE_INFO, available } })
    if (pathname === '/api/server/update/status')
      return route.fulfill({ json: { active: false } })
    if (pathname === '/api/server/updates/github')
      return route.fulfill({ status: 500, json: { message: 'the update was installed without the dialog' } })
    return route.continue()
  })
}

async function openApp(context: BrowserContext, settings: Record<string, unknown>) {
  await setStoredSettings(context, settings)
  const page = await context.newPage()
  await mockUpdate(page, true)
  await page.goto(`${ORIGIN}/`)
  await expect(row(page, 'source')).toBeVisible()
  return page
}

/** Open Settings with Ctrl+, after focusing the shell (same trap as 14-language). */
async function openSettings(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.explorer-wrap[data-shortcut-scope]')?.focus()
  })
  await page.keyboard.press('Control+,')
  await expect(page.locator('.app-window .settings')).toBeVisible()
}

function settingsRow(page: Page, key: string) {
  return page.locator(`.app-window .settings .vgo-option-item__child[data-key="${key}"]`)
}

function updateDialog(page: Page) {
  // The title lives in the window chrome, above the modal body.
  return page.locator('.vgo-window').filter({ has: page.locator('.update-dialog') })
}

test.describe('updates', () => {
  test('manual check offers install, remind and skip, with no auto-install control', async ({ browser }) => {
    const context = await openContext(browser)
    try {
      const page = await openApp(context, {
        language: 'zh-CN',
        updateAutoCheck: false,
        updateLastCheckAt: 0,
        updateSkippedVersion: '',
      })
      const installs: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/server/updates/github')
          installs.push(request.url())
      })

      await openSettings(page)
      const updates = settingsRow(page, 'updates')
      await expect(updates).toContainText('尚未检查')
      // Every functional settings row has its own icon. Rows with a custom render
      // (Color / Background) are excluded because they replace the whole row.
      for (const key of [
        'themeMode',
        'themeStyle',
        'language',
        'reduceMotion',
        'pageTitle',
        'isNativePlayer',
        'rememberLastMedia',
        'openAppWithFilteredList',
        'showHidden',
        'sortFoldersFirst',
        'disablePreview',
        'localData',
        'updates',
        'updateChannel',
        'updateAutoCheck',
        'version',
      ]) {
        await expect(settingsRow(page, key).locator('.vgo-option-item__icon svg')).toHaveCount(1)
      }
      await expect(settingsRow(page, 'updateAutoCheck')).toContainText('打开时每天检查一次更新。')
      // Only the user can install: the automatic-install preference is gone.
      await expect(page.locator('.app-window .settings [data-key="updateAutoInstall"]')).toHaveCount(0)
      await expect(page.locator('.app-window .settings')).not.toContainText('自动安装')

      await updates.getByRole('button').click()
      const dialog = updateDialog(page)
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('有可用更新：v1.7.0')
      await expect(dialog).toContainText('v1.6.1 → v1.7.0')
      await expect(dialog.getByRole('button', { name: '安装更新' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: '稍后提醒' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: '跳过此版本' })).toBeVisible()
      expect(installs).toHaveLength(0)

      await dialog.getByRole('button', { name: '稍后提醒' }).click()
      await expect(dialog).toBeHidden()
      await expect(updates).toContainText('有可用更新：v1.7.0')
    }
    finally {
      await context.close()
    }
  })

  test('skip this version persists and a manual check still offers it', async ({ browser }) => {
    const context = await openContext(browser)
    try {
      const page = await openApp(context, {
        language: 'zh-CN',
        updateAutoCheck: false,
        updateLastCheckAt: 0,
        updateSkippedVersion: '',
      })
      await openSettings(page)
      const updates = settingsRow(page, 'updates')
      await updates.getByRole('button').click()

      const dialog = updateDialog(page)
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '跳过此版本' }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(async () => (await readStoredSettings(context))?.updateSkippedVersion).toBe('v1.7.0')
      await expect(updates).toContainText('已跳过 v1.7.0')

      // Manual checks show a skipped version again; the button opens the dialog.
      await updates.getByRole('button', { name: '更新到 v1.7.0' }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '稍后提醒' }).click()
      await expect(dialog).toBeHidden()
    }
    finally {
      await context.close()
    }
  })

  test('manual check reports the latest version without a dialog', async ({ browser }) => {
    const context = await openContext(browser)
    try {
      await setStoredSettings(context, {
        language: 'zh-CN',
        updateAutoCheck: false,
        updateLastCheckAt: 0,
        updateSkippedVersion: '',
      })
      const page = await context.newPage()
      await mockUpdate(page, false)
      await page.goto(`${ORIGIN}/`)
      await expect(row(page, 'source')).toBeVisible()
      await openSettings(page)

      const updates = settingsRow(page, 'updates')
      await updates.getByRole('button').click()
      await expect(updates).toContainText('当前已是最新版本')
      await expect(updateDialog(page)).toBeHidden()
    }
    finally {
      await context.close()
    }
  })

  test('automatic check runs by default and only prompts until the user acts', async ({ browser }) => {
    const context = await openContext(browser)
    try {
      await setStoredSettings(context, { language: 'zh-CN' })
      const page = await context.newPage()
      await mockUpdate(page, true)
      const installs: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/server/updates/github')
          installs.push(request.url())
      })
      const check = page.waitForRequest(
        request => new URL(request.url()).pathname === '/api/server/update',
        { timeout: 25_000 },
      )

      await page.goto(`${ORIGIN}/`)
      await expect(row(page, 'source')).toBeVisible()

      // The default interval starts ten seconds after the controller is ready.
      const dialog = updateDialog(page)
      await expect(dialog).toBeVisible({ timeout: 25_000 })
      await check
      expect(installs).toHaveLength(0)
      await expect.poll(async () => {
        const last = (await readStoredSettings(context))?.updateLastCheckAt
        return typeof last === 'number' ? last : 0
      }).toBeGreaterThan(0)

      await dialog.getByRole('button', { name: '稍后提醒' }).click()
      await expect(dialog).toBeHidden()

      await openSettings(page)
      await expect(settingsRow(page, 'updateAutoCheck').getByRole('switch')).toBeChecked()
      await expect(settingsRow(page, 'updateAutoCheck')).toContainText('打开时每天检查一次更新。')
      await expect(page.locator('.app-window .settings [data-key="updateAutoInstall"]')).toHaveCount(0)
      await expect(settingsRow(page, 'updates')).toContainText('有可用更新：v1.7.0')
    }
    finally {
      await context.close()
    }
  })
})