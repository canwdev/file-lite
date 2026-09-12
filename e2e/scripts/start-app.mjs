// Playwright 的 webServer 入口：准备干净的夹具目录 → 启动内嵌前端的后端二进制。
//
// 数据目录与夹具都放在 e2e/.file-lite-e2e/ 下（已 gitignore），
// 这样测试可以随意增删文件、改权限，不会碰到仓库里的任何东西。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { binaryPath, buildApp } from './build-app.mjs'
import { PORT, dataDir, resetFixture } from './fixture.mjs'

/**
 * 端口被占用说明上一次运行留下了孤儿服务进程。
 * 直接报错退出，而不是让第二个服务悄悄起不来、测试连到旧进程上。
 */
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => {
      reject(new Error(`port ${PORT} is already in use (${error.code}); a previous run probably left an orphan server behind`))
    })
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(PORT, '127.0.0.1')
  })
}

async function main() {
  await assertPortFree()

  if (!process.env.E2E_SKIP_BUILD) {
    buildApp()
  }
  else if (!fs.existsSync(binaryPath())) {
    throw new Error('E2E_SKIP_BUILD is set but the binary does not exist; run `bun run build` first')
  }

  resetFixture()

  const child = spawn(binaryPath(), [], {
    stdio: 'inherit',
    env: { ...process.env, FILE_LITE_DATA_BASE_DIR: dataDir },
  })

  const shutdown = () => child.kill('SIGTERM')
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  child.on('exit', (code, signal) => {
    console.log(`[e2e] server exited (code=${code}, signal=${signal})`)
    process.exit(code ?? 0)
  })
}

// 只有被当作入口执行时才启动服务；被 import 时必须保持无副作用。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[e2e] ${error.message}`)
    process.exit(1)
  })
}
