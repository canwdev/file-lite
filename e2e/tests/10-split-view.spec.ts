import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import path from 'node:path'
import {
  dispatchDragEnd,
  login,
  openFolder,
  pane,
  paneCrumb,
  paneRow,
  readTextIfExists,
  targetDir,
} from './helpers'

/**
 * 拆分视图（Chrome 式）：一个标签项内部两个面板，标签条上合并成一个格子、一个关闭按钮。
 *
 * 拆分项里两个面板同时可见，`.explorer-main:visible` 不再唯一，所以这里的定位一律走
 * helpers 的 `pane()` / `paneRow()` / `paneCrumb()`（按项内下标）。
 */
const tabItems = (page: Page) => page.locator('.explorer-tabs__item')
const tabLabels = (page: Page) => page.locator('.explorer-tabs__label')
const visibleSplitter = (page: Page) => page.locator('.explorer-tab-panel:visible .el-splitter')

/** 开一个 source 标签、一个 target 标签，再把两个合成长左（source）右（target）的拆分项 */
async function splitSourceTarget(page: Page) {
  await openFolder(page, 'source')
  await page.locator('.explorer-tabs__add').click()
  // 新标签没有历史，「回根目录」只能走侧边栏
  await page.locator('.drive-list__item').first().click()
  await openFolder(page, 'target')

  const tabs = tabItems(page)
  await expect(tabs).toHaveCount(2)
  await tabs.nth(0).click({ button: 'right' })
  await page.locator('.mx-context-menu-item', { hasText: 'Split view' }).click()
  await expect(tabs).toHaveCount(1)
  await expect(tabLabels(page)).toHaveCount(2)
  return tabs
}

/** 打开拆分项的右键菜单并悬停到 Split view 子菜单上 */
async function openSplitSubmenu(page: Page) {
  await tabItems(page).first().click({ button: 'right' })
  await page.locator('.mx-context-menu-item', { hasText: 'Split view' }).hover()
}

/** 打开拆分项右键菜单里的 Split view 子菜单，再点其中一项 */
async function clickSplitSubmenu(page: Page, label: string) {
  await openSplitSubmenu(page)
  await page.locator('.mx-context-menu-item', { hasText: label }).click()
}

function panelWidths(page: Page) {
  return page.locator('.explorer-tab-panel:visible .el-splitter-panel')
    .evaluateAll(els => els.map(el => el.getBoundingClientRect().width))
}

