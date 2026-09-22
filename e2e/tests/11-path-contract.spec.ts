import { expect, test } from '@playwright/test'
import path from 'node:path'
import {
  filesDir,
  login,
  openFolder,
  row,
  screenshot,
  selectItem,
} from './helpers'

/**
 * VFS 路径契约的端到端覆盖（阶段 4、5 的验收）。
 *
 * 这些用例看的是**用户可见的契约**，不是实现：
 *   - 面包屑第一段是挂载点根，不是语法根；
 *   - 「上一级」在挂载点根停住；
 *   - 地址栏里粘贴的路径（反斜杠、连续斜杠、点段）能落到同一个目录；
 *   - 列目录失败时列表区留下原因，而不是谎称「目录为空」。
 *
 * 平台相关的部分（UNC / WSL 的真实读写）不在这里：那需要在有共享的机器上验证，
 * 见 docs/design/vfs-abstraction-design.md §8.4。这里只覆盖与平台无关的规则。
 */

/** 夹具根（helpers 把它 stub 成唯一的挂载点）。 */
const mountRoot = path.resolve(filesDir).replace(/\\/g, '/')

/**
 * 进入地址栏编辑态，并返回输入框。
 *
 * 两个坑（都由实测确定，不是推测）：
 *
 * 1. **不能用「点地址栏」进编辑**。实测点容器左侧、点折叠用的「…」都不触发
 *    startEdit，编辑器始终 `display:none`；容器的 click 只在恰好落到 padding
 *    上时才进编辑，而那个落点随路径长度变化，不可靠。
 * 2. **Alt+A 的作用域由 `event.target.closest('[data-shortcut-scope]')` 解析**
 *    （见 hooks/use-shortcut.ts），要求焦点在 `.explorer-wrap` 内。而提交一次路径后
 *    焦点会落到 `<body>`（实测 `document.activeElement` 变成 BODY），此时快捷键
 *    静默失效——所以每次都先把焦点显式还给带 scope 的根节点。
 */
async function openAddressBar(page: import('@playwright/test').Page) {
  const input = page.locator('.address-bar__input')

  // 关掉可能开着的编辑器，让每次调用都从干净状态开始
  if (await input.isVisible().catch(() => false)) {
    await input.press('Escape')
    await expect(input).toBeHidden()
  }

  // 焦点必须在面板内，否则快捷键找不到作用域（见上面的注释 2）。
  // 用 evaluate 直接 focus 而不是 locator.focus()：后者要走 actionability 检查，
  // 对「在视口内但被列表内容覆盖」的容器会一直等到测试超时。
  await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>('.explorer-wrap[data-shortcut-scope]')
    wrap?.focus()
  })
  await page.keyboard.press('Alt+a')

  await expect(input).toBeVisible()
  return input
}

/**
 * 在地址栏里输入一条路径并提交。
 *
 * `fill` 与 `Enter` 分开两次调用：编辑器刚打开时面包屑的溢出测量
 * （AddressBar.recomputeBreadcrumbFit）会在同一帧里改一次布局，紧跟着 `Enter`
 * 一起调用时 `fill` 会被那次重排打断、**只留下一部分字符**（实测面包屑显示成 "i"，
 * 也就是 6 次逐字输入只落下了 1 个）。
 *
 * 外面再包一层有限重试：编辑器偶尔会在布局重排的瞬间不可见（实测整轮跑时
 * `fill` 会一直重试到 90 秒超时，单独跑同一条用例却是 9 秒过），
 * 这时重新进一次编辑态就恢复了。重试次数有限，真有问题照样会失败。
 */
async function typePathAndEnter(page: import('@playwright/test').Page, value: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const input = await openAddressBar(page)
      // 单次尝试用短超时：撞上重排时立刻失败并重试，而不是干等到用例超时
      await input.fill(value, { timeout: 5000 })
      await expect(input).toHaveValue(value, { timeout: 5000 })
      await input.press('Enter')
      return
    }
    catch (error) {
      lastError = error
      // 把编辑器关掉，下一次循环重新打开
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(150)
    }
  }
  throw lastError
}

