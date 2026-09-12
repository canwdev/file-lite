import { expect, test } from '@playwright/test'
import { login, screenshot } from './helpers'

/**
 * Development 菜单里的调试入口。
 *
 * 「传输窗口调试」其实早就有 mock 数据，但被 `enableMock = false` 挡在 onMounted 里，
 * 永远跑不到；现在它挂在 Development 菜单上，点一下就能看到覆盖各种状态的假数据。
 */
test.describe('Development 菜单', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('Debug Transfer Window 打开填满假数据的传输窗口', async ({ page }) => {
    const window = page.locator('#file_lite_upload_dialog')
    await expect(window).toBeHidden()

    // 菜单按钮在 header 右侧（FileList 工具栏里那个是 "Menu (ctrl+m)"，title 不同）
    await page.locator('button[title="Menu"]').click()
    await page.getByText('Config', { exact: true }).hover()
    await page.getByText('Development', { exact: true }).hover()
    await page.getByText('Debug Transfer Window', { exact: true }).click()

    await expect(window).toBeVisible()
    // mock 数据覆盖 pending / transferring / success / failed 与超长文件名
    await expect(page.locator('.transfer-list .transfer-item')).toHaveCount(9)
    await expect(page.locator('.transfer-list .transfer-item').first()).toContainText('mock_file_1.png')
    await expect(page.locator('.transfer-list .transfer-item').filter({ hasText: 'Network Error' })).toHaveCount(1)

    await screenshot(page, '07-debug-transfer-window')
  })
})
