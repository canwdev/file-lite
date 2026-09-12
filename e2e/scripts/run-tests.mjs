// 跨平台的测试入口：把 Playwright 的浏览器目录固定到 e2e/.browsers，
// 避免依赖 shell 语法（Windows 下 `VAR=x cmd` 不可用）。
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(e2eDir, '.browsers')
process.env.TMPDIR ||= path.join(e2eDir, '.tmp')

const bin = path.join(e2eDir, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright')
const child = spawn(bin, ['test', ...process.argv.slice(2)], {
  cwd: e2eDir,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', code => process.exit(code ?? 0))
