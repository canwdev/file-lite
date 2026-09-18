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
 *
 * 失败用「目标位置上是一个**文件**」制造，而不是 chmod 0500：目录权限在 Windows 上
 * 不生效（`fs.chmodSync` 只改只读位，往目录里写文件照样成功），用权限做夹具会让这条
 * 用例在 Windows 上拿不到任何失败，后面的断言全部落空——与 Go 侧
 * `TestFailureMessageHidesTempFile` 的修法是同一个理由。
 * 目标位置是个文件时写入必定失败，之后把它换成目录，重试就必须成功。
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

    // empty 本该是目录，先换成同名文件：往它里面写必定失败
    // （扫描阶段仍能读到这个路径，所以任务能正常开始、在写入时失败）
    fs.rmSync(emptyDir, { recursive: true, force: true })
    fs.writeFileSync(emptyDir, 'not a directory')

    await openFolder(page, 'empty')

    await paste(page)

    // 本窗口发起的任务失败后会自动弹出清单
    await expect(failureDialog(page)).toBeVisible()
    await expect(failureDialog(page)).toContainText('1 item(s) failed')
    await expect(failureDialog(page)).toContainText('b.txt')
    // 报错里不能出现内部的临时文件名
    await expect(failureDialog(page)).not.toContainText('.fl-part-')
    await screenshot(page, '05-failure-dialog')

    // 修好目标（文件换回目录）后重试，应当补齐文件
    fs.rmSync(emptyDir, { recursive: true, force: true })
    fs.mkdirSync(emptyDir, { recursive: true })
    await failureDialog(page).getByRole('button', { name: 'Try Again' }).click()
    await expect(failureDialog(page)).toBeHidden()

    await expect.poll(() => readTextIfExists(path.join(emptyDir, 'b.txt'))).toBe('beta')
    // 重试任务同样会在结束后自动收起
    await expect(lastServerTask(page)).toBeHidden()
  })
})
