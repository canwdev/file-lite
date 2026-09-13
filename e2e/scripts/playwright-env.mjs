// 固定 Playwright 的浏览器目录与临时目录（沙箱 / CI 里 HOME 往往不可写）。
//
// 必须在 `@playwright/test` / `playwright` 被 import **之前**执行：那两个包在加载时就
// 读一次 PLAYWRIGHT_BROWSERS_PATH，之后再改环境变量已经晚了。所以调用方要把它放在
// import 列表的第一行。
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(e2eDir, '.browsers')
process.env.TMPDIR ||= path.join(e2eDir, '.tmp')
