// 夹具定义：只导出常量与准备函数，**不能有副作用**。
//
// 测试代码（tests/helpers.ts）也会导入这里，所以任何「启动服务器」之类的动作
// 都必须留在 start-app.mjs 里，否则每个测试 worker 都会再起一个服务。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const workDir = path.resolve(here, '..', '.file-lite-e2e')

export const PORT = Number(process.env.E2E_PORT || 4173)
export const PASSWORD = 'e2e-password'
export const dataDir = path.join(workDir, 'data')
export const filesDir = path.join(workDir, 'files')
export const uploadDir = path.join(workDir, 'upload')

/**
 * 拖拽用例的夹具树：`drag/inbox` 放被拖走的文件、`drag/archive` 当落点。
 * 单独隔开是为了让拖拽用例反复搬文件也不影响其它用例依赖的 source / target。
 * 与 `tests/helpers.ts` 的 `resetDragDirs()` 必须保持一致。
 */
export function createDragFixture() {
  const drag = path.join(filesDir, 'drag')
  fs.rmSync(drag, { recursive: true, force: true })
  fs.mkdirSync(path.join(drag, 'inbox', 'sub'), { recursive: true })
  fs.mkdirSync(path.join(drag, 'archive'), { recursive: true })
  fs.writeFileSync(path.join(drag, 'inbox', 'move-me.txt'), 'move-content')
  fs.writeFileSync(path.join(drag, 'inbox', 'copy-me.txt'), 'copy-content')
  fs.writeFileSync(path.join(drag, 'inbox', 'ctrl-me.txt'), 'ctrl-content')
  fs.writeFileSync(path.join(drag, 'inbox', 'sub', 'back.txt'), 'back-content')
  return drag
}

/**
 * 内置 App 用例的夹具树。
 *
 * 单独一个目录，避免往 source/ 里加文件影响其它用例的行数与排序：
 * - `hello.txt` 文本编辑器第一次打开必须有内容；
 * - `gbk.txt` 是 GB18030 的「你好」+ 换行，用来验证编码往返；
 * - `page.html` HTML 查看器要能读到 iframe 里的标题；
 * - `picture.png` / `picture2.png` 给看图与画廊（单例复用）；
 * - `note.md` 给默认 App 匹配（.md 由文本编辑器打开）。
 */
export function createAppsFixture() {
  const apps = path.join(filesDir, 'apps')
  fs.rmSync(apps, { recursive: true, force: true })
  fs.mkdirSync(apps, { recursive: true })
  fs.writeFileSync(path.join(apps, 'hello.txt'), 'hello apps')
  fs.writeFileSync(path.join(apps, 'note.md'), '# app note')
  // GB18030：「你好」= C4 E3 BA C3
  fs.writeFileSync(path.join(apps, 'gbk.txt'), Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x0A]))
  fs.writeFileSync(
    path.join(apps, 'page.html'),
    '<!doctype html><meta charset="utf-8"><title>page</title><h1 id="hello">html-viewer-ok</h1>',
  )
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  fs.writeFileSync(path.join(apps, 'picture.png'), png)
  fs.writeFileSync(path.join(apps, 'picture2.png'), png)
  return apps
}

/**
 * A real 1-second 32x32 VP8 WebM.
 *
 * The media recovery test has to reach `loadedmetadata` after it replays the
 * source, so `clip.mp4` (deliberately fake bytes, used by the selector test)
 * cannot stand in for it. Chromium decodes this one without any external
 * fixture or ffmpeg dependency.
 */
