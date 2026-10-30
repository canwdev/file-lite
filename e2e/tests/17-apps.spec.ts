import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { appsDir, login, openFolder, row } from './helpers'

/**
 * Built-in App 迁移到 FileLite SDK 之后的行为。
 *
 * 这里只放**单元测试看不到**的用户可见路径：
 *
 * - App 第一次打开（它的 chunk 还在加载，晚于窗口推送 launch 才订阅）；
 * - 单例 App 复用同一个窗口显示第二个文件（画廊 `singleInstance`）；
 * - 两个原本靠 emit 的窗口→资源管理器动作（`revealItem` / `selectItems`）；
 * - 文本编辑器的编码往返——它现在走 SDK 的 `readText` + `writeFile({ charset })`，
 *   不再是宿主内部的 `fs` 门面。
 *
 * 图片与文本夹具由 `scripts/fixture.mjs` 的 `createAppsFixture()` 建在 `apps/` 下，
 * 不碰其它用例依赖的 `source/`。
 */

/** 当前所有 App 窗口。 */
function appWindows(page: Page) {
  return page.locator('.app-window')
}

/** 标题匹配的 App 窗口（标题会随文件变化，所以多数地方用正则）。 */
function appWindowTitled(page: Page, title: string | RegExp) {
  return page.locator('.app-window').filter({ has: page.locator('.title-text', { hasText: title }) })
}

/** 文本编辑器菜单栏里的按钮（Save / Refresh / Exit）。 */
function menuBarItem(win: Locator, label: string) {
  return win.locator('.vgo-context-menu-bar__item').filter({ hasText: label })
}

/** 双击标题栏图标 = 请求关闭窗口（与用户关窗走同一条 confirmDismiss 路径）。 */
async function closeWindow(win: Locator) {
  await win.locator('.title-icon').dblclick()
  await expect(win).toBeHidden()
}

