import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  copy,
  emptyDir,
  expectClipboardReady,
  failureDialog,
  goBack,
  lastServerTask,
  login,
  openFolder,
  paste,
  readTextIfExists,
  resetTargetDirs,
  screenshot,
  selectItem,
} from './helpers'

/**
 * 失败清单：任务失败后列出「哪一项、为什么」，Try Again 只重跑失败项。
 * 这里用「目标目录不可写」制造真实失败，修好权限后点 Try Again 应当成功。
 */
test.describe('失败清单与重试', () => {
  test.beforeEach(async () => {
    resetTargetDirs()
  })

  test('列出失败项并可以用 Try Again 补齐', async ({ page }) => {
    await login(page)

    await openFolder(page, 'source')
    await selectItem(page, 'b.txt')
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'empty')

    // 让目标目录不可写：复制一定失败（扫描阶段仍可读，所以任务能正常开始）
    fs.chmodSync(emptyDir, 0o500)

    await paste(page)

    // 本窗口发起的任务失败后会自动弹出清单
    await expect(failureDialog(page)).toBeVisible()
    await expect(failureDialog(page)).toContainText('1 item(s) failed')
    await expect(failureDialog(page)).toContainText('b.txt')
    // 报错里不能出现内部的临时文件名
    await expect(failureDialog(page)).not.toContainText('.fl-part-')
    await screenshot(page, '05-failure-dialog')

    // 修好权限后重试，应当补齐文件
    fs.chmodSync(emptyDir, 0o755)
    await failureDialog(page).getByRole('button', { name: 'Try Again' }).click()
    await expect(failureDialog(page)).toBeHidden()

    await expect.poll(() => readTextIfExists(path.join(emptyDir, 'b.txt'))).toBe('beta')
    // 重试任务同样会在结束后自动收起
    await expect(lastServerTask(page)).toBeHidden()
  })
})
