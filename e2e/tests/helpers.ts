import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDragFixture, PASSWORD, PORT, filesDir, uploadDir } from '../scripts/fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const screenshotsDir = path.resolve(here, '..', 'screenshots')

export const sourceDir = path.join(filesDir, 'source')
export const targetDir = path.join(filesDir, 'target')
export const emptyDir = path.join(filesDir, 'empty')
/** 大量小文件，用于让「复制运行中」有足够长的时间窗口可以取消。 */
export const bulkName = 'bulk'

/** 拖拽用例专用夹具（见 fixture.mjs 的 createDragFixture）。 */
export const dragDir = path.join(filesDir, 'drag')
export const dragInboxDir = path.join(dragDir, 'inbox')
export const dragSubDir = path.join(dragInboxDir, 'sub')
export const dragArchiveDir = path.join(dragDir, 'archive')

export { filesDir, uploadDir, PASSWORD }

/** 保存一张说明用截图（提交进仓库，供文档引用）。 */
export async function screenshot(page: Page, name: string) {
  // 等弹窗 / 窗口的打开动画落定，否则截图会拍到半透明的中间态
  await page.waitForTimeout(450)
  fs.mkdirSync(screenshotsDir, { recursive: true })
  await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`) })
}

/**
 * 清掉之前用例遗留的已结束任务。
 * 用例共用同一台服务器，不清的话任务窗口里会堆着历史任务，截图和断言都不干净。
 */
export async function dismissFinishedTasks(page: Page) {
  const toggle = page.locator('.explorer-activity-toggle')
  if (await toggle.count() === 0) {
    return
  }
  const panel = page.locator('#file_lite_transfer_panel')
  if (!await panel.isVisible().catch(() => false)) {
    await toggle.click()
    await expect(panel).toBeVisible()
  }
  // 后台任务在 Tasks 页签，已结束的行用页脚的 Clear finished 清掉
  await panel.getByRole('button', { name: 'Tasks' }).click()
  const clear = panel.locator('.transfer-panel__footer button', { hasText: 'Clear finished' })
  if (await clear.isVisible().catch(() => false)) {
    await clear.click()
    await page.waitForTimeout(150)
  }
  // 收起面板，后续用例的截图与点击都不受它影响
  if (await panel.isVisible().catch(() => false)) {
    await toggle.click()
    await expect(panel).toBeHidden()
  }
}

/**
 * 登录态在同一个 worker 的用例之间复用。
 *
 * 每个用例都是一个全新的浏览器上下文，本来要各登一次；但登录端点有
 * 「每 IP 每分钟 20 次」的限流（`middlewares/rate_limiter.go`），用例一多就会
 * 撞上 429，表现为一直停在登录页。第一个用例走真实登录表单，之后把拿到的
 * token cookie 直接写进新上下文，仍然是完整走一遍鉴权。
 */
const AUTH_TOKEN_COOKIE = 'file_lite_auth_token'
let sharedAuthToken: string | null = null

export async function login(page: Page) {
  if (sharedAuthToken) {
    await page.context().addCookies([
      { name: AUTH_TOKEN_COOKIE, value: sharedAuthToken, url: `http://127.0.0.1:${PORT}` },
    ])
  }

  await page.goto('/')
  if (!sharedAuthToken) {
    const password = page.locator('input[placeholder="Input password"]')
    await password.waitFor()
    await password.fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign In' }).click()
    sharedAuthToken = (await page.context().cookies())
      .find(cookie => cookie.name === AUTH_TOKEN_COOKIE)?.value ?? null
  }

  await page.locator('.explorer-wrap').waitFor()
  await expect(row(page, 'source')).toBeVisible()
  // 用例共用同一台服务器：登录后先清掉历史任务，保证窗口与截图只反映当前用例
  await dismissFinishedTasks(page)
}

/**
 * 把 target / empty 恢复成初始状态。
 * 用例之间共用同一台服务器和同一份磁盘夹具，所以每个用例开始前都要复位，
 * 否则前一个用例落下的文件会把后一个用例变成「同名冲突」场景。
 */
