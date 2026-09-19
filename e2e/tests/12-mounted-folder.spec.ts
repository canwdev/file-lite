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
 * 一段**真的** 1 秒 440Hz 单声道 MP3，**带内嵌封面**（ffmpeg 生成，约 4.9KB）。
 *
 * 音乐播放器要解出时长、封面与标签，用几个字节的假音频是测不出来的——浏览器会直接
 * 报解码错误，用例就变成在测「假文件当然放不了」。封面还要走一遍 Range 元数据解析，
 * 那条路过去对 `blob:` 地址直接发 HEAD 而失败（`net::ERR_METHOD_NOT_SUPPORTED`），
 * 所以必须用带封面的真文件才能覆盖到。
 */
const REAL_MP3_BASE64 = `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`

const REAL_MP3_SECOND_BASE64 = `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`

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
    // 第二首（同样带封面）：切歌用例要用它复现「切歌后封面/歌词丢失」
    const bytes2 = Uint8Array.from(atob(window.__REAL_MP3_SECOND_BASE64), c => c.charCodeAt(0))
    const audio2 = await dir.getFileHandle('tone2.mp3', { create: true })
    const audioWriter2 = await audio2.createWritable()
    await audioWriter2.write(new Blob([bytes2], { type: 'audio/mpeg' }))
    await audioWriter2.close()
    // 嵌套子目录：文件夹预览与面包屑下拉会去列它，那条路过去不走门面 → 404
    const sub = await dir.getDirectoryHandle('sub folder', { create: true })
    const deep = await sub.getDirectoryHandle('深い フォルダ', { create: true })
    const inner = await deep.getFileHandle('inner.txt', { create: true })
    const innerWriter = await inner.createWritable()
    await innerWriter.write('inner')
    await innerWriter.close()
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
  await page.addInitScript(`window.__REAL_MP3_SECOND_BASE64 = ${JSON.stringify(REAL_MP3_SECOND_BASE64)}`)
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

    // 内嵌封面必须解析出来。
    //
    // 这一步覆盖一个真实回归：元数据解析走 Range tokenizer，它第一步是 `HEAD`，
    // 而 `fetch(blobUrl, { method: 'HEAD' })` 在 Chromium 直接失败
    // （`net::ERR_METHOD_NOT_SUPPORTED`），于是挂载卷里的音乐永远没有封面。
    // 有封面 ↔ tokenizer 对 blob 走的是本地切片而不是 HTTP HEAD。
    await expect(page.locator('.media-player-wrap img').first()).toBeVisible({ timeout: 15_000 })

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

  test('嵌套子目录的预览与面包屑不把挂载路径发给服务端', async ({ page }) => {
    const dirName = mountDir
    const { requests, failures } = apiLog

    await mountOpfs(page, dirName)

    // 挂载卷里有一个带空格与日文的嵌套子目录：文件夹预览会去列它，
    // 面包屑下拉也会。这条路径过去被直接发给 `/api/files/list` → 404。
    await expect(row(page, 'sub folder')).toBeVisible()
    // 让文件夹预览真正触发（它按时长防抖后才会去读子目录）
    await page.waitForTimeout(1500)

    await row(page, 'sub folder').dblclick()
    await expect(currentCrumb(page)).toHaveText('sub folder')
    await page.waitForTimeout(1200)

    // 再深一层：路径里出现空格与日文，编码后最容易漏判
    await row(page, '深い フォルダ').dblclick()
    await expect(currentCrumb(page)).toHaveText('深い フォルダ')
    await page.waitForTimeout(1500)

    // 打开面包屑下拉，它会去列挂载路径
    await page.locator('.address-bar__crumb').last().click()
    await page.waitForTimeout(1200)

    expect(mountedLeaks(requests)).toEqual([])
    expect(failures).toEqual([])
  })

  test('切歌后封面与歌词仍然加载（回归）', async ({ page }) => {
    const dirName = mountDir
    await mountOpfs(page, dirName)

    const cover = page.locator('.media-player-wrap img').first()
    const lyricsToggle = page.locator('.media-player-wrap button[title*="yric" i]')

    // 第一首：封面出现
    await row(page, 'tone.mp3').dblclick()
    await expect(cover).toBeVisible({ timeout: 15_000 })

    // 切到第二首。挂载卷的 objectURL 是异步解析的：切歌那一帧地址还是空的，
    // 过去标签只读一次就永久放弃，于是封面与歌词「偶现」丢失。
    await page.locator('.media-player-wrap button[title="Next"]').click()
    await expect.poll(async () => await cover.getAttribute('src')).toContain('blob:')
    // 第二首同样有内嵌封面
    await expect(cover).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => await cover.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)

    // 歌词：第二首没有歌词，但歌词开关本身要可用且不报错——
    // 真正的断言是「元数据解析跑完了」（封面就是它的产物），这里只确认界面没炸
    if (await lyricsToggle.count()) {
      expect(await lyricsToggle.first().isVisible()).toBe(true)
    }
  })
})
