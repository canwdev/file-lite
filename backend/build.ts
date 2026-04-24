import { spawn } from 'node:child_process'
import * as console from 'node:console'
import fs from 'node:fs/promises'
import path from 'node:path'
import { VERSION } from '../frontend/src/enum/version.ts'

async function generateStartBat(jsName = 'main.js') {
  return `@echo off
cd /d %~dp0

node .\\${jsName}
pause
`
}
async function generateStartSh(jsName = 'main.js') {
  return `#!/usr/bin/env bash
cd "$(dirname "$0")"
  
node ./${jsName}
`
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  console.log(`\n> ${command} ${args.join(' ')}`) // 使用 > 符号，更像 shell 提示符
  return new Promise((resolve, reject) => {
    spawn(command, args, { cwd, stdio: 'inherit' })
      .on('close', (code) => {
        if (code === 0) {
          resolve()
        }
        else {
          reject(new Error(`Command failed with exit code: ${code}`))
        }
      })
      .on('error', reject)
  })
}

async function runInDir(title: string, cwd: string, commands: string[]) {
  console.log(`\n--- ${title} ---`)
  for (const cmdStr of commands) {
    const [command, ...args] = cmdStr.split(' ')
    await run(command as string, args, cwd)
  }
}

async function customizePatch(distDir: string, builderPath: string) {
  // 替换 favicon（nodejs 版差异化）
  const nodejsFavicon = path.join(builderPath, 'favicon-nodejs.webp')
  const distFavicon = path.join(distDir, 'frontend/favicon.webp')
  await fs.copyFile(nodejsFavicon, distFavicon)
  console.log(`>>> Replaced favicon: ${distFavicon}`)

  // 向 index.html 注入 nodejs 版专属 CSS 变量
  const indexHtmlPath = path.join(distDir, 'frontend/index.html')
  const injectStyle = `<style>:root{--vgo-primary-rgb:76,175,80;}</style>`
  let html = await fs.readFile(indexHtmlPath, 'utf8')
  html = html.replace('</head>', `${injectStyle}</head>`)
  await fs.writeFile(indexHtmlPath, html, 'utf8')
  console.log(`>>> Injected CSS variables into: ${indexHtmlPath}`)
}

function createArchive(fromPath, distName) {
  console.log(`>>> Creating archive: ${fromPath}`)
  const distFile = path.resolve(fromPath, `../${distName}.zip`)
  return new Promise((resolve, reject) => {
    const archiver = require('archiver')
    const output = require('node:fs').createWriteStream(distFile)
    const archive = archiver('zip', {
      zlib: { level: 9 },
      forceLocalTime: true,
    })
    archive.pipe(output)
    archive.directory(fromPath, distName)
    output.on('close', (v) => {
      console.log(`>>> Archive created successfully: ${distFile}`)
      resolve(v)
    })
    archive.on('error', reject)
    archive.finalize()
  })
}

async function build() {
  const builderPath = __dirname

  const distDir = path.resolve(builderPath, './dist')
  const backendPath = path.join(builderPath)
  const frontendPath = path.join(builderPath, '../frontend')

  // 1. 清理旧的构建产物
  await fs.rm(distDir, { recursive: true, force: true })
  console.log('Cleaned dist directory.')

  await runInDir('Installing dependencies...', backendPath, ['bun i'])
  await runInDir('Code checking...', backendPath, [
    'bunx eslint src/**/*.{ts,tsx,vue} --fix',
  ])
  // 2. 构建后端
  await runInDir('Building backend...', backendPath, ['bun run build'])
  // 3. 构建前端
  await runInDir('Building frontend, please wait...', frontendPath, [
    'bun i',
    'bun run frontend:build',
  ])

  // 4. nodejs 版差异化补丁
  await customizePatch(distDir, builderPath)

  const jsName = 'file-lite.min.mjs'

  const batPath = path.join(distDir, 'file-lite.bat')
  await fs.writeFile(batPath, await generateStartBat(jsName))
  const shPath = path.join(distDir, 'file-lite.sh')
  await fs.writeFile(shPath, await generateStartSh(jsName))
  await fs.chmod(shPath, 0o755)

  console.log(`\n>>> Dist executable: ${batPath}`)

  await createArchive(distDir, `file-lite-nodejs-v${VERSION}`)

  console.log(`>>> Update package.json version: ${VERSION}`)
  const pkgPath = path.join(backendPath, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  pkg.version = VERSION
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))
}
build()
