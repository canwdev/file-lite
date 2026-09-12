// 构建被测应用：前端产物 → 打包成 Go 内嵌的 tar.gz → 编译后端二进制。
//
// 之所以要「先 bun run build 再 go build」，是因为后端用 go:embed 把
// frontend-assets.tar.gz 编进二进制（backend-go/main.go），
// 只跑 vite build 不会更新那个 tar.gz，浏览器拿到的还是旧前端。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '..', '..')
export const workDir = path.resolve(here, '..', '.file-lite-e2e')

export function binaryPath() {
  return path.join(workDir, process.platform === 'win32' ? 'file-lite-go.exe' : 'file-lite-go')
}

export function buildApp() {
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(path.join(workDir, 'tmp'), { recursive: true })
  fs.mkdirSync(path.join(workDir, 'gocache'), { recursive: true })

  console.log('[e2e] building frontend (vite build + pack)...')
  execFileSync('bun', ['run', 'build'], {
    cwd: path.join(repoRoot, 'frontend'),
    stdio: 'inherit',
    env: { ...process.env, TMPDIR: process.env.TMPDIR || path.join(workDir, 'tmp') },
  })

  const out = binaryPath()
  console.log('[e2e] compiling backend with the embedded frontend...')
  execFileSync('go', ['build', '-o', out, '.'], {
    cwd: path.join(repoRoot, 'backend-go'),
    stdio: 'inherit',
    env: {
      ...process.env,
      GOCACHE: process.env.GOCACHE || path.join(workDir, 'gocache'),
      GOTMPDIR: process.env.GOTMPDIR || path.join(workDir, 'tmp'),
    },
  })
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildApp()
  console.log('[e2e] built:', binaryPath())
}
