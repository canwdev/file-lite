// 生成 README 里那张功能表格用的截图：起一台演示服务器，把上面列出的功能逐个截下来，
// 输出到 docs/screenshots/（webp，宽度 1280）。00-main.webp 是手工精修的主图，这里不碰。
//
//   cd e2e && bun run docs:screenshots              # 首次会下载演示素材，之后复用缓存
//   cd e2e && bun run docs:screenshots --only=01,02 # 只重截某几张
//
// 素材来自公开示例站（picsum / samplelib / test-videos.co.uk），
// 下载后缓存在 e2e/.samples/（已 gitignore，可复用、不提交）。
// 每个功能用独立的浏览器上下文截图，localStorage 里的标签页 / 视图状态互不影响。
import './playwright-env.mjs'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { binaryPath, buildApp } from './build-app.mjs'
import { ensureSamples, hasFfmpeg } from './docs-assets.mjs'
import {
  DOCS_PASSWORD,
  DOCS_PORT,
  docsDataDir,
  docsFilesCanonical,
  docsFilesDir,
  docsTmpDir,
  resetDocsFixture,
} from './docs-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')
const repoRoot = path.resolve(e2eDir, '..')
const outDir = path.join(repoRoot, 'docs', 'screenshots')

const BASE = `http://127.0.0.1:${DOCS_PORT}`
const VIEWPORT = { width: 1440, height: 900 }
const OUT_WIDTH = 1280

const args = process.argv.slice(2)
const skipBuild = process.env.E2E_SKIP_BUILD === '1' || args.includes('--no-build')
const refreshSamples = args.includes('--refresh')
const onlyArg = args.find(a => a.startsWith('--only='))
/** `--only=01,04` 按编号前缀匹配，`--only=06-thumbnails` 也接受全名。 */
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean) : null
const wanted = name => !only || only.some(o => name === o || name.startsWith(`${o}-`))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── 页面操作小工具（选择器与 e2e/tests/helpers.ts 保持一致） ─────────────

const row = (page, name) => page.locator(`.explorer-main:visible tr[data-name="${name}"]`)
const currentCrumb = page => page.locator('.explorer-main:visible .address-bar__crumb-text').last()

/**
 * 打开演示库。
 *
 * 1.5.0 起盘列表是**真实的**：不再把它压成「演示库是唯一的盘」——侧边栏
 * 要能看到这台机器上真实的位置（卷、网络位置、WSL 发行版、被 BitLocker
 * 锁住的卷），截图才算把功能展示全。
 *
 * 代价是演示库不再是「侧边栏第一项」：它只是 `D:\tmp\file-lite-demo\files`，
 * 属于 `D:` 卷。所以改用 `?navPath=` 深链直接进演示库——走的是应用自己的
 * 深链入口，不额外改产品行为。`goToRoot` 也走同一个入口。
 */
const demoUrl = `${BASE}/?navPath=${encodeURIComponent(docsFilesCanonical)}`

async function login(page) {
  await page.goto(demoUrl)
  await page.locator('.explorer-wrap').waitFor()
  await expect(row(page, 'Pictures')).toBeVisible()
}

async function openFolder(page, name) {
  await row(page, name).dblclick()
  await expect(currentCrumb(page)).toHaveText(name)
}

/**
 * 回演示库根。
 *
 * 不能点侧边栏第一项——那现在是真实的 Home，不是演示库。重新走一次深链，
 * 与 `login` 完全同一条路径，各张截图拿到的都是同一份干净起点。
 */
async function goToRoot(page) {
  await page.goto(demoUrl)
  await expect(row(page, 'Pictures')).toBeVisible()
}

/** 弹窗 / 菜单的打开动画落定后再截图，否则会拍到半透明的中间态。 */
async function settle(page, ms = 500) {
  await page.waitForTimeout(ms)
}

// ── 各功能点的截图 ────────────────────────────────────────────────────

/** 01 标签页 + 拆分视图：三个标签合成「拆分项 + 普通项」，两个面板各显示不同目录。 */
async function shotTabsSplit(page) {
  await openFolder(page, 'Pictures')
  await page.locator('.explorer-tabs__add').click()
  await goToRoot(page)
  await openFolder(page, 'Music')
  await page.locator('.explorer-tabs__add').click()
  await goToRoot(page)
  await openFolder(page, 'Documents')

  // 拆分项吸收右邻标签，合并成一个标签格（Pictures | Music）
  await page.locator('.explorer-tabs__item').nth(0).click({ button: 'right' })
  await page.locator('.vgo-context-menu__item', { hasText: 'Split view' }).click()
  await expect(page.locator('.explorer-tabs__item')).toHaveCount(2)
  await expect(page.locator('.explorer-tabs__label')).toHaveCount(3)

  // 左面板点一下，确保焦点（也就是主题色边框）在 Pictures 这一侧
  await page.locator('.el-splitter-panel').first().locator('tr[data-name="Autumn forest.jpg"]').click()
  await settle(page, 700)
}