test.describe('路径与挂载点', () => {
  test('面包屑第一段是挂载点根，不是语法根', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')

    const crumbs = page.locator('.explorer-main:visible .address-bar__crumb-text')
    // 三段：夹具根 + drag + inbox。若把语法根当成第一段，这里会是 4 段（多一个 "/"）。
    await expect(crumbs).toHaveCount(3)
    // 第一段是挂载点根，显示的是它的 Label（夹具的盘叫 Files），不是路径。
    // 路径仍挂在 crumb 上（title / 导航用），见下面的「点第一段回到挂载点根」。
    await expect(crumbs.first()).toHaveText('Files')
    await expect(crumbs.nth(1)).toHaveText('drag')
    await expect(crumbs.nth(2)).toHaveText('inbox')

    await screenshot(page, '11-mount-breadcrumb')
  })

  test('点第一段回到挂载点根', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')

    await page.locator('.explorer-main:visible .address-bar__crumb').first().click()
    await expect(row(page, 'source')).toBeVisible()
    await expect(row(page, 'target')).toBeVisible()
  })

  // 下拉打开时应当已经停在「当前目录」那一项，而不是列表顶部。
  // 用 drag 这一级：它的子目录里有 inbox，而当前就在 drag/inbox。
  test('面包屑下拉高亮当前目录', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')
    await openFolder(page, 'inbox')

    // 在「drag」那一段点 ▼（它在第一段的 caret 之后）
    await page.locator('.explorer-main:visible .address-bar__crumb-caret').nth(1).click()
    const menu = page.locator('.address-bar__crumb-menu')
    await expect(menu).toBeVisible()

    const current = menu.locator('.address-bar__menu-row.is-active')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveText('inbox')
  })

  test('「上一级」在挂载点根停住', async ({ page }) => {
    await login(page)
    await openFolder(page, 'drag')

    // 用完整 title 精确匹配：`title^="Up"` 会把 "Upload Files..." / "Upload Folder..." 也算进来
    const up = page.locator('.explorer-main:visible button[title="Up (alt+up)"]')
    await up.click()
    // 回到夹具根：这是挂载点根，再往上就不是可导航位置了
    await expect(row(page, 'source')).toBeVisible()
    await expect(up).toBeDisabled()
  })

  // 地址栏粘贴是最容易出问题的一条链路：用户会带反斜杠、连续斜杠、点段。
  // 归一化必须在**边界**上做，且落到同一个目录上。
  //
  // 每一步都指向**不同的**目录：连点两次同一个路径时地址栏不会变化，
  // 提交后编辑器会立刻重新收起（元素短暂处于不可见），下一步的操作会撞在
  // 这个中间态上。换目录既让每一步都真的导航一次，也更接近真实使用。
  test('粘贴的路径写法都落到同一个目录', async ({ page }) => {
    await login(page)

    const inbox = `${mountRoot}/drag/inbox`
    const archive = `${mountRoot}/drag/archive`
    const steps = [
      { spelling: inbox, folder: 'inbox' },
      { spelling: `${inbox}${path.sep}`, folder: 'inbox' }, // 尾分隔符
      { spelling: `${archive}//`, folder: 'archive' }, // 连续斜杠（前导不是 //）
      { spelling: `${archive}/./`, folder: 'archive' }, // 当前目录段
      { spelling: `${inbox}/../inbox`, folder: 'inbox' }, // 父目录段再回来
      { spelling: inbox.replace(/\//g, '\\'), folder: 'inbox' }, // 反斜杠写法
    ]

    for (const { spelling, folder } of steps) {
      await typePathAndEnter(page, spelling)
      // 目录真的切过去了才算过：面包屑末段是目标目录
      await expect(page.locator('.explorer-main:visible .address-bar__crumb-text').last()).toHaveText(folder)
    }
  })

  // 前端 normalizePath 曾经用 `/\/+/g` 折叠全部连续斜杠，会把 UNC 的前导 `//`
  // 吃掉——`//server/share` 变成 `/server/share`，共享的根身份就没了。
  // 这条钉住「前导双斜杠必须原样发给后端」。
  test('地址栏里的 UNC 路径保留前导双斜杠', async ({ page }) => {
    await login(page)

    const seen: string[] = []
    await page.route('**/api/files/list**', async (route) => {
      seen.push(new URL(route.request().url()).searchParams.get('path') ?? '')
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Path not found' }),
      })
    })

    const unc = '//e2e-unc-host/share'
    await typePathAndEnter(page, unc)

    await expect.poll(() => seen.length).toBeGreaterThan(0)
    // 同上：取用户刚提交的那一次
    const requested = seen[seen.length - 1]
    // 前导 `//` 必须活着，且没有被改成 `/`
    expect(requested.startsWith('//')).toBe(true)
    expect(requested).not.toBe('/e2e-unc-host/share')
    expect(requested).toContain('e2e-unc-host/share')
  })

  test('反斜杠写法被归一化成同一个位置', async ({ page }) => {
    await login(page)

    const seen: string[] = []
    await page.route('**/api/files/list**', async (route) => {
      seen.push(new URL(route.request().url()).searchParams.get('path') ?? '')
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Path not found' }),
      })
    })

    // 用户在 Windows 上复制来的路径就是这种形态
    await typePathAndEnter(page, `${mountRoot.replace(/\//g, '\\')}\\drag\\inbox`)

    await expect.poll(() => seen.length).toBeGreaterThan(0)
    // 取**最后**一次请求：首次进入夹具根的那次也走同一个路由（列表形态带尾斜杠），
    // 这里要断言的是用户刚提交的那一次。
    const requested = seen[seen.length - 1]
    // 归一化后只允许正斜杠：canonical 规则全链路只用 "/"
    expect(requested.replace(/\/+$/, '')).toBe(`${mountRoot}/drag/inbox`)
    expect(requested).not.toContain('\\')
  })
  test('加密未解锁的卷显示锁图标，点进去报系统原话', async ({ page }) => {
    await login(page)

    // 真实环境里这是 BitLocker 未解锁的盘：盘符在，但读不到卷标也读不到容量。
    await page.route('**/api/files/drives', route => route.fulfill({
      json: [
        { label: 'Files', path: mountRoot, kind: 'volume' },
        { label: 'BitLocker (H:)', path: 'H:', kind: 'locked' },
      ],
    }))
    await page.route('**/api/files/list**', route => route.fulfill({
      status: 423,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'This drive is locked by BitLocker Drive Encryption. You must unlock this drive from Control Panel.',
      }),
    }))

    await page.locator('button[title="Reload drives"]').click()

    const locked = page.locator('.drive-list__item', { hasText: 'BitLocker' })
    await expect(locked).toBeVisible()
    // 锁图标：侧边栏这一步就能让用户看出「不是盘坏了，是没解锁」。
    // 断言 data-icon 而**不是**「有没有 svg」：MdiIcon 对未注册的名字会静默回落成
    // 问号图标，只数 svg 的话名字写错了也照样通过（见 AGENTS.md 的图标约定）。
    await expect(locked.locator('.drive-list__icon [data-icon]')).toHaveAttribute('data-icon', 'folder-lock-outline')
    // 另一块盘必须用别的图标——两者一样的话「锁」就没有信息量了。
    // （这个夹具没给容量，所以是 folder-outline 而不是 harddisk：容量未知的老回退。）
    const normal = page.locator('.drive-list__item', { hasText: 'Files' })
    const normalIcon = await normal.locator('.drive-list__icon [data-icon]').getAttribute('data-icon')
    expect(normalIcon).not.toBe('folder-lock-outline')

    await locked.click()

    const empty = page.locator('.explorer-main:visible .explorer-empty-state')
    await expect(empty).toBeVisible()
    // 必须是系统那句「去哪解锁」，不能退化成笼统的读不到
    await expect(empty).toContainText('BitLocker')
    await expect(empty).toContainText('Control Panel')
    await expect(empty).not.toContainText('Failed to read the path')
  })
})

