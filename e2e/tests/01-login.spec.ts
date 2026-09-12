import { expect, test } from '@playwright/test'
import { login, row, screenshot } from './helpers'

test.describe('登录与基本界面', () => {
  test('登录后打开夹具根目录', async ({ page }) => {
    await login(page)

    // 侧边栏应当显示 safeBaseDir 对应的驱动器
    await expect(page.locator('.explorer-file-sidebar')).toBeVisible()
    // 根目录里能看到夹具目录
    await expect(row(page, 'source')).toBeVisible()
    await expect(row(page, 'target')).toBeVisible()
    await expect(row(page, 'empty')).toBeVisible()

    await screenshot(page, '01-file-manager')
  })

  test('进入子目录后可以返回', async ({ page }) => {
    await login(page)

    await row(page, 'source').dblclick()
    await expect(row(page, 'a.txt')).toBeVisible()
    await expect(row(page, 'b.txt')).toBeVisible()

    await page.locator('button[title^="Back"]').click()
    await expect(row(page, 'source')).toBeVisible()
  })
})
