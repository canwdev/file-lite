import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  conflictDialog,
  login,
  openFolder,
  readTextIfExists,
  resetTargetDirs,
  screenshot,
  targetDir,
  uploadDir,
} from './helpers'

/**
 * 上传同名冲突：前端在入队前批量问服务端「这些路径存在吗」，
 * 有冲突就复用与复制相同的弹窗，然后把策略带给 upload-file。
 */
test.describe('上传同名冲突', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    // 每个用例都把目标文件恢复成初始内容
    fs.writeFileSync(path.join(targetDir, 'a.txt'), 'existing-alpha')
  })

  test('上传同名文件会先弹窗，Replace 后内容被替换', async ({ page }) => {
    await openFolder(page, 'target')

    const chooserPromise = page.waitForEvent('filechooser')
    await page.locator('button[title^="Upload Files"]').click()
    const chooser = await chooserPromise
    await chooser.setFiles(path.join(uploadDir, 'a.txt'))

    await expect(conflictDialog(page)).toBeVisible()
    await expect(conflictDialog(page)).toContainText('1 conflict')
    await expect(conflictDialog(page)).toContainText('a.txt')
    // 决策之前磁盘不能被动过
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')

    await screenshot(page, '06-upload-conflict')

    await conflictDialog(page).getByText('Replace the file in the destination').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    // 上传是客户端任务：全部成功时窗口会像资源管理器那样自动关闭，
    // 所以这里以磁盘结果为准（而不是去找已经消失的任务行）。
    await expect.poll(() => readTextIfExists(path.join(targetDir, 'a.txt'))).toBe('uploaded-alpha')
  })

  test('上传同名文件选择 Skip 时目标保持原样', async ({ page }) => {
    await openFolder(page, 'target')

    const chooserPromise = page.waitForEvent('filechooser')
    await page.locator('button[title^="Upload Files"]').click()
    const chooser = await chooserPromise
    await chooser.setFiles(path.join(uploadDir, 'a.txt'))

    await expect(conflictDialog(page)).toBeVisible()
    await conflictDialog(page).getByText('Skip this file').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')
  })

  test('上传新文件不弹窗', async ({ page }) => {
    await openFolder(page, 'target')

    const chooserPromise = page.waitForEvent('filechooser')
    await page.locator('button[title^="Upload Files"]').click()
    const chooser = await chooserPromise
    await chooser.setFiles(path.join(uploadDir, 'fresh.txt'))

    await expect(conflictDialog(page)).toBeHidden()
    await expect.poll(() => readTextIfExists(path.join(targetDir, 'fresh.txt'))).toBe('fresh-upload')
  })
})