/** 02 传输与后台任务：限速上传一个大文件，面板停在 Transfers 页签并显示实时进度。 */
async function shotTransfersTasks(page, context) {
  await openFolder(page, 'Pictures')

  const bigFile = path.join(docsTmpDir, 'Field recording.wav')
  if (fs.statSync(bigFile, { throwIfNoEntry: false })?.size !== 8 * 1024 * 1024) {
    fs.writeFileSync(bigFile, Buffer.alloc(8 * 1024 * 1024))
  }

  // 限速，让进度条有足够长的可见时间（本机上传 8MB 不到一秒）
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: 2.5 * 1024 * 1024 / 8,
  })

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button[title="Upload Files..."]').click(),
  ])
  await chooser.setFiles(bigFile)

  const panel = page.locator('#file_lite_transfer_panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Transfers' })).toHaveClass(/is-active/)
  await expect.poll(async () => {
    return panel.locator('.transfer-item__progress').first().evaluate(el => el.getBoundingClientRect().width)
  }, { timeout: 60_000 }).toBeGreaterThan(60)
  await settle(page, 600)
}

/** 02 的收尾：取消上传，别在演示库里留下半个文件（截图之后再跑）。 */
async function cleanupTransfersTasks(page) {
  const cancel = page.locator('#file_lite_transfer_panel button[title="Cancel"]').first()
  if (await cancel.count()) {
    await cancel.click().catch(() => {})
  }
  await sleep(500)
  fs.rmSync(path.join(docsFilesDir, 'Pictures', 'Field recording.wav'), { force: true })
}

/** 03 Endless Gallery：整屏媒体 + 底部缩略图条。 */
async function shotGallery(page) {
  await openFolder(page, 'Pictures')
  await row(page, 'Aurora over the lake.jpg').dblclick()
  await expect(page.locator('.endless-gallery')).toBeVisible()
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.endless-gallery img')]
    return imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0)
  }, null, { timeout: 30_000 })
  await settle(page, 900)
}

/** 04 音乐播放器：内嵌封面 + 同步歌词，并展开播放列表。 */
async function shotMusicPlayer(page) {
  await openFolder(page, 'Music')
  await row(page, 'Borealis.mp3').dblclick()
  await expect(page.locator('.media-player-wrap')).toBeVisible()
  await expect(page.locator('.lyric-line').first()).toBeVisible({ timeout: 30_000 })
  // 允许自动播放时它可能已经在播，按钮此时是 Pause
  const play = page.locator('button[title="Play"]')
  if (await play.count()) {
    await play.first().click()
  }
  await page.locator('button[title="Playlist"]').click()
  await settle(page, 1200)
}

/** 05 视频播放器：ArtPlayer 播放中，控件可见。 */
async function shotVideoPlayer(page) {
  await openFolder(page, 'Videos')
  await row(page, 'Big Buck Bunny.mp4').dblclick()
  await expect(page.locator('.media-player')).toBeVisible()
  const video = page.locator('.media-player video').first()
  await video.waitFor({ timeout: 30_000 })
  await video.evaluate(async (el) => {
    el.muted = true
    await el.play().catch(() => {})
  })
  await sleep(1500)
  // ArtPlayer 的控件条会随鼠标隐藏，截前把指针移到画面上
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  await settle(page, 400)
}

/** 06 缩略图与预览：网格视图，图片预览、视频首帧与音频封面一起出现。 */
async function shotThumbnails(page) {
  await openFolder(page, 'Media')
  await page.locator('button[title="Toggle grid view"]').click()
  await expect(page.locator('.file-grid-item').first()).toBeVisible()
  await page.waitForFunction(() => {
    const items = [...document.querySelectorAll('.file-grid-item')]
    const images = [...document.querySelectorAll('.file-grid-item img')]
    return items.length > 1 && images.length >= items.length - 1 && images.every(img => img.complete)
  }, null, { timeout: 45_000 })
  await settle(page, 1500)
}

/** 07 文本编辑器：打开一个 Markdown 文件。 */
async function shotTextEditor(page) {
  await openFolder(page, 'Documents')
  await row(page, 'release-notes.md').dblclick()
  await expect(page.locator('.text-editor-wrap')).toBeVisible()
  await page.locator('.text-editor-textarea').waitFor()
  await settle(page, 600)
}

