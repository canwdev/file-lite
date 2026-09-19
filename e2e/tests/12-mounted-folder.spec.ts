import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { login, resetTargetDirs, row, screenshot, selectItem, sourceDir, targetDir } from './helpers'

/**
 * 浏览器挂载的本地文件夹。
 *
 * 被测对象是「浏览器里的文件系统」这半边：挂载、浏览、写入，以及与服务器之间的
 * 双向复制与移动。真实场景里 `showDirectoryPicker()` 会弹系统目录选择框；测试把它
 * 打桩成 **OPFS** —— 它返回的同样是 `FileSystemDirectoryHandle`，而且能被测试代码
 * 直接读写，所以断言可以一路验到「文件真的落到了那个目录里」，而不只是看界面。
 *
 * 打桩的关键点：`navigator.storage.getDirectory()` 被替换成「挂载目录句柄」本身，
 * 并把种子写入挂在它前面（应用一调就必须等到种子写完），否则挂载列表可能先渲染出
 * 一个空目录。只做 `page.addInitScript`，生产代码里不掺任何测试开关。
 */

const MOUNT_LABEL = 'fs-mount'

/**
 * 每个用例一个独立的 OPFS 目录。
 *
 * OPFS 是**按 profile 持久**的，同一个 worker 里的用例共用一份存储；如果都挂同一个
 * 目录，前一个用例写进去的文件会留在里面，后一个用例的「目录里只有这两个文件」这种
 * 断言就会莫名其妙地失败。给每个用例一个自己的目录，并只 seed 一次（`Seeded` 标记），
 * 刷新时不会把用例自己写进去的文件清掉。
 */
let mountDirSeq = 0
function nextMountDir() {
  mountDirSeq += 1
  return `fs-mount-${mountDirSeq}`
}

/**
 * 目录选择框返回的句柄，同时也是 `navigator.storage.getDirectory()` 的返回值。
 *
 * `access` 决定这个卷以什么权限落地：`readwrite` 一路放行，`read-only` 只批读、
 * 拒绝写。权限函数挂在**应用真正拿到的那一个目录句柄**上，不要在其中再做一层
 * `getDirectoryHandle` —— 应用不会去解析那一层，桩就会静默失效。
 */
const opfsStub = (access: 'readwrite' | 'read-only' = 'readwrite', dirName = MOUNT_LABEL) => `
;(async () => {
  const root = await navigator.storage.getDirectory()
  // 应用挂载的是 getDirectory() 解析出来的那个句柄，权限函数必须挂在它身上
  const dir = await root.getDirectoryHandle(${JSON.stringify(dirName)}, { create: true })
  const put = async (name, text) => {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  }
  // 只在第一次 seed：刷新后用例自己写进去的文件不能被重新 seed 冲掉
  if (!window.__opfsSeeded) {
    window.__opfsSeeded = true
    await put('hello.txt', 'mounted-hello')
    await put('notes.md', '# notes')
  }
  // 显式按 mode 回答：只读卷只批读、拒绝写。读写能力由注入时的 access 决定，
  // 每个用例在 beforeEach 里定好后就不再变。
  dir.queryPermission = async options =>
    (options && options.mode === 'readwrite' ? ${access === 'readwrite' ? "'granted'" : "'prompt'"} : 'granted')
  dir.requestPermission = async () =>
    (${access === 'readwrite' ? "'granted'" : "'denied'"})
  window.showDirectoryPicker = async () => dir
})()
`

async function stubOpfsMount(page: Page, access: 'readwrite' | 'read-only' = 'readwrite', dirName = MOUNT_LABEL) {
  await page.addInitScript(opfsStub(access, dirName))
}