const TINY_WEBM_BASE64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAQQEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggP67AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WI2hn7Yem59dacgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4JCwgSC6gSCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WI2hn7Yem59dZnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QlHngQCjpIEAAIAwAgCdASogACAAAEcIhYWIhYSIAgIAB5DzycD+/6tQgKOVgQAoALEBAAEQEAAYABhYL/QACHAAo5WBAFAAsQEAARAQABgAGFgv9AAIcACjlYEAeACxAQABEBAAGAAYWC/0AAhwAKOVgQCgALEBAAEQEAAYABhYL/QACHAAo5WBAMgAsQEAARAQABgAGFgv9AAIcACjlYEA8ACxAQABEBAAGAAYWC/0AAhwAKOVgQEYALEBAAEQEBRgAGFgv9AAIcAAo5WBAUAAsQEAARAQABgAGFgv9AAIcACjlYEBaACxAQABEBAAGAAYWC/0AAhwAKOVgQGQALEBAAEQEAAYABhYL/QACHAAo5WBAbgAsQEAARAQABgAGFgv9AAIcACjlYEB4ACxAQABEBAAGAAYWC/0AAhwAKOVgQIIALEBAAEQEAAYABhYL/QACHAAo5WBAjAAsQEAARAQABgAGFgv9AAIcACjlYECWACxAQABEBAAGAAYWC/0AAhwAKOVgQKAALEBAAEQEAAYABhYL/QACHAAo5WBAqgAsQEAARAQABgAGFgv9AAIcACjlYEC0ACxAQABEBAUYABhYL/QACHAAKOVgQL4ALEBAAEQEAAYABhYL/QACHAAo5WBAyAAsQEAARAQABgAGFgv9AAIcACjlYEDSACxAQABEBAAGAAYWC/0AAhwAKOVgQNwALEBAAEQEAAYABhYL/QACHAAo5WBA5gAsQEAARAQABgAGFgv9AAIcACjlYEDwACxAQABEBAAGAAYWC/0AAhwABxTu2uRu4+zgQC3iveBAfGCAaPwgQM='

/**
 * 夹具文件树。测试用例都基于这个固定结构，改动这里要同步 tests/helpers.ts。
 */
export function resetFixture() {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(filesDir, { recursive: true, force: true })
  fs.rmSync(uploadDir, { recursive: true, force: true })

  fs.mkdirSync(path.join(filesDir, 'source', 'nested'), { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'target'), { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'empty'), { recursive: true })

  fs.writeFileSync(path.join(filesDir, 'source', 'a.txt'), 'alpha')
  fs.writeFileSync(path.join(filesDir, 'source', 'b.txt'), 'beta')
  fs.writeFileSync(path.join(filesDir, 'source', 'note.md'), '# note')
  // 文件名里的 "+" 与空格：下载用例靠它们复现「二次解码」和「download 属性覆盖文件名」
  fs.writeFileSync(path.join(filesDir, 'source', '039.+Vexento+-+Borealis.mp3'), 'fake-audio-bytes')
  // 视频占位文件：选择器用例靠它打开 Artplayer（音频走的是另一套播放界面）
  fs.writeFileSync(path.join(filesDir, 'source', 'clip.mp4'), 'fake-video-bytes')
  // 真正可解码的短视频：媒体续期的 E2E 要走到 loadedmetadata
  fs.writeFileSync(path.join(filesDir, 'source', 'tiny.webm'), Buffer.from(TINY_WEBM_BASE64, 'base64'))
  fs.writeFileSync(path.join(filesDir, 'source', 'report final.txt'), 'report body')
  fs.writeFileSync(path.join(filesDir, 'source', 'nested', 'deep.txt'), 'deep')

  // target 里预置同名文件：复制/上传的冲突用例依赖它
  fs.writeFileSync(path.join(filesDir, 'target', 'a.txt'), 'existing-alpha')
  fs.mkdirSync(path.join(filesDir, 'target', 'nested'), { recursive: true })

  // 上传用的本地文件（其中 a.txt 与服务端目标同名，触发冲突）
  fs.mkdirSync(uploadDir, { recursive: true })
  fs.writeFileSync(path.join(uploadDir, 'a.txt'), 'uploaded-alpha')
  fs.writeFileSync(path.join(uploadDir, 'fresh.txt'), 'fresh-upload')

  createDragFixture()
  createAppsFixture()

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    host: '127.0.0.1',
    port: String(PORT),
    password: PASSWORD,
  }, null, 2))
}