test.describe('built-in apps', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await openFolder(page, 'apps')
  })

  test('text editor shows the file on the first open and saves it back', async ({ page }) => {
    // 第一次打开就是这次的回归点：chunk 加载晚于 launch 推送，以前编辑器会一直是空的。
    await row(page, 'hello.txt').dblclick()

    const win = appWindows(page)
    await expect(win.locator('.title-text')).toHaveText('hello.txt')
    const textarea = win.locator('.text-editor-textarea')
    await expect(textarea).toHaveValue('hello apps')
    await expect(win.locator('.text-editor-status-bar')).toContainText('UTF-8')

    await textarea.fill('hello saved')
    await menuBarItem(win, 'Save').click()

    await expect.poll(() => fs.readFileSync(path.join(appsDir, 'hello.txt'), 'utf8')).toBe('hello saved')
    // 保存后不再有未保存标记（菜单项标题上的 *）
    await expect(menuBarItem(win, 'Save')).toHaveText('Save')

    await closeWindow(win)
    // 夹具是用例之间共用的，改完复原，后面的用例仍然看到 hello apps
    fs.writeFileSync(path.join(appsDir, 'hello.txt'), 'hello apps')
  })

  test('text editor keeps a legacy encoding when it writes the file back', async ({ page }) => {
    await row(page, 'gbk.txt').dblclick()

    const win = appWindows(page)
    const textarea = win.locator('.text-editor-textarea')
    // 服务端把 GB18030 转成 UTF-8 给页面，并把磁盘编码一起报回来。
    await expect(textarea).toHaveValue('你好\n')
    await expect(win.locator('.text-editor-status-bar')).toContainText('GB18030')

    await textarea.fill('你好世界\n')
    await menuBarItem(win, 'Save').click()

    // 「你好世界\n」的 GB18030 字节；编辑器没有把它悄悄改成 UTF-8。
    await expect
      .poll(() => fs.readFileSync(path.join(appsDir, 'gbk.txt')).toString('hex'))
      .toBe('c4e3bac3cac0bde70a')

    await closeWindow(win)
    fs.writeFileSync(path.join(appsDir, 'gbk.txt'), Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x0A]))
  })

  test('HTML viewer renders the page through the SDK stream URL', async ({ page }) => {
    await row(page, 'page.html').dblclick()

    const win = appWindows(page)
    await expect(win.locator('.title-text')).toHaveText('page.html')
    // 地址由 sdk.url() 本地拼接，iframe 里的页面真的加载出来了。
    const frame = page.frameLocator('.html-viewer__frame')
    await expect(frame.locator('#hello')).toHaveText('html-viewer-ok')
    await expect(win.locator('.html-viewer__frame')).toHaveAttribute('src', /\/api\/fs\/content\//)

    await closeWindow(win)
  })

  test('open with lists the built-in viewers from the registry', async ({ page }) => {
    await row(page, 'hello.txt').click({ button: 'right' })
    const items = page.locator('.vgo-context-menu__item:visible')
    await items.filter({ hasText: /^Open With/ }).last().hover()

    // 内置 App 与插件现在来自同一份注册表，所以这张列表就是回归面。
    for (const label of ['Text Editor', 'Image Viewer', 'HTML Viewer', 'Video Player', 'Media Player', 'File Viewer']) {
      await expect(items.filter({ hasText: new RegExp(`^${label}$`) }).last()).toBeVisible()
    }

    await items.filter({ hasText: /^Image Viewer$/ }).last().click()
    // 文本文件交给看图 App 也要能开出一个正常窗口（列表里没有图片时退化成单项）。
    await expect(appWindows(page)).toHaveCount(1)
    await closeWindow(appWindows(page))
  })

  test('set default app changes the app a double click uses', async ({ page }) => {
    // .md 默认由文本编辑器打开；把它改成 HTML Viewer，再改回来。
    // Set Default App 是 Open With 的子菜单，所以要先进 Open With。
    await row(page, 'note.md').click({ button: 'right' })
    const items = page.locator('.vgo-context-menu__item:visible')
    await items.filter({ hasText: /^Open With/ }).last().hover()
    await items.filter({ hasText: /^Set Default App/ }).last().hover()
    await items.filter({ hasText: /^HTML Viewer$/ }).last().click()

    await row(page, 'note.md').dblclick()
    const htmlWin = appWindows(page)
    await expect(htmlWin.locator('.html-viewer__frame')).toBeVisible()
    await expect(htmlWin.locator('.title-text')).toHaveText('note.md')
    await closeWindow(htmlWin)

    // Default 让回落到内置匹配：.md 是文本，仍然由文本编辑器打开。
    await row(page, 'note.md').click({ button: 'right' })
    const resetItems = page.locator('.vgo-context-menu__item:visible')
    await resetItems.filter({ hasText: /^Open With/ }).last().hover()
    await resetItems.filter({ hasText: /^Set Default App/ }).last().hover()
    await resetItems.filter({ hasText: /^Default$/ }).last().click()

    await row(page, 'note.md').dblclick()
    const editorWin = appWindows(page)
    await expect(editorWin.locator('.text-editor-textarea')).toHaveValue('# app note')
    await closeWindow(editorWin)
  })

  test('gallery reuses its window and reveals the file in the explorer', async ({ page }) => {
    await row(page, 'picture.png').dblclick()

    const win = appWindows(page)
    const gallery = win.locator('.endless-gallery')
    await expect(gallery).toBeVisible()
    await expect(win.locator('.title-text')).toContainText('[1/2] picture.png')

    // 第二个文件：`singleInstance: true` 让它落进同一个窗口，不新建。
    await gallery.hover()
    await win.locator('button[title^="Next"]').click()
    await expect(win.locator('.title-text')).toContainText('[2/2] picture2.png')
    await expect(appWindows(page)).toHaveCount(1)

    // `revealItem`：关掉 App，并在资源管理器里选中当前文件。
    await gallery.hover()
    await win.locator('button[title^="Locate in folder"]').click()
    await expect(appWindows(page)).toHaveCount(0)
    await expect(row(page, 'picture2.png')).toHaveClass(/is-active/)
  })

  test('properties window describes the selected file', async ({ page }) => {
    await row(page, 'hello.txt').click()
    await page.locator('.explorer-main:visible button[title="Properties"]').click()

    const win = appWindowTitled(page, /hello\.txt/)
    await expect(win.locator('.properties-app')).toBeVisible()
    // 服务端给的是 canonical 路径（正斜杠），Windows 上也是。
    await expect(win.locator('.properties-row').filter({ hasText: 'Path' }))
      .toContainText(path.join(appsDir, 'hello.txt').split(path.sep).join('/'))
    // 大小取自服务端当前的 stat：本用例前面的保存已经改过这个文件的长度。
    const size = fs.statSync(path.join(appsDir, 'hello.txt')).size
    await expect(win.locator('.properties-row').filter({ hasText: 'Size' })).toContainText(`${size} bytes`)

    await closeWindow(win)
  })

  test('settings opens from the global menu and closes again', async ({ page }) => {
    await page.locator('button[title="Menu"]').click()
    await page.locator('.vgo-context-menu__item:visible').filter({ hasText: /^Settings/ }).first().click()

    const win = appWindowTitled(page, /Settings/i)
    await expect(win.locator('.settings')).toBeVisible()
    await expect(win.locator('.title-text')).toContainText('Settings')

    await closeWindow(win)
  })

  test('media player opens for an audio file', async ({ page }) => {
    await page.locator('.explorer-main:visible button[title^="Back (alt+left)"]').click()
    await openFolder(page, 'source')
    await row(page, '039.+Vexento+-+Borealis.mp3').dblclick()

    const win = appWindows(page)
    await expect(win.locator('.media-player-wrap')).toBeVisible()
    // 标题由 PlayerCore 通过 sdk.setTitle 推上窗口
    await expect(win.locator('.title-text')).toContainText('Borealis')

    await closeWindow(win)
  })
})
