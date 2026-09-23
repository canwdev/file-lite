import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { dispatchDragEnd, login, openFolder, readTextIfExists, row, sourceDir, targetDir } from './helpers'

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
  test('标签栏与顶栏等高，标签项有圆角且无 outline', async ({ page }) => {
    await login(page)
    await expect(row(page, 'source')).toBeVisible()

    // 顶栏高度必须和 explorer-header 一致（标签项不能把顶栏撑高）
    const sizes = await page.evaluate(() => ({
      bar: document.querySelector('.explorer-top-bar')?.getBoundingClientRect().height,
      header: document.querySelector('.explorer-main:not([style*="display: none"]) .explorer-header')?.getBoundingClientRect().height,
    }))
    expect(sizes.bar).toBe(sizes.header)

    const item = await page.locator('.explorer-tabs__item').first().evaluate((el) => {
      const style = getComputedStyle(el)
      return { radius: style.borderTopLeftRadius, outline: style.outlineStyle }
    })
    expect(item.radius).not.toBe('0px')
    expect(item.outline).toBe('none')

    // 新建 / 关闭按钮是圆形
    const addRadius = await page.locator('.explorer-tabs__add').evaluate(el => getComputedStyle(el).borderTopLeftRadius)
    expect(addRadius).not.toBe('0px')
  })

  test('新建标签永远追加在最后并激活', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    const tabs = page.locator('.explorer-tabs__item')

    // 第二个标签停在 target
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.drive-list__item').first().click()
    await openFolder(page, 'target')
    // 回到第一个标签再新建：新标签应当追加到最后，而不是插在活动标签后面
    await tabs.nth(0).click()
    await page.locator('.explorer-tabs__add').click()

    await expect(tabs).toHaveCount(3)
    await expect(tabLabel(page, 0)).toHaveText('source')
    await expect(tabLabel(page, 1)).toHaveText('target')
    await expect(tabLabel(page, 2)).toHaveText('source')
    await expect(tabs.nth(2)).toHaveClass(/is-active/)
  })

  test('拖到另一个标签页的内容区 = 落到该目录', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    const tabs = page.locator('.explorer-tabs__item')

    await page.locator('.explorer-tabs__add').click()
    await page.locator('.drive-list__item').first().click()
    await openFolder(page, 'target')
    await tabs.nth(0).click()
    await expect(row(page, 'note.md')).toBeVisible()

    // 用 note.md：b.txt 是后面几个用例的断言对象，不能在共享夹具里搬走
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await row(page, 'note.md').dispatchEvent('dragstart', { dataTransfer })

    // 悬停第二个标签等弹簧加载切过去，然后落在它现在可见的内容区里（不带 Ctrl = 移动）
    await tabs.nth(1).dispatchEvent('dragenter', { dataTransfer })
    await tabs.nth(1).dispatchEvent('dragover', { dataTransfer })
    await expect(tabs.nth(1)).toHaveClass(/is-active/)

    const content = page.locator('.explorer-main:visible .explorer-content')
    await content.dispatchEvent('dragover', { dataTransfer })
    await content.dispatchEvent('drop', { dataTransfer })
    await dispatchDragEnd(page)
    await dataTransfer.dispose()

    await expect.poll(() => readTextIfExists(path.join(targetDir, 'note.md'))).toBe('# note')
  })

  test('切换 / 保活 / 关闭 / 持久化', async ({ page }) => {
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

    // 至少保留 1 个标签：只剩一个时不再渲染关闭按钮
    await tabs.nth(1).locator('.explorer-tabs__close').click()
    await expect(tabs).toHaveCount(1)
    await expect(tabs.nth(0).locator('.explorer-tabs__close')).toHaveCount(0)

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

  test('右键菜单：Close to the left / right / others', async ({ page }) => {
    await login(page)
    const tabs = page.locator('.explorer-tabs__item')
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.explorer-tabs__add').click()
    await expect(tabs).toHaveCount(3)

    // 在最左的标签上右键：关掉它右边所有标签
    await tabs.nth(0).click({ button: 'right' })
    await page.locator('.vgo-context-menu__item', { hasText: 'Close to the right' }).click()
    await expect(tabs).toHaveCount(1)

    // 再开两个，在最右的标签上右键：关掉它左边所有标签
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.explorer-tabs__add').click()
    await expect(tabs).toHaveCount(3)
    await tabs.nth(2).click({ button: 'right' })
    await page.locator('.vgo-context-menu__item', { hasText: 'Close to the left' }).click()
    await expect(tabs).toHaveCount(1)

    // 再开两个，Close others 只保留被右键的那个
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.explorer-tabs__add').click()
    await expect(tabs).toHaveCount(3)
    await tabs.nth(1).click({ button: 'right' })
    await page.locator('.vgo-context-menu__item', { hasText: 'Close others' }).click()
    await expect(tabs).toHaveCount(1)
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

  test('拖文件悬停标签 500ms 自动切换，标签本身不接受文件', async ({ page }) => {
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
