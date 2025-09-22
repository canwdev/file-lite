import path from 'path'
import fs from 'fs/promises'
import {spawn} from 'child_process'
import * as console from 'node:console'
import {VERSION} from '../src/enum/version.ts'

const generateStartBat = async (jsName = 'main.js') => {
  return `@echo off
cd /d %~dp0

node .\\${jsName}
pause
`
}
const generateStartSh = async (jsName = 'main.js') => {
  return `#!/usr/bin/env bash
cd "$(dirname "$0")"

node ./${jsName}
`
}

const run = (command: string, args: string[], cwd: string): Promise<void> => {
  console.log(`\n> ${command} ${args.join(' ')}`) // 使用 > 符号，更像 shell 提示符
  return new Promise((resolve, reject) => {
    spawn(command, args, {cwd, stdio: 'inherit'})
      .on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Command failed with exit code: ${code}`))
        }
      })
      .on('error', reject)
  })
}

const runInDir = async (title: string, cwd: string, commands: string[]) => {
  console.log(`\n--- ${title} ---`)
  for (const cmdStr of commands) {
    const [command, ...args] = cmdStr.split(' ')
    await run(command as string, args, cwd)
  }
}

const createArchive = (fromPath, distName) => {
  console.log(`>>> Creating archive: ${fromPath}`)
  const distFile = path.resolve(fromPath, `../${distName}.zip`)
  return new Promise((resolve, reject) => {
    const archiver = require('archiver')
    const output = require('fs').createWriteStream(distFile)
    const archive = archiver('zip', {
      zlib: {level: 9},
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

const build = async () => {
  const builderPath = __dirname

  const distDir = path.resolve(builderPath, '../dist')
  const backendPath = path.join(builderPath, '../')
  const frontendPath = path.join(builderPath, '../frontend')

  // 1. 清理旧的构建产物
  await fs.rm(distDir, {recursive: true, force: true})
  console.log('Cleaned dist directory.')

  // 2. 构建后端
  await runInDir('Building backend...', backendPath, ['bun i', 'bun run build'])
  // 3. 构建前端
  await runInDir('Building frontend, please wait...', frontendPath, [
    'bun i',
    'bun run frontend:build',
  ])

  const batPath = path.join(distDir, 'file-lite.bat')
  await fs.writeFile(batPath, await generateStartBat('file-lite.min.mjs'))
  const shPath = path.join(distDir, 'file-lite.sh')
  await fs.writeFile(shPath, await generateStartSh('file-lite.min.mjs'))
  await fs.chmod(shPath, 0o755)

  console.log(`\n>>> Dist executable: ${batPath}`)

  await createArchive(distDir, `file-lite-v${VERSION}`)

  console.log(`>>> Update package.json version: ${VERSION}`)
  const pkgPath = path.join(builderPath, '../package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  pkg.version = VERSION
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))
}
build()
