import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { appsDir, login, openFolder, row } from './helpers'

/**
 * 应用共用的文件选择器（SDK `pick`）。
 *
 * 选择器是宿主里的唯一对话框：内置 App、插件、播放器都走它，所以这里验证的是
 * 「点得到、看得见、结果对」——对话框本身（单面板、无标签栏）、四个模式的结果，
 * 以及选完之后调用方拿到的东西（打开的文件、写盘的文件名）。
 *
 * `folder` 模式只由 SDK 暴露、没有界面调用方，它的结果映射由
 * `frontend/src/views/FileManager/file-picker.test.ts` 覆盖。
 */

/** 选择器对话框：它里面才有底部操作栏。 */
function picker(page: Page) {
  return page.locator('.vgo-window').filter({ has: page.locator('.explorer-bottom-wrap') })
}

/** 文本编辑器的 File 二级菜单项（精确匹配，Save 不能命中 Save As…）。 */
async function fileMenu(page: Page, win: Locator, label: RegExp) {
  await win.locator('.vgo-context-menu-bar__item').filter({ hasText: /^File$/ }).click()
  const item = page.locator('.vgo-context-menu__item:visible').filter({ hasText: label })
  await expect(item).toHaveCount(1)
  return item
}

async function closeWindow(win: Locator) {
  await win.locator('.title-icon').dblclick()
  await expect(win).toBeHidden()
}

test.describe('file picker', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await openFolder(page, 'apps')
  })

  test('the text editor opens another file chosen in the picker', async ({ page }) => {
    await row(page, 'hello.txt').dblclick()
    const win = page.locator('.app-window')
    await expect(win.locator('.text-editor-textarea')).toHaveValue('hello apps')

    await (await fileMenu(page, win, /^Open…$/)).click()

    const dialog = picker(page)
    await expect(dialog).toBeVisible()
    // 唯一对话框：单面板、没有标签栏，起点是文件所在目录
    await expect(dialog.locator('.explorer-tabs')).toHaveCount(0)
    await expect(dialog.locator('.explorer-main')).toHaveCount(1)
    await expect(dialog.locator('.explorer-main .address-bar__crumb-text').last()).toHaveText('apps')

    await dialog.locator('tr[data-name="note.md"]').click()
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(dialog).toBeHidden()

    // 编辑器切到新文件，窗口标题跟着走
    await expect(win.locator('.text-editor-textarea')).toHaveValue('# app note')
    await expect(win.locator('.title-text')).toHaveText('note.md')
    await closeWindow(win)
  })

  test('save as writes the edited text under the chosen name', async ({ page }) => {
    const target = path.join(appsDir, 'copy.txt')
    fs.rmSync(target, { force: true })

    await row(page, 'hello.txt').dblclick()
    const win = page.locator('.app-window')
    const textarea = win.locator('.text-editor-textarea')
    await expect(textarea).toHaveValue('hello apps')
    await textarea.fill('saved elsewhere')

    await (await fileMenu(page, win, /^Save As…$/)).click()

    const dialog = picker(page)
    await expect(dialog).toBeVisible()
    const nameInput = dialog.locator('.explorer-save-name')
    // 预填当前文件名，改一个名字就落到同一个目录
    await expect(nameInput).toHaveValue('hello.txt')
    await nameInput.fill('copy.txt')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => fs.readFileSync(target, 'utf8')).toBe('saved elsewhere')
    // 另存之后这个窗口编辑的就是新文件（Ctrl+S 会覆盖它）
    await expect(win.locator('.title-text')).toHaveText('copy.txt')

    fs.rmSync(target, { force: true })
    await closeWindow(win)
  })

  test('save as asks before overwriting an existing file', async ({ page }) => {
    const target = path.join(appsDir, 'existing.txt')
    fs.writeFileSync(target, 'keep me')

    await row(page, 'hello.txt').dblclick()
    const win = page.locator('.app-window')
    const textarea = win.locator('.text-editor-textarea')
    await expect(textarea).toHaveValue('hello apps')
    await textarea.fill('replacement')

    await (await fileMenu(page, win, /^Save As…$/)).click()
    const dialog = picker(page)
    await expect(dialog).toBeVisible()
    await dialog.locator('.explorer-save-name').fill('existing.txt')
    await dialog.getByRole('button', { name: 'Save' }).click()

    // 同名文件先确认；取消就什么都不写
    const confirm = page.locator('.el-message-box')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('already exists')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
    await expect(dialog).toBeVisible()

    // 再来一次并确认覆盖
    await dialog.getByRole('button', { name: 'Save' }).click()
    await confirm.getByRole('button', { name: 'Replace' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => fs.readFileSync(target, 'utf8')).toBe('replacement')
    await expect(win.locator('.title-text')).toHaveText('existing.txt')

    fs.rmSync(target, { force: true })
    await closeWindow(win)
    fs.writeFileSync(path.join(appsDir, 'hello.txt'), 'hello apps')
  })

  test('the player opens server files through the same dialog', async ({ page }) => {
    await page.locator('.explorer-main:visible button[title^="Back (alt+left)"]').click()
    await openFolder(page, 'source')
    await row(page, 'clip.mp4').dblclick()

    const player = page.locator('.art-video-player').first()
    await expect(player).toBeVisible()
    await player.hover()
    await page.locator('.art-auto-playback-close').click({ timeout: 2000 }).catch(() => {})
    await page.locator('.art-control-setting').click()
    await page.locator('.art-setting-item', { hasText: 'Open server video' }).click()

    const dialog = picker(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.explorer-main')).toHaveCount(1)

    // 取消不改变播放器状态
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(player).toBeVisible()
  })
})