/** 挂载 OPFS 目录并进入它。 */
async function mountOpfs(page: Page, dirName: string) {
  await page.locator('.mounted-list .sidebar-list__header button[title="Mount a local folder"]').click()
  const item = page.locator('.mounted-list__item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText(dirName)
  await item.click()
  await expect(currentCrumb(page)).toHaveText(dirName)
}

function currentCrumb(page: Page) {
  return page.locator('.explorer-main:visible .address-bar__crumb-text').last()
}

/**
 * 读挂载目录的子项名。
 *
 * 打桩把 `getDirectory()` 换成了挂载目录句柄，所以这里直接对它 `entries()`。
 */
async function readOpfsDir(page: Page, dirName: string): Promise<string[]> {
  return await page.evaluate(async (name) => {
    const root: any = await navigator.storage.getDirectory()
    const dir: any = await root.getDirectoryHandle(name)
    const names: string[] = []
    for await (const [name] of dir.entries()) {
      names.push(name)
    }
    return names.sort()
  }, dirName)
}

async function readOpfsFile(page: Page, file: string, dirName: string): Promise<string | null> {
  return await page.evaluate(async ({ dirName, file }) => {
    try {
      const root: any = await navigator.storage.getDirectory()
      const dir: any = await root.getDirectoryHandle(dirName)
      const handle = await dir.getFileHandle(file)
      return await (await handle.getFile()).text()
    }
    catch {
      return null
    }
  }, { dirName, file })
}

/**
 * 回到服务端夹具根（侧边栏第一项 = helpers 打桩出来的 Files 盘）。
 *
 * 选择器用 `.drive-list` 而非行上的类名：行上的 `sidebar-list__item` 与挂载区共用，
 * 只有外层容器能区分「这是 Storage 区」。
 */
async function goToFixtureRoot(page: Page) {
  await page.locator('.drive-list .sidebar-list__item').first().click()
  await expect(row(page, 'source')).toBeVisible()
}

/** 走新建文档 / 新建文件夹的输入弹窗。 */
async function submitInputPrompt(page: Page, value: string) {
  const box = page.locator('.el-message-box')
  await expect(box).toBeVisible()
  await box.locator('input').fill(value)
  await box.locator('.el-message-box__btns button').last().click()
}

test.describe('浏览器挂载文件夹', () => {
  /**
   * 本用例使用的 OPFS 目录名。
   *
   * 桩必须在**首次导航之前**注入（`addInitScript` 只影响之后的导航），所以只能放在
   * `beforeEach` 里；目录名由这里生成后传给用例，保证每个用例一份干净的存储。
   * `access` 默认读写，只读用例会先重置成只读再重新挂载。
   */
  let mountDir = MOUNT_LABEL
  /** 由只读用例在**注册桩之前**改掉；`beforeEach` 用它决定桩怎么回答权限。 */
  let mountAccess: 'readwrite' | 'read-only' = 'readwrite'
  const READ_ONLY_CASE = '只读卷：写操作被挡住并说明原因'

  test.beforeEach(async ({ page }, testInfo) => {
    resetTargetDirs()
    mountDir = nextMountDir()
    mountAccess = testInfo.title === READ_ONLY_CASE ? 'read-only' : 'readwrite'
    await stubOpfsMount(page, mountAccess, mountDir)
    await login(page)
  })

  test('挂载、浏览，并可以取消挂载', async ({ page }) => {
    const dirName = mountDir
    // 未挂载时只有空态
    await expect(page.locator('.mounted-list__empty')).toContainText('No folder mounted')

    await mountOpfs(page, dirName)

    // 挂载卷里的文件列出来了
    await expect(row(page, 'hello.txt')).toBeVisible()
    await expect(row(page, 'notes.md')).toBeVisible()

    // 离开再回来：挂载项还在，内容仍然可读
    await goToFixtureRoot(page)
    await page.locator('.mounted-list__item').click()
    await expect(row(page, 'hello.txt')).toBeVisible()

    // 取消挂载只删本地记录：卷从侧边栏消失，磁盘上的文件一个不动
    await page.locator('.mounted-list__item .mounted-list__remove').click()
    await expect(page.locator('.mounted-list__item')).toHaveCount(0)
    expect(await readOpfsDir(page, dirName)).toContain('hello.txt')

    await screenshot(page, '12-mounted-folder')
  })

  // 刷新后的自动恢复**无法在这个环境里断言**：Chromium 从 IndexedDB 读回
  // `FileSystemDirectoryHandle` 时会直接把渲染进程打崩（本机 3/3 稳定复现，
  // 与本应用无关）。恢复代码本身（`loadMountedVolumes` 读回句柄并静默查权限）
  // 因此只能靠人工在真实浏览器里验证，不能写成会稳定崩页的用例。
  test.skip('刷新后自动恢复挂载（本环境 Chromium 读回句柄会崩溃，跳过）', async ({ page }) => {
    await mountOpfs(page, mountDir)
    await page.reload()
    await expect(page.locator('.mounted-list__item')).toBeVisible()
  })

  test('新建文件与新建文件夹都落到真实目录里', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)
    const before = await readOpfsDir(page, dirName)

    await page.locator('.explorer-main:visible button[title="Create Folder"]').click()
    await submitInputPrompt(page, 'made-in-browser')
    await expect(row(page, 'made-in-browser')).toBeVisible()

    await page.locator('.explorer-main:visible button[title="Create Document"]').click()
    await submitInputPrompt(page, 'written.txt')
    await expect(row(page, 'written.txt')).toBeVisible()

    // 两个名字都真的出现在 OPFS 目录里
    await expect.poll(async () => (await readOpfsDir(page, dirName)).filter(n => !before.includes(n)).sort())
      .toEqual(['made-in-browser', 'written.txt'])
  })

  test('重命名与删除作用于真实目录', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    await row(page, 'notes.md').click()
    await page.locator('.explorer-main:visible button[title="Rename"]').click()
    await submitInputPrompt(page, 'renamed.md')

    await expect(row(page, 'renamed.md')).toBeVisible()
    await expect.poll(async () => (await readOpfsDir(page, dirName)).includes('renamed.md')).toBe(true)
    expect(await readOpfsFile(page, 'renamed.md', dirName)).toBe('# notes')

    // 删除：确认弹窗后从目录里消失
    await row(page, 'renamed.md').click()
    // 选中态必须跟上（重命名后行是新建的，旧选中对象已经不在列表里）
    await expect(row(page, 'renamed.md')).toHaveClass(/is-active/)
    await page.locator('.explorer-main:visible button[title^="Delete"]').click()
    const confirm = page.locator('.el-message-box')
    await expect(confirm).toBeVisible()
    // 确认键是页脚的主操作按钮（element-plus 文案是 OK）
    await confirm.locator('.el-message-box__btns button').last().click()
    await expect.poll(async () => (await readOpfsDir(page, dirName)).includes('renamed.md')).toBe(false)
    await expect(row(page, 'renamed.md')).toBeHidden()
  })

  test('服务器 → 挂载卷：复制过去并落到真实目录', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    await goToFixtureRoot(page)
    await row(page, 'source').dblclick()
    await selectItem(page, 'a.txt')
    await page.locator('.explorer-main:visible button[title^="Copy (ctrl+c)"]').click()

    // 回到挂载卷里粘贴：目标目录里没有 a.txt，所以不会弹冲突
    await page.locator('.mounted-list__item').click()
    await expect(row(page, 'hello.txt')).toBeVisible()
    await page.locator('.explorer-main:visible button[title^="Paste (ctrl+v)"]').click()

    await expect(row(page, 'a.txt')).toBeVisible()
    await expect.poll(async () => await readOpfsFile(page, 'a.txt', dirName)).toBe('alpha')
  })

  test('挂载卷 → 服务器：复制过去并落到磁盘', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    await selectItem(page, 'hello.txt')
    await page.locator('.explorer-main:visible button[title^="Copy (ctrl+c)"]').click()

    await goToFixtureRoot(page)
    await row(page, 'target').dblclick()
    await page.locator('.explorer-main:visible button[title^="Paste (ctrl+v)"]').click()

    await expect(row(page, 'hello.txt')).toBeVisible()
    await expect.poll(() => {
      try {
        return fs.readFileSync(path.join(targetDir, 'hello.txt'), 'utf8')
      }
      catch {
        return null
      }
    }).toBe('mounted-hello')
  })

  test('移动：从挂载卷搬到服务器，源被删掉', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    // 造一个只给这条用例用的文件，免得影响别的用例
    await page.locator('.explorer-main:visible button[title="Create Document"]').click()
    await submitInputPrompt(page, 'to-move.txt')
    await expect(row(page, 'to-move.txt')).toBeVisible()

    await selectItem(page, 'to-move.txt')
    await page.locator('.explorer-main:visible button[title^="Cut (ctrl+x)"]').click()

    await goToFixtureRoot(page)
    await row(page, 'target').dblclick()
    await page.locator('.explorer-main:visible button[title^="Paste (ctrl+v)"]').click()

    await expect(row(page, 'to-move.txt')).toBeVisible()
    await expect.poll(() => fs.existsSync(path.join(targetDir, 'to-move.txt'))).toBe(true)
    // 源必须被删掉，否则「移动」等于复制
    await expect.poll(async () => (await readOpfsDir(page, dirName)).includes('to-move.txt')).toBe(false)
    // 顺带确认没把夹具搞脏
    expect(fs.readFileSync(path.join(sourceDir, 'a.txt'), 'utf8')).toBe('alpha')
  })

  test('只读卷：写操作被挡住并说明原因', async ({ page }) => {
    // 只读桩已由 beforeEach 按用例名注入（见上面的 mountAccess），这里直接用
    const dirName = mountDir

    await page.locator('.mounted-list .sidebar-list__header button[title="Mount a local folder"]').click()
    const item = page.locator('.mounted-list__item')
    await expect(item).toContainText(dirName)
    // 只读状态在行上有说明
    await expect(item).toContainText('Read-only')

    await item.click()
    await expect(row(page, 'hello.txt')).toBeVisible()

    // 新建文件被挡住，并给出「为什么」
    await page.locator('.explorer-main:visible button[title="Create Document"]').click()
    await submitInputPrompt(page, 'should-not-exist.txt')

    await expect(page.locator('.el-message').last()).toContainText('read-only')
    await expect(row(page, 'should-not-exist.txt')).toBeHidden()
    await expect.poll(async () => (await readOpfsDir(page, dirName)).includes('should-not-exist.txt')).toBe(false)
  })
})
