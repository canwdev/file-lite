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
  fs.writeFileSync(path.join(filesDir, 'source', 'nested', 'deep.txt'), 'deep')

  // target 里预置同名文件：复制/上传的冲突用例依赖它
  fs.writeFileSync(path.join(filesDir, 'target', 'a.txt'), 'existing-alpha')
  fs.mkdirSync(path.join(filesDir, 'target', 'nested'), { recursive: true })

  // 上传用的本地文件（其中 a.txt 与服务端目标同名，触发冲突）
  fs.mkdirSync(uploadDir, { recursive: true })
  fs.writeFileSync(path.join(uploadDir, 'a.txt'), 'uploaded-alpha')
  fs.writeFileSync(path.join(uploadDir, 'fresh.txt'), 'fresh-upload')

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    host: '127.0.0.1',
    port: String(PORT),
    password: PASSWORD,
    safeBaseDir: filesDir,
    enableLog: false,
    // 保持默认值（开启），让「中断不留半个文件」的保证在测试里也生效
    copyFsync: true,
  }, null, 2))
}
