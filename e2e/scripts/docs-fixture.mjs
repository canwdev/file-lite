// README 截图用的演示库：一份「看起来像真在用」的文件树，用 .samples/ 里的素材填充。
//
// 与测试夹具（fixture.mjs）完全分开：测试断言依赖 a.txt / target / drag 那套结构，
// 不能为了好看的截图去动它。
//
// 位置放在 /tmp 而不是仓库里：地址栏显示的是绝对路径，放在仓库里就会把
// `.../file-lite/e2e/.file-lite-e2e/docs/files/...` 印到截图里。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { demoImages, demoMusic, demoVideos, samplePaths } from './docs-assets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const docsWorkDir = process.env.E2E_DOCS_DIR || path.join('/tmp', 'file-lite-demo')
export const docsFilesDir = path.join(docsWorkDir, 'files')
export const docsDataDir = path.join(docsWorkDir, 'data')
/** 截图需要用到、但不能出现在文件列表里的临时文件。 */
export const docsTmpDir = path.join(docsWorkDir, 'tmp')
export const DOCS_PORT = Number(process.env.E2E_DOCS_PORT || 4174)
export const DOCS_PASSWORD = 'e2e-password'

/**
 * 截图里的时间戳：相对「现在」往前铺开几天。
 * 创建时间改不了（Linux 的 birthtime 是今天），所以修改时间必须早于今天才不矛盾。
 */
const BASE_TIME = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)

function put(file, content, index) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  const time = new Date(BASE_TIME.getTime() - index * 37 * 60 * 1000)
  fs.utimesSync(file, time, time)
}

function copy(from, to, index) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const time = new Date(BASE_TIME.getTime() - index * 53 * 60 * 1000)
  fs.utimesSync(to, time, time)
}

/** 目录的 mtime 也得往回拨，否则属性窗口里会显示「刚刚」。 */
function stampDirectories() {
  const dirs = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const full = path.join(dir, entry.name)
        walk(full)
        dirs.push(full)
      }
    }
  }
  walk(docsFilesDir)
  dirs.push(docsFilesDir)
  dirs.forEach((dir, index) => {
    const time = new Date(BASE_TIME.getTime() - (index + 1) * 11 * 60 * 1000)
    fs.utimesSync(dir, time, time)
  })
}

const DOCUMENTS = {
  'release-notes.md': `# File Lite 1.5.0

## Explorer

- Built-in tabs, remembered across reloads
- Split a tab into two panes and drag files between them
- Copy, move and delete run as background tasks

## Media

- Music player reads cover art and lyrics from the file's own tags
- Endless Gallery turns a folder into a short-video style feed
- Video covers are generated with ffmpeg

## Notes

Everything runs from a single Go binary with the UI embedded.
`,
  'server-config.json': `{
  "host": "0.0.0.0",
  "port": "3111",
  "password": "change-me",
  "startPath": "/srv/files",
  "logLevel": "warn",
  "allowedCIDRs": null,
  "allowSelfUpdate": false
}
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>File Lite</title>
  </head>
  <body>
    <h1>Hello from File Lite</h1>
    <p>This page is served straight out of the folder you are browsing.</p>
  </body>
</html>
`,
  'inventory.csv': `name,category,size,added
Aurora over the lake.jpg,Pictures,1.2 MB,2026-05-02
Borealis.mp3,Music,0.2 MB,2026-05-04
Flower.mp4,Videos,1.1 MB,2026-05-06
release-notes.md,Documents,0.6 KB,2026-05-09
`,
  'reading-list.txt': `Read later
----------
- The Go Programming Language
- Designing Data-Intensive Applications
- Refactoring UI
`,
}

/**
 * 重建演示库与它自己的 config.json。
 * 素材必须先由 ensureSamples() 准备好（这里只做拷贝，不联网）。
 */
export function resetDocsFixture() {
  fs.rmSync(docsFilesDir, { recursive: true, force: true })
  fs.rmSync(docsDataDir, { recursive: true, force: true })
  fs.rmSync(docsTmpDir, { recursive: true, force: true })
  fs.mkdirSync(docsFilesDir, { recursive: true })
  fs.mkdirSync(docsDataDir, { recursive: true })
  fs.mkdirSync(docsTmpDir, { recursive: true })

  let index = 0
  for (const image of demoImages) {
    copy(samplePaths.image(image), path.join(docsFilesDir, 'Pictures', image.file), index++)
  }
  // Pictures 里混一段视频，网格视图就能同时展示图片预览与视频首帧
  copy(samplePaths.video(demoVideos[1]), path.join(docsFilesDir, 'Pictures', demoVideos[1].file), index++)

  // Media 是给「缩略图与预览」那张截图用的混合目录：图片 + 视频 + 音频三种预览同框
  for (const image of demoImages.slice(0, 4)) {
    copy(samplePaths.image(image), path.join(docsFilesDir, 'Media', image.file), index++)
  }
  copy(samplePaths.video(demoVideos[0]), path.join(docsFilesDir, 'Media', demoVideos[0].file), index++)
  for (const track of demoMusic.slice(0, 3)) {
    copy(samplePaths.music(track), path.join(docsFilesDir, 'Media', track.file), index++)
  }

  for (const video of demoVideos) {
    copy(samplePaths.video(video), path.join(docsFilesDir, 'Videos', video.file), index++)
  }
  for (const track of demoMusic) {
    copy(samplePaths.music(track), path.join(docsFilesDir, 'Music', track.file), index++)
  }
  for (const [name, content] of Object.entries(DOCUMENTS)) {
    put(path.join(docsFilesDir, 'Documents', name), content, index++)
  }
  put(path.join(docsFilesDir, 'welcome.txt'), 'Drop files here, or use Upload Files... to send new ones.\n', index++)
  stampDirectories()

  fs.writeFileSync(path.join(docsDataDir, 'config.json'), JSON.stringify({
    host: '127.0.0.1',
    port: String(DOCS_PORT),
    password: DOCS_PASSWORD,
    startPath: docsFilesDir,
    logLevel: 'error',
  }, null, 2))

  return docsFilesDir
}
