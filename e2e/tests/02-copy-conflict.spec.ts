import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  conflictDialog,
  copy,
  expectClipboardReady,
  goBack,
  lastServerTask,
  login,
  openFolder,
  paste,
  resetTargetDirs,
  screenshot,
  selectItem,
  targetDir,
} from './helpers'

/**
 * 复制粘贴遇到同名文件：服务端先预扫描并暂停任务，弹窗让用户决策。
 *
 * 任务结束后进度窗口会自动收起（资源管理器行为），所以这里以磁盘结果为准，
 * 不去断言已经隐藏的任务行内容。
 */
test.describe('复制同名冲突', () => {
  test.beforeEach(async ({ page }) => {
    resetTargetDirs()
    await login(page)
  })

  async function startConflictCopy(page: import('@playwright/test').Page) {
    await openFolder(page, 'source')
    await selectItem(page, 'a.txt')
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)
    await expect(conflictDialog(page)).toBeVisible()
  }

  test('弹出 Replace or Skip Files，弹窗期间磁盘零改动', async ({ page }) => {
    await startConflictCopy(page)

    await expect(conflictDialog(page)).toContainText('Replace or Skip Files')
    await expect(conflictDialog(page)).toContainText('1 conflict')
    await expect(conflictDialog(page)).toContainText('a.txt')
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')

    await screenshot(page, '02-conflict-dialog')

    // 先取消：任务停在等待决策，目标不动，窗口保持打开以便重新决策
    await conflictDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(conflictDialog(page)).toBeHidden()
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')

    // 从任务行重新打开弹窗，选 Skip 并继续
    await expect(lastServerTask(page)).toContainText('Waiting for your decision')
    await lastServerTask(page).locator('button[title="Resolve conflict"]').click()
    await expect(conflictDialog(page)).toBeVisible()
    await screenshot(page, '03-conflict-reopen')
    await conflictDialog(page).getByText('Skip this file').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    // 任务结束后窗口自动收起，磁盘保持原样
    await expect(lastServerTask(page)).toBeHidden()
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')
  })

  test('选择 Replace 会用源文件替换目标', async ({ page }) => {
    await startConflictCopy(page)

    await conflictDialog(page).getByText('Replace the file in the destination').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    await expect.poll(() => fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('alpha')
    await expect(lastServerTask(page)).toBeHidden()
  })

  test('选择 Keep both 会改名写入，两边都保留', async ({ page }) => {
    await startConflictCopy(page)

    await conflictDialog(page).getByText('Keep both files').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    await expect.poll(() => fs.readFileSync(path.join(targetDir, 'a (1).txt'), 'utf8')).toBe('alpha')
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')
  })

  test('目录同名时静默合并，只对内部同名文件提问', async ({ page }) => {
    await openFolder(page, 'source')
    await selectItem(page, 'nested')
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)

    // target/nested 已存在，但里面没有同名文件，因此不该弹窗
    await expect(conflictDialog(page)).toBeHidden()
    await expect.poll(() => fs.readFileSync(path.join(targetDir, 'nested', 'deep.txt'), 'utf8')).toBe('deep')
  })
})
