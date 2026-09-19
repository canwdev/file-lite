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

/**
 * 一段**真的** 1 秒 440Hz 单声道 MP3（ffmpeg 生成，约 4.5KB）。
 *
 * 音乐播放器要解出时长、封面与标签，用几个字节的假音频是测不出来的——浏览器会直接
 * 报解码错误，用例就变成在测「假文件当然放不了」。所以这里内联一段真音频。
 */
const REAL_MP3_BASE64 = `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`

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
    // 真音频：音乐播放器要能真的解码它，假字节测不出问题
    const bytes = Uint8Array.from(atob(window.__REAL_MP3_BASE64), c => c.charCodeAt(0))
    const audio = await dir.getFileHandle('tone.mp3', { create: true })
    const audioWriter = await audio.createWritable()
    await audioWriter.write(new Blob([bytes], { type: 'audio/mpeg' }))
    await audioWriter.close()
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
  // 真音频通过 window 传给种子脚本（addInitScript 的内容会内联进页面，不适合塞 6KB base64）
  await page.addInitScript(`window.__REAL_MP3_BASE64 = ${JSON.stringify(REAL_MP3_BASE64)}`)
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
 * 记录本轮页面上的 API 请求与失败响应。
 *
 * 挂载卷的失败模式很隐蔽：某处忘了分流就会发一条
 * `/api/files/list?path=/@mounted/...` 出去，界面上只表现为「列表空了」，
 * 既没有报错也没有 toast。所以在 e2e 里把请求与 4xx/5xx 显式记下来并断言。
 */
let apiLog: { requests: { method: string, url: string }[], failures: { status: number, url: string }[] } = { requests: [], failures: [] }

function trackApi(page: Page) {
  const requests: { method: string, url: string }[] = []
  const failures: { status: number, url: string }[] = []
  apiLog = { requests, failures }
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/')) {
      return
    }
    requests.push({ method: request.method(), url: url.replace(/^https?:\/\/[^/]+/, '') })
  })
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/api/') && response.status() >= 400) {
      failures.push({ status: response.status(), url: url.replace(/^https?:\/\/[^/]+/, '') })
    }
  })
  return { requests, failures }
}

/** 有没有把挂载路径发给服务端（那就是分流漏了一处）。 */
function mountedLeaks(requests: { method: string, url: string }[]) {
  return requests.filter(item => item.url.includes('%40mounted') || item.url.includes('/@mounted'))
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
    // 从第一次导航就开始记录，否则登录那一跳里的请求会漏掉
    trackApi(page)
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

  test('音乐播放器能播挂载卷里的音乐', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    // tone.mp3 由默认 app 关联到 Media Player；双击打开
    await row(page, 'tone.mp3').dblclick()

    // 播放器把挂载卷里的音频读成 objectURL——而不是去请求服务端。
    // 注意 `<audio>` 是 `v-show="false"` 的功能性元素，不能断言「可见」。
    const audio = page.locator('audio').first()
    await expect.poll(async () => await audio.getAttribute('src'), { timeout: 15_000 }).toContain('blob:')

    // 真音频必须能被解码：readyState >= HAVE_CURRENT_DATA 且时长 > 0。
    // 这一步是这条用例的重点——用假字节的话 duration 永远是 NaN。
    await expect.poll(async () => await audio.evaluate((el: HTMLAudioElement) => el.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2)
    const duration = await audio.evaluate((el: HTMLAudioElement) => el.duration)
    expect(duration).toBeGreaterThan(0.5)

    // 能真正开始播放（headless 下 Chromium 用静音策略放行）
    await audio.evaluate(async (el: HTMLAudioElement) => {
      el.muted = true
      await el.play()
    })
    await expect.poll(async () => await audio.evaluate((el: HTMLAudioElement) => el.paused || el.currentTime > 0))
      .toBe(true)

    await screenshot(page, '12-mounted-music')
  })

  test('接口请求：不发挂载路径、不重复拉盘、无失败响应', async ({ page }) => {
    const dirName = mountDir
    const { requests, failures } = apiLog

    await mountOpfs(page, dirName)
    await expect(row(page, 'tone.mp3')).toBeVisible()
    // 离开再回来，覆盖面包屑 / 导航带来的请求
    await goToFixtureRoot(page)
    await page.locator('.mounted-list__item').click()
    await expect(row(page, 'hello.txt')).toBeVisible()
    await page.waitForTimeout(1200)

    // 1) 一条挂载路径都不该发给服务端（漏了分流就会漂到这里）
    expect(mountedLeaks(requests)).toEqual([])

    // 2) 不该有失败响应（尤其是曾经出现过的
    //    `/api/files/list?path=%2F%40mounted%2F` 那种 404/400）
    expect(failures).toEqual([])

    // 3) 盘列表只该拉一次：drives.ts 有缓存 + 并发去重，而侧边栏与资源管理器面板
    //    是在同一帧各自发起加载的（过去因此稳定发出两条 GET /api/files/drives）
    const driveCalls = requests.filter(item => item.url.startsWith('/api/files/drives'))
    expect(driveCalls.length).toBe(1)
  })
})