test.describe('列目录失败的呈现', () => {
  test('失败时列表区显示原因并可重试，而不是「目录为空」', async ({ page }) => {
    await login(page)

    await page.route('**/api/files/list**', route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Path not found' }),
    }))

    await row(page, 'source').dblclick()

    const empty = page.locator('.explorer-main:visible .explorer-empty-state')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('Can\'t open this folder')
    await expect(empty).toContainText('Path not found')
    // 关键：不能把加载失败说成空目录
    await expect(empty).not.toContainText('This folder is empty')
    await expect(empty.getByRole('button', { name: 'Try again' })).toBeVisible()

    await screenshot(page, '11-list-error')
  })

  test('网络位置不可达时给出可重试的提示，而不是「文件不存在」', async ({ page }) => {
    await login(page)

    await page.route('**/api/files/list**', route => route.fulfill({
      status: 503,
      headers: { 'Retry-After': '3' },
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Network location is unreachable' }),
    }))

    await row(page, 'source').dblclick()

    const empty = page.locator('.explorer-main:visible .explorer-empty-state')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('Network location is unreachable')
    // 「服务器不可达」不得被说成「文件没了」
    await expect(empty).not.toContainText('Path not found')
    await expect(empty.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('重试成功后错误消失、目录正常显示', async ({ page }) => {
    await login(page)

    let failFirst = true
    await page.route('**/api/files/list**', async (route) => {
      if (failFirst) {
        failFirst = false
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Path not found' }),
        })
        return
      }
      await route.continue()
    })

    await row(page, 'source').dblclick()

    const empty = page.locator('.explorer-main:visible .explorer-empty-state')
    await expect(empty).toBeVisible()
    await empty.getByRole('button', { name: 'Try again' }).click()

    // 第二次放行真实请求：错误卡片消失，目录内容出来
    await expect(empty).toBeHidden()
    await expect(row(page, 'a.txt')).toBeVisible()
  })

  test('已显示的文件不会被一次刷新失败赶走', async ({ page }) => {
    await login(page)
    await openFolder(page, 'source')
    await selectItem(page, 'a.txt')

    // 同目录刷新失败：旧列表是有效的，不该被错误卡片顶掉
    await page.route('**/api/files/list**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Failed to read the path' }),
    }))
    await page.locator('.explorer-main:visible button[title^="Refresh"]').click()

    await expect(row(page, 'a.txt')).toBeVisible()
    await expect(page.locator('.explorer-main:visible .explorer-empty-state')).toBeHidden()
  })
})
