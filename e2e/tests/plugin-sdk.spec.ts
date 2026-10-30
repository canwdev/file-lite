import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { appsDir, login, openFolder, row } from './helpers'

/**
 * 插件宿主的端到端用例（默认不跑，见 README「插件 e2e」）。
 *
 * 这里驱动的是夹具里的探针插件 `data/plugins/sdk-probe`（`scripts/fixture.mjs`），
 * 它把 SDK 的每条能力摊成一个按钮，所以断言都是用户能看见的结果：注入的
 * `/plugin-sdk.js` 生效、onOpen 拿到文件、readText/writeFile 落到磁盘、选择器可
 * 用、setTitle/exit 生效。
 *
 * 真正的第三方插件（ONLYOFFICE、Monaco…）体积太大，不进夹具。
 */

/** 探针插件的窗口（标题由插件通过 sdk.setTitle 设置）。 */
function probeWindow(page: Page) {
  return page.locator('.app-window').filter({ has: page.locator('.plugin-host') })
}

/** 插件页面在 iframe 里，它的 DOM 要用 frameLocator 才能取到。 */
function probeFrame(page: Page) {
  return page.frameLocator('.plugin-host__frame')
}

function status(page: Page) {
  return probeFrame(page).locator('#status')
}

async function click(page: Page, id: string) {
  await probeFrame(page).locator(`#${id}`).click()
}

test.describe('plugin host', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await openFolder(page, 'apps')
  })

  test('the injected SDK delivers the opened file and writes it back', async ({ page }) => {
    // openWith: ['.probe'] —— 双击走插件，而不是内置 App
    await row(page, 'probe.probe').dblclick()

    const win = probeWindow(page)
    await expect(win).toBeVisible()
    await expect(status(page)).toHaveText('opened')
    // /plugin-sdk.js 由宿主注入，readText 的编码也一起回来
    await expect(probeFrame(page).locator('#text')).toHaveValue('probe line one')
    await expect(probeFrame(page).locator('#charset')).not.toHaveText('(reading)')

    await probeFrame(page).locator('#text').fill('written by the plugin')
    await click(page, 'write')
    await expect(status(page)).toHaveText('written: probe.probe')
    await expect.poll(() => fs.readFileSync(path.join(appsDir, 'probe.probe'), 'utf8'))
      .toBe('written by the plugin')

    // 还原夹具
    fs.writeFileSync(path.join(appsDir, 'probe.probe'), 'probe line one')
  })

  test('setTitle, getLaunch and exit work from inside the iframe', async ({ page }) => {
    await row(page, 'probe.probe').dblclick()
    const win = probeWindow(page)
    await expect(status(page)).toHaveText('opened')

    await click(page, 'title')
    await expect(win.locator('.title-text')).toHaveText('Probe Title')

    await click(page, 'launch')
    await expect(probeFrame(page).locator('#launchReport')).toContainText('entries:')

    await click(page, 'exit')
    await expect(page.locator('.app-window')).toHaveCount(0)
  })

  test('a plugin opens the shared picker and cancels out of it', async ({ page }) => {
    await row(page, 'probe.probe').dblclick()
    await expect(status(page)).toHaveText('opened')

    await click(page, 'pickFile')
    const dialog = page.locator('.vgo-window').filter({ has: page.locator('.explorer-bottom-wrap') })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(status(page)).toHaveText('pick-cancelled')
  })

  test('a plugin saves a copy through the picker', async ({ page }) => {
    const target = path.join(appsDir, 'probe-copy.probe')
    fs.rmSync(target, { force: true })

    await row(page, 'probe.probe').dblclick()
    await expect(status(page)).toHaveText('opened')

    await click(page, 'pickSave')
    const dialog = page.locator('.vgo-window').filter({ has: page.locator('.explorer-bottom-wrap') })
    await expect(dialog.locator('.explorer-save-name')).toHaveValue('probe-copy.probe')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(status(page)).toHaveText('saved-as: probe-copy.probe')
    await expect.poll(() => fs.existsSync(target)).toBe(true)

    fs.rmSync(target, { force: true })
  })
})

/** 探针插件的按钮 id 便于扩展：这里只是让类型检查看得见 Locator 的用法。 */
export type ProbeButton = 'write' | 'pickFile' | 'pickSave' | 'launch' | 'title' | 'exit'
export type ProbeLocator = Locator
