// 跨平台的测试入口：把 Playwright 的浏览器目录固定到 e2e/.browsers，
// 避免依赖 shell 语法（Windows 下 `VAR=x cmd` 不可用）。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(e2eDir, '.browsers')
process.env.TMPDIR ||= path.join(e2eDir, '.tmp')

/**
 * 用 node 直接跑 Playwright 的 CLI，而不是 node_modules/.bin 里的垫片。
 *
 * 垫片在不同包管理器 / 平台上形态不同：bun 在 Windows 上装的是
 * `playwright.exe`，npm 装的是 `playwright.cmd`（而 Node 出于安全不允许
 * `spawn` 直接执行 .cmd，会抛 EINVAL）。走 `node cli.js` 两边都稳，
 * 也就不必再按平台分支。
 */
const cli = path.join(e2eDir, 'node_modules', '@playwright', 'test', 'cli.js')
if (!existsSync(cli)) {
  console.error(`找不到 Playwright CLI：${cli}\n先在 e2e/ 下执行 bun install。`)
  process.exit(1)
}

const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: e2eDir,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', code => process.exit(code ?? 0))
