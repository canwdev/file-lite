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
  readTextIfExists,
  resetTargetDirs,
  row,
  screenshot,
  selectItem,
  serverTaskRows,
  sourceDir,
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

  test('弹出 Replace or Skip Files，Cancel 会取消并移除任务，弹窗期间磁盘零改动', async ({ page }) => {
    await startConflictCopy(page)

    await expect(conflictDialog(page)).toContainText('Replace or Skip Files')
    await expect(conflictDialog(page)).toContainText('1 conflict')
    await expect(conflictDialog(page)).toContainText('a.txt')
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')

    await screenshot(page, '02-conflict-dialog')

    // Cancel = 取消这次操作：任务被取消并直接移出列表，不留下等待决策的行，
    // 也不留下「已取消」状态；目标文件保持原样。
    await conflictDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(conflictDialog(page)).toBeHidden()
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')
    await expect(serverTaskRows(page)).toHaveCount(0)
    await expect(page.locator('.explorer-activity-toggle')).toHaveCount(0)
  })

  test('选择 Replace 会用源文件替换目标', async ({ page }) => {
    await startConflictCopy(page)

    await conflictDialog(page).getByText('Replace the file in the destination').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    await expect.poll(() => readTextIfExists(path.join(targetDir, 'a.txt'))).toBe('alpha')
    await expect(lastServerTask(page)).toBeHidden()
  })

  test('选择 Keep both 会改名写入，两边都保留', async ({ page }) => {
    await startConflictCopy(page)

    await conflictDialog(page).getByText('Keep both files').click()
    await conflictDialog(page).getByRole('button', { name: 'Continue' }).click()
    await expect(conflictDialog(page)).toBeHidden()

    await expect.poll(() => readTextIfExists(path.join(targetDir, 'a (1).txt'))).toBe('alpha')
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('existing-alpha')
  })

  // 原地粘贴：源与目标是同一个路径。不该问「是否用自己替换自己」——
  // 那个操作只会把文件静默重写一遍（inode 变化、硬链接被拆开），
  // 正确行为是按资源管理器语义直接生成 "a - Copy"。
  test('原地粘贴不弹窗，直接生成副本', async ({ page }) => {
    await openFolder(page, 'source')
    await selectItem(page, 'a.txt')
    await copy(page)
    await expectClipboardReady(page)

    // 不离开当前目录，直接粘贴
    await paste(page)

    await expect.poll(() => fs.existsSync(path.join(sourceDir, 'a - Copy.txt'))).toBe(true)
    await expect(conflictDialog(page)).toBeHidden()
    expect(fs.readFileSync(path.join(sourceDir, 'a.txt'), 'utf8')).toBe('alpha')
    // 当前目录直接补上新行（fs changed 带条目级 changes，不再整目录刷新）
    await expect(row(page, 'a - Copy.txt')).toBeVisible()
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
    await expect.poll(() => readTextIfExists(path.join(targetDir, 'nested', 'deep.txt'))).toBe('deep')
  })
})
