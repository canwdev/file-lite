import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { login, openFolder, selectItem } from './helpers'

/**
 * 下载的文件名必须是原名。
 *
 * 这里断言的是浏览器最终会用的文件名，因此同时盯住两条独立的路径：
 *   - 服务端 filename* 的编码（空格曾被编成 "+"，含 "+" 的名字曾被二次解码成空格而 404）
 *   - 前端 <a download> 属性（曾经写死 "download"，同源下载会覆盖 Content-Disposition，
 *     于是所有文件都存成 download.<按 Content-Type 猜的扩展名>）
 */
test.describe('下载文件名', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('含 + 与空格的文件名原样下载', async ({ page }) => {
    await openFolder(page, 'source')

    for (const name of ['039.+Vexento+-+Borealis.mp3', 'report final.txt']) {
      await selectItem(page, name)

      const downloadPromise = page.waitForEvent('download')
      await page.locator('button[title="Download"]').click()
      await page.getByRole('button', { name: 'OK' }).click()
      const download = await downloadPromise

      expect(download.suggestedFilename()).toBe(name)
      const saved = await download.path()
      expect(fs.statSync(saved).size).toBeGreaterThan(0)
    }
  })

  test('下载整个文件夹得到 <文件夹名>.zip', async ({ page }) => {
    await openFolder(page, 'source')

    const downloadPromise = page.waitForEvent('download')
    await page.locator('button[title="Download"]').click()
    await page.getByRole('button', { name: 'OK' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('source.zip')
    expect(fs.statSync(await download.path()).size).toBeGreaterThan(0)
  })
})
