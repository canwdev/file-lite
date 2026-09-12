import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  bulkName,
  copy,
  expectClipboardReady,
  ensureBulkFixture,
  goBack,
  lastServerTask,
  login,
  openFolder,
  paste,
  resetTargetDirs,
  screenshot,
  selectItem,
  serverTaskRows,
  targetDir,
} from './helpers'

// 复制耗时由「文件数」决定（逐文件 fsync + 原子改名），
// 这个规模足以让「运行中」有稳定的时间窗口点取消。
const BULK_FILES = Number(process.env.E2E_BULK_FILES || 6000)
const BULK_SIZE_KB = 4

/**
 * 服务端任务在传输窗口里的进度条、运行中取消，以及跨窗口可见性。
 *
 * 任务结束后窗口自动收起，所以「取消」的断言是「窗口收起 + 磁盘上不存在半个文件」，
 * 而不是去找已经隐藏的行。
 */
test.describe('任务进度与取消', () => {
  test.beforeEach(async () => {
    resetTargetDirs()
  })

  test('复制目录时显示进度条，可以取消，且不留半个文件', async ({ page }) => {
    ensureBulkFixture(BULK_FILES, BULK_SIZE_KB)
    await login(page)

    await openFolder(page, 'source')
    await selectItem(page, bulkName)
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)

    const task = lastServerTask(page)
    await expect(task).toBeVisible()
    await expect(task).toContainText(`Copying ${BULK_FILES} item(s)`)
    // 进度是整行的半透明背景条：宽度就是进度，起点必须是 0 之后真正在走
    await expect(task.locator('.transfer-item__progress')).not.toHaveCSS('width', '0px')
    await task.scrollIntoViewIfNeeded()
    await screenshot(page, '04-task-progress')

    await task.locator('button[title="Cancel"]').click()

    // 取消后任务到终态，窗口自动收起
    await expect(task).toBeHidden()

    // 完整性：目标目录里要么没有文件，要么每个都已写完（4KB），且没有临时文件残留
    const copied = fs.existsSync(path.join(targetDir, bulkName))
      ? fs.readdirSync(path.join(targetDir, bulkName))
      : []
    const expectedSize = BULK_SIZE_KB * 1024
    expect(copied.filter(name => name.startsWith('.fl-part-'))).toEqual([])
    const incomplete = copied.filter(name => fs.statSync(path.join(targetDir, bulkName, name)).size !== expectedSize)
    expect(incomplete).toEqual([])
    // 确实拷了一部分（否则这个用例没有覆盖到「运行中」）
    expect(copied.length).toBeLessThan(BULK_FILES)
  })

  test('小目录复制完成后窗口自动收起，文件已就位', async ({ page }) => {
    await login(page)

    await openFolder(page, 'source')
    await selectItem(page, 'nested')
    await copy(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)

    await expect.poll(() => fs.existsSync(path.join(targetDir, 'nested', 'deep.txt'))).toBe(true)
    await expect(lastServerTask(page)).toBeHidden()
  })

  // 一次普通复制成功后不该在任务列表里留下记录，否则会越积越多，
  // 状态栏的任务入口也会一直亮着。
  test('成功的任务不会留在任务列表里', async ({ page }) => {
    await login(page)
    await expect(serverTaskRows(page)).toHaveCount(0)

    await openFolder(page, 'source')
    await selectItem(page, 'nested')
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)

    await expect.poll(() => fs.existsSync(path.join(targetDir, 'nested', 'deep.txt'))).toBe(true)
    await expect(serverTaskRows(page)).toHaveCount(0)
    await expect(page.locator('.explorer-activity-toggle')).toHaveCount(0)
  })

  test('任务在另一个窗口里同样可见', async ({ page, context }) => {
    ensureBulkFixture(BULK_FILES, BULK_SIZE_KB)
    await login(page)

    await openFolder(page, 'source')
    await selectItem(page, bulkName)
    await copy(page)
    await expectClipboardReady(page)
    await goBack(page)
    await openFolder(page, 'target')
    await paste(page)

    const second = await context.newPage()
    await second.goto('/')
    // 第二个窗口没有发起这个任务，但通过全量快照也应该看到它
    await expect(second.locator('.server-task-item').last()).toContainText(`${BULK_FILES} item(s)`)
    await second.close()

    await lastServerTask(page).locator('button[title="Cancel"]').click()
    await expect(lastServerTask(page)).toBeHidden()
  })
})