/** 08 属性窗口：文件夹的递归体积由服务端后台统计。 */
async function shotProperties(page) {
  await goToRoot(page)
  await row(page, 'Pictures').click({ button: 'right' })
  await page.locator('.vgo-context-menu__item', { hasText: 'Properties' }).click()
  const window = page.locator('.properties-window')
  await expect(window).toBeVisible()
  await expect(window.locator('.properties-row', { hasText: 'Contains' }).locator('.properties-value'))
    .toContainText('files', { timeout: 30_000 })
  await expect(window.locator('.properties-row', { hasText: 'Size' }).locator('.properties-value'))
    .not.toHaveText('Loading...')
  await settle(page, 500)
}

/**
 * 截图清单。name 就是 docs/screenshots/ 下的文件名，顺序是执行顺序：
 * 会改动演示库的「传输」放在最后，前面的截图就不会看到它留下的文件。
 */
const SHOTS = [
  { name: '01-tabs-split', run: shotTabsSplit },
  { name: '03-gallery', run: shotGallery },
  { name: '04-music-player', run: shotMusicPlayer },
  { name: '05-video-player', run: shotVideoPlayer },
  { name: '06-thumbnails', run: shotThumbnails },
  { name: '07-text-editor', run: shotTextEditor },
  { name: '08-properties', run: shotProperties },
  { name: '02-transfers-tasks', run: shotTransfersTasks, cleanup: cleanupTransfersTasks },
]

// ── 启动 / 收尾 ───────────────────────────────────────────────────────

let server = null

function shutdown() {
  if (server && !server.killed) {
    server.kill('SIGTERM')
  }
}

function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', error => reject(new Error(`port ${DOCS_PORT} is already in use (${error.code}); stop the process using it first`)))
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(DOCS_PORT, '127.0.0.1')
  })
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/`)
      return
    }
    catch {
      await sleep(300)
    }
  }
  throw new Error(`server on ${BASE} did not come up within ${timeoutMs / 1000}s`)
}

async function fetchToken() {
  const response = await fetch(`${BASE}/api/files/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: DOCS_PASSWORD }),
  })
  if (!response.ok) {
    throw new Error(`login failed with HTTP ${response.status}`)
  }
  const data = await response.json()
  if (!data?.token) {
    throw new Error('login response had no token')
  }
  return data.token
}

/** 把 PNG 缩到 OUT_WIDTH 宽写成 webp；没有 ffmpeg 就退回 PNG。 */
function writeScreenshot(name, png) {
  fs.mkdirSync(outDir, { recursive: true })
  const temp = path.join(outDir, `.${name}.png`)
  fs.writeFileSync(temp, png)
  if (!hasFfmpeg()) {
    fs.renameSync(temp, path.join(outDir, `${name}.png`))
    return `${name}.png`
  }
  const out = path.join(outDir, `${name}.webp`)
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-i', temp,
    '-vf', `scale=${OUT_WIDTH}:-1`,
    '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6',
    out,
  ])
  fs.rmSync(temp)
  return `${name}.webp`
}

async function main() {
  await assertPortFree()
  await ensureSamples({ refresh: refreshSamples })

  if (!skipBuild) {
    buildApp()
  }
  else if (!fs.existsSync(binaryPath())) {
    throw new Error('E2E_SKIP_BUILD is set but the binary does not exist; run `bun run build` first')
  }

  resetDocsFixture()

  console.log(`[docs] starting demo server on ${BASE}`)
  server = spawn(binaryPath(), [], {
    stdio: 'inherit',
    env: { ...process.env, FILE_LITE_DATA_BASE_DIR: docsDataDir },
  })

  await waitForServer()
  const token = await fetchToken()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--autoplay-policy=no-user-gesture-required'],
  })

  try {
    for (const shot of SHOTS) {
      if (!wanted(shot.name)) {
        continue
      }
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        colorScheme: 'light',
      })
      await context.addCookies([{ name: 'file_lite_auth_token', value: token, url: BASE }])
      // 网格图标默认 48px，缩略图太小；mergeDefaults 会把这一段并进本地设置
      await context.addInitScript(() => {
        localStorage.setItem('file_lite_local_settings_store', JSON.stringify({ iconSizeGrid: 200 }))
      })
      const page = await context.newPage()
      console.log(`[docs] capturing ${shot.name}`)
      try {
        await login(page)
        await shot.run(page, context)
        const file = writeScreenshot(shot.name, await page.screenshot())
        console.log(`[docs]   → docs/screenshots/${file}`)
      }
      finally {
        if (shot.cleanup) {
          await shot.cleanup(page, context).catch(() => {})
        }
        await context.close()
      }
    }
  }
  finally {
    await browser.close()
    shutdown()
  }
}

main()
  .then(() => {
    console.log('[docs] done')
  })
  .catch((error) => {
    console.error(`[docs] ${error?.stack ?? error}`)
    shutdown()
    process.exit(1)
  })
