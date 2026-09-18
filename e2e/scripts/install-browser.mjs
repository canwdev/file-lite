// 把 Chromium 装进项目内的 .browsers（沙箱/CI 里 HOME 往往不可写）。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')

// 与 run-tests.mjs 同源：走 `node cli.js` 而不是 .bin 垫片，避免
// 「bun 装的是 .exe、npm 装的是 .cmd，而 Node 不允许 spawn .cmd」这类平台差异。
const cli = path.join(e2eDir, 'node_modules', '@playwright', 'test', 'cli.js')
if (!existsSync(cli)) {
  console.error(`找不到 Playwright CLI：${cli}\n先在 e2e/ 下执行 bun install。`)
  process.exit(1)
}

execFileSync(process.execPath, [cli, 'install', 'chromium'], {
  cwd: e2eDir,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(e2eDir, '.browsers') },
})
