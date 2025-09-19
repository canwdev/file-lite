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

const runCommand = ({command, args, cwd}) => {
  return new Promise((resolve, reject) => {
    console.log(`>>> Running: ${command} ${args.join(' ')}`)
    // 用nodejs执行，流式输出
    const bunProcess = spawn(command, args, {
      cwd,
    })

    bunProcess.stdout.on('data', (data) => {
      console.log(`${data}`)
    })
    bunProcess.stderr.on('data', (data) => {
      console.error(`${data}`)
    })
    bunProcess.on('close', (code) => {
      console.log(`exited with code ${code}`)
      if (code === 0) {
        resolve(code)
      } else {
        reject(`stderr: ${code}`)
      }
    })
  })
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
  const buildPath = __dirname

  const distDir = path.resolve(buildPath, '../dist')

  await fs.rm(distDir, {recursive: true})

  console.log('\n>>> Building backend...')
  await runCommand({
    command: 'bun',
    args: ['i'],
    cwd: buildPath,
  })
  await runCommand({
    command: 'bun',
    args: ['run', 'build'],
    cwd: buildPath,
  })

  console.log('\n>>> Building frontend, please wait...')
  await runCommand({
    command: 'bun',
    args: ['i'],
    cwd: path.join(buildPath, '../frontend'),
  })
  await runCommand({
    command: 'bun',
    args: ['run', 'frontend:build'],
    cwd: path.join(buildPath, '../frontend'),
  })

  const batPath = path.join(distDir, 'file-lite.bat')
  await fs.writeFile(batPath, await generateStartBat('file-lite.min.mjs'))
  const shPath = path.join(distDir, 'file-lite.sh')
  await fs.writeFile(shPath, await generateStartSh('file-lite.min.mjs'))
  await fs.chmod(shPath, 0o755)

  console.log(`\n>>> Dist executable: ${batPath}`)

  await createArchive(distDir, `file-lite-v${VERSION}`)

  console.log(`>>> Update package.json version: ${VERSION}`)
  const pkgPath = path.join(buildPath, '../package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  pkg.version = VERSION
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))
}
build()