test.describe('拆分视图', () => {
  test('拆分吸收右邻标签，合并成一个标签格', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.drive-list__item').first().click()
    await openFolder(page, 'target')
    // 第三个标签，让拆分项不是唯一一项（只剩一项时按「至少保留 1 个」不画关闭按钮）
    await page.locator('.explorer-tabs__add').click()

    const tabs = tabItems(page)
    await expect(tabs).toHaveCount(3)

    // 在最左边的标签上右键 → Split view：吸收右邻（target）
    await tabs.nth(0).click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'Split view' }).click()

    await expect(tabs).toHaveCount(2)
    await expect(tabLabels(page)).toHaveCount(3)
    await expect(tabLabels(page).nth(0)).toHaveText('source')
    await expect(tabLabels(page).nth(1)).toHaveText('target')
    // 两个面板合并展示，只留一个总关闭按钮
    await expect(tabs.nth(0).locator('.explorer-tabs__close')).toHaveCount(1)
    // 默认左右并排（竖分隔线）
    await expect(visibleSplitter(page)).toHaveClass(/el-splitter__horizontal/)
    await expect(paneCrumb(page, 0)).toHaveText('source')
    await expect(paneCrumb(page, 1)).toHaveText('target')

    // 两个面板都真的排开：各自的文件行可见（列表要有高度才会渲染出行）
    await expect(paneRow(page, 0, 'a.txt')).toBeVisible()
    await expect(paneRow(page, 1, 'a.txt')).toBeVisible()
    await expect.poll(async () => Math.min(...await panelWidths(page))).toBeGreaterThan(100)
    expect(await panelWidths(page)).toHaveLength(2)

    // 聚焦面跟着右键的那个面板走：被合并进来的邻接标签加载完不能把焦点抢走
    const focusedHalf = tabs.nth(0).locator('.explorer-tabs__half.is-focused')
    await expect(focusedHalf).toHaveText('source')
    // 点另一个面板 → 聚焦面跟着过去
    await paneRow(page, 1, 'a.txt').click()
    await expect(focusedHalf).toHaveText('target')
    await expect(paneCrumb(page, 0)).toHaveText('source')
    await expect(paneCrumb(page, 1)).toHaveText('target')
  })

  test('没有邻接标签时，拆分新建一个同路径面板', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    const tabs = tabItems(page)
    await expect(tabs).toHaveCount(1)

    await tabs.first().click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'Split view' }).click()

    await expect(tabs).toHaveCount(1)
    await expect(tabLabels(page)).toHaveCount(2)
    await expect(tabLabels(page).nth(0)).toHaveText('source')
    await expect(tabLabels(page).nth(1)).toHaveText('source')
    // 只剩 1 项：沿用「至少保留 1 个」，不渲染关闭按钮
    await expect(page.locator('.explorer-tabs__close')).toHaveCount(0)
    await expect(paneCrumb(page, 0)).toHaveText('source')
    await expect(paneCrumb(page, 1)).toHaveText('source')
  })

  test('拆分项子菜单：交换视图、切换方向、取消拆分', async ({ page }) => {
    await login(page)
    const tabs = await splitSourceTarget(page)

    // 交换视图：两个面板互换位置
    await clickSplitSubmenu(page, 'Swap views')
    await expect(tabLabels(page).nth(0)).toHaveText('target')
    await expect(tabLabels(page).nth(1)).toHaveText('source')
    await expect(paneCrumb(page, 0)).toHaveText('target')
    await expect(paneCrumb(page, 1)).toHaveText('source')

    // 当前左右并排，所以子菜单里的切换项是「切成上下堆叠」
    await openSplitSubmenu(page)
    await expect(page.locator('.mx-context-menu-item', { hasText: 'Unsplit' })).toBeVisible()
    await expect(page.locator('.mx-context-menu-item', { hasText: 'Swap views' })).toBeVisible()
    await page.locator('.mx-context-menu-item', { hasText: 'Split horizontally' }).click()
    await expect(visibleSplitter(page)).toHaveClass(/el-splitter__vertical/)

    // 再开一次：切换项已经变成「切回左右并排」
    await clickSplitSubmenu(page, 'Split vertically')
    await expect(visibleSplitter(page)).toHaveClass(/el-splitter__horizontal/)

    // 取消拆分：无损拆回两个独立标签，顺序保留
    await clickSplitSubmenu(page, 'Unsplit')
    await expect(tabs).toHaveCount(2)
    await expect(tabLabels(page)).toHaveCount(2)
    await expect(tabLabels(page).nth(0)).toHaveText('target')
    await expect(tabLabels(page).nth(1)).toHaveText('source')
    await expect(page.locator('.el-splitter-bar')).toHaveCount(0)
  })

  test('一个关闭按钮关掉两个面板，拆分随刷新保留', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    await page.locator('.explorer-tabs__add').click()
    await page.locator('.explorer-tabs__add').click()

    const tabs = tabItems(page)
    await expect(tabs).toHaveCount(3)
    // 把后两个标签合成一个拆分项
    await tabs.nth(1).click({ button: 'right' })
    await page.locator('.mx-context-menu-item', { hasText: 'Split view' }).click()
    await expect(tabs).toHaveCount(2)
    await expect(tabLabels(page)).toHaveCount(3)
    await expect(page.locator('.explorer-tabs__close')).toHaveCount(2)
    await expect(page.locator('.explorer-tab-panel:visible .explorer-main')).toHaveCount(2)

    // 刷新：两个面板的路径与拆分结构都保留
    await page.reload()
    await expect(tabItems(page)).toHaveCount(2)
    await expect(tabLabels(page)).toHaveCount(3)
    await expect(page.locator('.explorer-tab-panel:visible .explorer-main')).toHaveCount(2)
    await expect(visibleSplitter(page)).toHaveClass(/el-splitter__horizontal/)

    // 拆分项的总关闭按钮：一次关掉两个面板
    await tabItems(page).nth(1).locator('.explorer-tabs__close').click()
    await expect(tabItems(page)).toHaveCount(1)
    await expect(tabLabels(page)).toHaveCount(1)
    await expect(page.locator('.el-splitter-bar')).toHaveCount(0)
  })

  test('两个面板的 list/grid 与图标大小互不影响', async ({ page }) => {
    await login(page)
    await splitSourceTarget(page)

    const modeToggle = (index: number) => pane(page, index).locator('button[title="Toggle grid view"]')
    const iconSlider = (index: number) => pane(page, index).locator('.explorer-status-bar [role="slider"]')

    // 默认两个面板都是列表视图
    await expect(pane(page, 0).locator('.explorer-grid-view')).toHaveCount(0)
    await expect(pane(page, 1).locator('.explorer-grid-view')).toHaveCount(0)

    // 都切成网格视图，图标大小都从默认值开始
    await modeToggle(0).click()
    await modeToggle(1).click()
    await expect(pane(page, 0).locator('.explorer-grid-view')).toBeVisible()
    await expect(pane(page, 1).locator('.explorer-grid-view')).toBeVisible()
    await expect(iconSlider(0)).toHaveAttribute('aria-valuenow', '48')
    await expect(iconSlider(1)).toHaveAttribute('aria-valuenow', '48')

    // 只放大左面板的图标：滑块聚焦后按方向键，网格步长 8
    await iconSlider(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(iconSlider(0)).toHaveAttribute('aria-valuenow', '56')
    await expect(iconSlider(1)).toHaveAttribute('aria-valuenow', '48')

    // 只把右面板切回列表视图，左面板保持网格
    await modeToggle(1).click()
    await expect(pane(page, 1).locator('.explorer-grid-view')).toHaveCount(0)
    await expect(pane(page, 0).locator('.explorer-grid-view')).toBeVisible()

    // 刷新后两个面板各自保持
    await page.reload()
    await expect(pane(page, 0).locator('.explorer-grid-view')).toBeVisible()
    await expect(pane(page, 1).locator('.explorer-grid-view')).toHaveCount(0)
    await expect(iconSlider(0)).toHaveAttribute('aria-valuenow', '56')
  })

  test('跨面板拖文件、拖动分隔线调整大小', async ({ page }) => {
    await login(page)
    await splitSourceTarget(page)

    // 左边是 source 面板：把 b.txt 拖到右边 target 面板的目录
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await paneRow(page, 0, 'b.txt').dispatchEvent('dragstart', { dataTransfer })
    const content = pane(page, 1).locator('.explorer-content')
    await content.dispatchEvent('dragover', { dataTransfer })
    await content.dispatchEvent('drop', { dataTransfer })
    await dispatchDragEnd(page)
    await dataTransfer.dispose()
    await expect.poll(() => readTextIfExists(path.join(targetDir, 'b.txt'))).toBe('beta')

    // 拖动分隔线：左窄右宽，且不需要刷新就生效
    //
    // 不用 page.mouse.*：实测在这条用例里 mousedown 打不到 dragger 上
    //（dragger 只有 4px 宽，鼠标按下时元素正在因为前面的落盘刷新而重排），
    // 于是 before 与 after 完全相同、看起来像「拖动无效」。
    // el-splitter 监听的就是 dragger 上的 mousedown + window 上的 mousemove/mouseup，
    // 直接按事件派发既确定又不需要命中 4px 的目标。
    await expect.poll(async () => Math.min(...await panelWidths(page))).toBeGreaterThan(100)
    const before = await panelWidths(page)
    const box = await page.locator('.explorer-tab-panel:visible .el-splitter-bar__dragger').boundingBox()
    expect(box).not.toBeNull()
    const cx = Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2)
    const cy = Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2)

    await page.evaluate(({ cx, cy }) => {
      const dragger = document.querySelector<HTMLElement>(
        '.explorer-tab-panel:not([style*="display: none"]) .el-splitter-bar__dragger',
      ) ?? document.querySelector<HTMLElement>('.el-splitter-bar__dragger')!
      const fire = (target: EventTarget, type: string, x: number, y: number) => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
      }
      fire(dragger, 'mousedown', cx, cy)
      for (let i = 1; i <= 5; i++) {
        fire(window, 'mousemove', cx - (150 * i) / 5, cy)
      }
      fire(window, 'mouseup', cx - 150, cy)
    }, { cx, cy })

    const after = await panelWidths(page)
    expect(after[0]).toBeLessThan(before[0] - 50)
    expect(after[1]).toBeGreaterThan(before[1] + 50)
  })
})
