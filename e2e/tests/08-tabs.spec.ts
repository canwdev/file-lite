import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { dispatchDragEnd, login, openFolder, row, sourceDir, targetDir } from './helpers'

/** 标签栏里的第 n 个标签标题 */
function tabLabel(page: import('@playwright/test').Page, index: number) {
  return page.locator('.explorer-tabs__label').nth(index)
}

/** 新开一个标签并把它导航到 target，返回标签栏 locator */
async function twoTabs(page: import('@playwright/test').Page) {
  await openFolder(page, 'source')
  await page.locator('.explorer-tabs__add').click()
  // 新标签没有历史，「回根目录」只能走侧边栏
  await page.locator('.drive-list__item').first().click()
  await openFolder(page, 'target')
  await expect(tabLabel(page, 1)).toHaveText('target')
  return page.locator('.explorer-tabs__item')
}

test.describe('多标签页', () => {
  test('新增 / 切换 / 保活 / 关闭 / 持久化', async ({ page }) => {
    await login(page)
    await expect(row(page, 'source')).toBeVisible()

    await openFolder(page, 'source')
    const tabs = page.locator('.explorer-tabs__item')
    await expect(tabs).toHaveCount(1)
    await expect(tabLabel(page, 0)).toHaveText('source')

    // 新建标签：继承当前路径并激活
    await page.locator('.explorer-tabs__add').click()
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(1)).toHaveClass(/is-active/)
    await expect(tabLabel(page, 1)).toHaveText('source')

    // 第二个标签经侧边栏回到根目录再进 target；第一个标签保持 source
    await page.locator('.drive-list__item').first().click()
    await expect(row(page, 'target')).toBeVisible()
    await openFolder(page, 'target')
    await expect(tabLabel(page, 1)).toHaveText('target')
    await expect(tabLabel(page, 0)).toHaveText('source')

    // 切回第一个标签：内容仍是 source（b.txt 只在 source 里）
    await tabs.nth(0).click()
    await expect(tabs.nth(0)).toHaveClass(/is-active/)
    await expect(row(page, 'b.txt')).toBeVisible()

    // 切到第二个标签：target 里没有 b.txt
    await tabs.nth(1).click()
    await expect(row(page, 'a.txt')).toBeVisible()
    await expect(row(page, 'b.txt')).toHaveCount(0)

    // 至少保留 1 个标签：关掉第二个后，最后一个的关闭按钮不可用
    await tabs.nth(1).locator('.explorer-tabs__close').click()
    await expect(tabs).toHaveCount(1)
    await expect(tabs.nth(0).locator('.explorer-tabs__close')).toBeDisabled()

    // 持久化：刷新后标签与路径保持
    await page.reload()
    await expect(page.locator('.explorer-tabs__item')).toHaveCount(1)
    await expect(tabLabel(page, 0)).toHaveText('source')
    await expect(row(page, 'b.txt')).toBeVisible()
  })

  test('拖拽排序并持久化', async ({ page }) => {
    await login(page)
    const tabs = await twoTabs(page)
    await expect(tabLabel(page, 0)).toHaveText('source')
    await expect(tabLabel(page, 1)).toHaveText('target')

    // 把第一个标签拖到第二个标签右半边 = 插到它后面
    const targetBox = await tabs.nth(1).boundingBox()
    const dropX = (targetBox?.x ?? 0) + (targetBox?.width ?? 0) - 2
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await tabs.nth(0).dispatchEvent('dragstart', { dataTransfer })
    await tabs.nth(1).dispatchEvent('dragover', { dataTransfer, clientX: dropX })
    await tabs.nth(1).dispatchEvent('drop', { dataTransfer, clientX: dropX })
    await dispatchDragEnd(page)
    await dataTransfer.dispose()

    await expect(tabLabel(page, 0)).toHaveText('target')
    await expect(tabLabel(page, 1)).toHaveText('source')

    // 顺序持久化
    await page.reload()
    await expect(tabLabel(page, 0)).toHaveText('target')
    await expect(tabLabel(page, 1)).toHaveText('source')
  })

  test('快捷键 Alt+T / Alt+数字 / Alt+W', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    const tabs = page.locator('.explorer-tabs__item')

    await page.keyboard.press('Alt+t')
    await expect(tabs).toHaveCount(2)

    await page.keyboard.press('Alt+1')
    await expect(tabs.nth(0)).toHaveClass(/is-active/)
    await page.keyboard.press('Alt+2')
    await expect(tabs.nth(1)).toHaveClass(/is-active/)

    await page.keyboard.press('Alt+w')
    await expect(tabs).toHaveCount(1)
  })

  test('拖文件悬停标签 1s 自动切换，标签本身不接受文件', async ({ page }) => {
    await login(page)
    const tabs = await twoTabs(page)

    // 回到第一个标签（source），从一个还在源目录的文件开始拖
    await tabs.nth(0).click()
    await expect(row(page, 'b.txt')).toBeVisible()

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await row(page, 'b.txt').dispatchEvent('dragstart', { dataTransfer })

    // 悬停在第二个标签上：只计时，不 preventDefault
    await tabs.nth(1).dispatchEvent('dragenter', { dataTransfer })
    await tabs.nth(1).dispatchEvent('dragover', { dataTransfer })

    // 弹簧加载：1s 后自动切到那个标签（可见面板变成 target）
    await expect(tabs.nth(1)).toHaveClass(/is-active/)
    await expect(row(page, 'a.txt')).toBeVisible()
    await expect(row(page, 'b.txt')).toHaveCount(0)

    // 直接落在标签上不产生任何文件操作
    await tabs.nth(1).dispatchEvent('drop', { dataTransfer })
    await dispatchDragEnd(page)
    await expect.poll(() => fs.existsSync(path.join(sourceDir, 'b.txt'))).toBe(true)
    await expect.poll(() => fs.existsSync(path.join(targetDir, 'b.txt'))).toBe(false)
    await dataTransfer.dispose()
  })
})
