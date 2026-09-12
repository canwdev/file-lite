import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  clearStars,
  conflictDialog,
  dispatchDragEnd,
  dragArchiveDir,
  dragDir,
  dragInboxDir,
  dragSubDir,
  dropExternalFiles,
  filesDir,
  goBack,
  html5Drag,
  login,
  openFolder,
  readTextIfExists,
  resetDragDirs,
  row,
  screenshot,
  selectItem,
  serverTaskRows,
} from './helpers'

/** 侧边栏收藏项的当前顺序（名字拼成一串，便于 expect.poll 比较）。 */
async function starOrder(page: Page) {
  const names = await page.locator('.star-item .vgo-u-text-overflow').allInnerTexts()
  return names.map(name => name.trim()).join(',')
}

/**
 * 拖拽：把选中的文件 / 文件夹拖到文件夹行、面包屑、收藏夹、磁盘根。
 *
 * 语义与资源管理器一致：同卷默认移动、跨卷默认复制，Ctrl 强制复制、Shift 强制移动；
 * 系统拖入的文件落到这些目标上时是「上传到该目录」。
 * 断言以磁盘结果为准（任务成功后行会被移除，任务面板也会自动收起）。
 */
test.describe('拖拽', () => {
  test.beforeEach(() => {
    resetDragDirs()
  })

  test('拖到文件夹行 = 移动，拖拽时高亮落点', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await selectItem(page, 'move-me.txt')

    // 手动派发到 dragover 为止：先断言高亮并截图，再放下
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await row(page, 'move-me.txt').dispatchEvent('dragstart', { dataTransfer })
    await row(page, 'sub').dispatchEvent('dragenter', { dataTransfer })
    await row(page, 'sub').dispatchEvent('dragover', { dataTransfer })
    await expect(row(page, 'sub')).toHaveClass(/is-drop-target/)
    await screenshot(page, '07-drag-drop')

    await row(page, 'sub').dispatchEvent('drop', { dataTransfer })
    await dispatchDragEnd(page)
    await dataTransfer.dispose()

    await expect.poll(() => readTextIfExists(path.join(dragSubDir, 'move-me.txt'))).toBe('move-content')
    await expect.poll(() => fs.existsSync(path.join(dragInboxDir, 'move-me.txt'))).toBe(false)
    // 当前目录原地更新，不需要整目录刷新
    await expect(row(page, 'move-me.txt')).toHaveCount(0)
    await expect(row(page, 'sub')).not.toHaveClass(/is-drop-target/)
  })

  test('Ctrl 拖拽 = 复制，源文件保留', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await selectItem(page, 'ctrl-me.txt')

    await html5Drag(page, row(page, 'ctrl-me.txt'), row(page, 'sub'), { ctrlKey: true })

    await expect.poll(() => readTextIfExists(path.join(dragSubDir, 'ctrl-me.txt'))).toBe('ctrl-content')
    expect(fs.readFileSync(path.join(dragInboxDir, 'ctrl-me.txt'), 'utf8')).toBe('ctrl-content')
    await expect(row(page, 'ctrl-me.txt')).toBeVisible()
  })

  test('拖到面包屑的祖先目录 = 移动到该目录', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await openFolder(page, 'sub')
    await selectItem(page, 'back.txt')

    await html5Drag(page, row(page, 'back.txt'), page.locator('.addr-crumb', { hasText: 'inbox' }))

    await expect.poll(() => readTextIfExists(path.join(dragInboxDir, 'back.txt'))).toBe('back-content')
    await expect.poll(() => fs.existsSync(path.join(dragSubDir, 'back.txt'))).toBe(false)
  })

  test('拖到收藏夹 = 移动到该目录', async ({ page }) => {
    await login(page)
    await clearStars(page)
    // 把 archive 加入收藏，再回到 inbox 拖文件上去
    await openFolder(page, 'drag')
    await openFolder(page, 'archive')
    await page.locator('button[title^="Toggle Star"]').click()
    await expect(page.locator('.star-item')).toHaveCount(1)
    await goBack(page)
    await openFolder(page, 'inbox')
    await selectItem(page, 'move-me.txt')

    await html5Drag(page, row(page, 'move-me.txt'), page.locator('.star-item'))

    await expect.poll(() => readTextIfExists(path.join(dragArchiveDir, 'move-me.txt'))).toBe('move-content')

    // 收藏是服务端设置，清理掉免得影响其它用例
    await page.locator('.star-item').click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'UnStar' }).click()
    await expect(page.locator('.star-item')).toHaveCount(0)
  })

  test('拖到磁盘根 = 移动到该卷根目录', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await selectItem(page, 'move-me.txt')

    await html5Drag(page, row(page, 'move-me.txt'), page.locator('.drive-item').first())

    await expect.poll(() => readTextIfExists(path.join(filesDir, 'move-me.txt'))).toBe('move-content')
    await expect.poll(() => fs.existsSync(path.join(dragInboxDir, 'move-me.txt'))).toBe(false)
  })

  test('跨卷拖拽默认复制（不需要按 Ctrl）', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await selectItem(page, 'move-me.txt')

    // 把 inbox 与 archive 伪装成两个不同的卷：默认从「移动」变成「复制」。
    // 登录后才挂路由，再点侧边栏的 Reload drives 强制刷新共享缓存。
    await page.route('**/api/files/drives', route => route.fulfill({
      json: [
        { label: 'Inbox', path: `${dragInboxDir}/` },
        { label: 'Archive', path: `${dragArchiveDir}/` },
      ],
    }))
    await page.locator('button[title="Reload drives"]').click()
    const archiveDrive = page.locator('.drive-item', { hasText: 'Archive' })
    await expect(archiveDrive).toBeVisible()

    await html5Drag(page, row(page, 'move-me.txt'), archiveDrive)

    await expect.poll(() => readTextIfExists(path.join(dragArchiveDir, 'move-me.txt'))).toBe('move-content')
    expect(fs.readFileSync(path.join(dragInboxDir, 'move-me.txt'), 'utf8')).toBe('move-content')
  })

  test('文件夹不能拖进自己，不产生任务', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')
    await selectItem(page, 'sub')

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await row(page, 'sub').dispatchEvent('dragstart', { dataTransfer })
    await row(page, 'sub').dispatchEvent('dragover', { dataTransfer })
    // 不是合法落点：不高亮（也不允许 drop）
    await expect(row(page, 'sub')).not.toHaveClass(/is-drop-target/)
    await row(page, 'sub').dispatchEvent('drop', { dataTransfer })
    await row(page, 'sub').dispatchEvent('dragend', { dataTransfer })
    await dataTransfer.dispose()

    await expect(serverTaskRows(page)).toHaveCount(0)
    expect(fs.readFileSync(path.join(dragSubDir, 'back.txt'), 'utf8')).toBe('back-content')
  })

  test('系统文件拖到文件夹行 / 面包屑 = 上传到该目录', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')

    await dropExternalFiles(page, row(page, 'sub'), [{ name: 'os-row.txt', content: 'from-os' }])
    await expect.poll(() => readTextIfExists(path.join(dragSubDir, 'os-row.txt'))).toBe('from-os')

    await dropExternalFiles(page, page.locator('.addr-crumb', { hasText: 'drag' }), [{ name: 'os-crumb.txt', content: 'from-crumb' }])
    await expect.poll(() => readTextIfExists(path.join(dragDir, 'os-crumb.txt'))).toBe('from-crumb')
  })

  test('系统文件拖到收藏夹 / 磁盘根 = 上传到该目录', async ({ page }) => {
    await login(page)
    await clearStars(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'archive')
    await page.locator('button[title^="Toggle Star"]').click()
    await expect(page.locator('.star-item')).toHaveCount(1)
    await goBack(page)
    await openFolder(page, 'inbox')

    await dropExternalFiles(page, page.locator('.star-item'), [{ name: 'os-star.txt', content: 'from-star' }])
    await expect.poll(() => readTextIfExists(path.join(dragArchiveDir, 'os-star.txt'))).toBe('from-star')

    await dropExternalFiles(page, page.locator('.drive-item').first(), [{ name: 'os-drive.txt', content: 'from-drive' }])
    await expect.poll(() => readTextIfExists(path.join(filesDir, 'os-drive.txt'))).toBe('from-drive')

    await page.locator('.star-item').click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'UnStar' }).click()
    await expect(page.locator('.star-item')).toHaveCount(0)
  })

  test('系统文件拖到文件夹行时，同名冲突沿用上传弹窗', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')

    await dropExternalFiles(page, row(page, 'sub'), [{ name: 'back.txt', content: 'conflict' }])

    await expect(conflictDialog(page)).toBeVisible()
    await expect(conflictDialog(page)).toContainText('back.txt')
    await conflictDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(conflictDialog(page)).toBeHidden()
    // 取消后目标保持原样
    expect(fs.readFileSync(path.join(dragSubDir, 'back.txt'), 'utf8')).toBe('back-content')
  })

  test('拖动收藏项可以调整收藏顺序，顺序会被记住', async ({ page }) => {
    await login(page)
    await clearStars(page)

    // 先收藏 archive 再收藏 inbox，初始顺序为 archive, inbox
    await openFolder(page, 'drag')
    await openFolder(page, 'archive')
    await page.locator('button[title^="Toggle Star"]').click()
    await expect(page.locator('.star-item')).toHaveCount(1)
    await goBack(page)
    await openFolder(page, 'inbox')
    await page.locator('button[title^="Toggle Star"]').click()
    await expect(page.locator('.star-item')).toHaveCount(2)
    await expect.poll(() => starOrder(page)).toBe('archive,inbox')

    // 把第二条（inbox）拖到第一条上半 → 插到最前
    await html5Drag(page, page.locator('.star-item').nth(1), page.locator('.star-item').nth(0), { dropAt: 'top' })
    await expect.poll(() => starOrder(page)).toBe('inbox,archive')

    // 顺序是存进服务端设置的：刷新后仍然是新顺序
    await page.waitForTimeout(400)
    await page.reload()
    await page.locator('.explorer-wrap').waitFor()
    await expect.poll(() => starOrder(page)).toBe('inbox,archive')

    await clearStars(page)
  })
})