export function resetTargetDirs() {
  // 原地粘贴用例会在 source 里生成 "xxx - Copy"，复位时一并清掉
  if (fs.existsSync(sourceDir)) {
    for (const name of fs.readdirSync(sourceDir)) {
      if (name.includes(' - Copy')) {
        fs.rmSync(path.join(sourceDir, name), { recursive: true, force: true })
      }
    }
  }
  fs.chmodSync(emptyDir, 0o755)
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(targetDir, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(targetDir, 'a.txt'), 'existing-alpha')

  fs.rmSync(emptyDir, { recursive: true, force: true })
  fs.mkdirSync(emptyDir, { recursive: true })
}

/**
 * 复位拖拽夹具。
 * 拖拽用例会把文件搬来搬去，落在磁盘根 / 面包屑上的系统文件也会写到 files/ 下，
 * 所以除了重建 drag 树，还要清掉可能掉在根目录的散落文件。
 */
export function resetDragDirs() {
  for (const name of ['move-me.txt', 'copy-me.txt', 'ctrl-me.txt', 'back.txt', 'os-row.txt', 'os-crumb.txt', 'os-star.txt', 'os-drive.txt']) {
    fs.rmSync(path.join(filesDir, name), { recursive: true, force: true })
  }
  createDragFixture()
}

/**
 * 派发一次 HTML5 拖拽。
 *
 * 用同一个 `DataTransfer` 依次派发 dragstart → dragenter → dragover → drop → dragend，
 * 走的是页面里真实的 dragstart/dragover/drop 处理器；不依赖 Playwright 的鼠标拖拽
 * 模拟（无头 Chromium 下原生拖拽的启动时机不稳定）。
 *
 * `dropAt` 给需要「落点在目标上半 / 下半」的用例（收藏夹排序）提供真实坐标。
 */
export async function html5Drag(
  page: Page,
  source: Locator,
  target: Locator,
  init: { ctrlKey?: boolean, shiftKey?: boolean, dropAt?: 'top' | 'bottom' } = {},
) {
  const { dropAt, ...eventInit } = init
  const point = dropAt ? await targetDropPoint(target, dropAt) : {}

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragenter', { dataTransfer, ...eventInit, ...point })
  await target.dispatchEvent('dragover', { dataTransfer, ...eventInit, ...point })
  await target.dispatchEvent('drop', { dataTransfer, ...eventInit, ...point })
  // 移动会立刻把源行从列表里摘掉，不能再到它身上派发 dragend；dragend 冒泡到 window 即可
  await dispatchDragEnd(page)
  await dataTransfer.dispose()
}

/** 目标元素上 / 下边缘附近的视口坐标。 */
async function targetDropPoint(target: Locator, where: 'top' | 'bottom') {
  const box = await target.boundingBox()
  if (!box) {
    return {}
  }
  return { clientY: where === 'top' ? box.y + 2 : box.y + box.height - 2 }
}

/** 拖拽收尾：dragend 是派发在 window 上的全局收尾信号。 */
export async function dispatchDragEnd(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  })
}

/**
 * 清掉侧边栏里所有收藏项。
 * 收藏是服务端设置，会跨用例存活；用例自己先清干净，就不依赖上一个用例的清理是否跑到。
 */
export async function clearStars(page: Page) {
  const stars = page.locator('.star-item')
  while (await stars.count() > 0) {
    const before = await stars.count()
    await stars.first().click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'UnStar' }).click()
    await expect(stars).toHaveCount(before - 1)
  }
}

/**
 * 模拟「从系统拖入文件」：在页面里造一个带 File 的 DataTransfer 再派发 drop。
 *
 * 真实的 OS 拖拽在 Playwright 里无法驱动；合成 DataTransfer 没有 `webkitGetAsEntry`
 * 的条目，正好覆盖上传逻辑里「没有 Entry API 时退化成平面文件列表」的分支。
 */
