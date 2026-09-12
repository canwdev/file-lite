// 把 Chromium 装进项目内的 .browsers（沙箱/CI 里 HOME 往往不可写）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')
const bin = path.join(e2eDir, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright')

execFileSync(bin, ['install', 'chromium'], {
  cwd: e2eDir,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(e2eDir, '.browsers') },
})