export async function dropExternalFiles(
  page: Page,
  target: Locator,
  files: { name: string, content: string }[],
) {
  const dataTransfer = await page.evaluateHandle((items) => {
    const dataTransfer = new DataTransfer()
    for (const item of items) {
      dataTransfer.items.add(new File([item.content], item.name, { type: 'text/plain' }))
    }
    return dataTransfer
  }, files)
  await target.dispatchEvent('dragenter', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  await target.dispatchEvent('drop', { dataTransfer })
  await dataTransfer.dispose()
}

/** 列表视图里的一行（FileTable 给每行加了 data-name）。 */
export function row(page: Page, name: string) {
  return page.locator(`tr[data-name="${name}"]`)
}

/** 地址栏最后一段面包屑 = 当前目录。用它判断导航是否真的完成。 */
function currentCrumb(page: Page) {
  return page.locator('.addr-crumb-text').last()
}

/**
 * 进入子目录，并等到目录真的切过去。
 * 不能只等「旧行消失」：目标行本来就不在当前目录里，那个条件会立刻成立，
 * 于是粘贴有可能还在上一个目录执行（变成自我复制）。
 */
export async function openFolder(page: Page, name: string) {
  await row(page, name).dblclick()
  await expect(currentCrumb(page)).toHaveText(name)
}

export async function goBack(page: Page) {
  const before = await currentCrumb(page).textContent()
  await page.locator('button[title="Back (alt+left)"]').click()
  await expect(currentCrumb(page)).not.toHaveText(before ?? '')
}

/** 单击选中一个条目（与资源管理器一致，单击即选中）。 */
export async function selectItem(page: Page, name: string) {
  await row(page, name).click()
  await expect(row(page, name)).toHaveClass(/is-active/)
}

/**
 * 复制 / 粘贴走工具栏按钮。
 *
 * 一开始用 Ctrl+C / Ctrl+V，但快捷键要通过 document.activeElement 解析作用域，
 * 焦点稍微不在列表上就静默失效（剪贴板是空的，测试表现为「什么都没发生」）。
 * 按钮走的是同一段 handleCopy / handlePaste 逻辑，稳定得多。
 * 快捷键本身由 use-shortcut 的单测覆盖。
 */
export async function copy(page: Page) {
  await page.locator('button[title^="Copy (ctrl+c)"]').click()
}

export async function paste(page: Page) {
  await page.locator('button[title^="Paste (ctrl+v)"]').click()
}

/**
 * 读文件内容；文件还不存在时返回 null。
 *
 * 给 `expect.poll` 用：poll 的回调一旦抛错就**立刻**失败、不会重试，
 * 所以「异步操作还没落地」不能靠 readFileSync 抛 ENOENT 来表达。
 */
export function readTextIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8')
  }
  catch {
    return null
  }
}

/** 断言剪贴板里确实有内容，避免「复制没生效」被误判成复制逻辑的错误。 */
export async function expectClipboardReady(page: Page) {
  await expect(page.locator('button[title^="Paste (ctrl+v)"]')).toBeEnabled()
}

export const conflictDialog = (page: Page) => page.locator('.conflict-dialog')
export const failureDialog = (page: Page) => page.locator('.failure-dialog')
/** 服务端任务行（TransferQueue 里的进度条那一块）；最新创建的在最后。 */
export const serverTaskRows = (page: Page) => page.locator('.server-task-item')
export const lastServerTask = (page: Page) => serverTaskRows(page).last()
/** 客户端任务行（上传 / 下载）。 */
export const clientTaskRows = (page: Page) => page.locator('.transfer-list .transfer-item')

/**
 * 生成大量小文件，让一次复制持续足够长的时间。
 * 复制是逐文件 fsync + 原子改名的，所以耗时由「文件数」而不是总字节数决定。
 */
export function ensureBulkFixture(count: number, sizeKb: number) {
  const src = path.join(sourceDir, bulkName)
  const dst = path.join(targetDir, bulkName)
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })

  if (fs.existsSync(src) && fs.readdirSync(src).length === count) {
    return
  }
  fs.rmSync(src, { recursive: true, force: true })
  fs.mkdirSync(src, { recursive: true })
  const payload = Buffer.alloc(sizeKb * 1024, 7)
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(src, `f${String(i).padStart(5, '0')}.dat`), payload)
  }
}
