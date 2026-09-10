// Builds the Go backend and packages it into a release zip.
//
// This is the Go replacement for the removed Node.js `backend/build.ts`. It detects the
// current platform automatically, or builds every release target with `--all`, and writes
// `file-lite-<os>_<arch>-v<version>.zip` to the repository root (the release asset name
// and layout are unchanged: the platform folder is the single top-level entry).
//
// Usage:
//   bun run scripts/build.ts --current [options]   # build the current platform
//   bun run scripts/build.ts --all [options]       # build every release target
//
// A target (`--current` or `--all`) is required; running with no arguments at all
// prints this help instead of building. Options compose:
//   --skip-frontend   reuse an existing backend-go/frontend-assets.tar.gz
//   --skip-pack       build the binaries without writing the release zips
//
// The zip writer is dependency-free on purpose (same spirit as frontend/scripts/pack-frontend.mjs),
// so packaging does not require any npm package to be installed.

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import * as console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendGoDir = path.resolve(here, '..')
const repoRoot = path.resolve(backendGoDir, '..')
const frontendDir = path.join(repoRoot, 'frontend')
const binDir = path.join(backendGoDir, 'bin')
const frontendAssets = path.join(backendGoDir, 'frontend-assets.tar.gz')

interface Target {
  /** Folder under bin/ and the name segment in the release asset. */
  dir: string
  goos: string
  goarch: string
  ext: string
}

const ALL_TARGETS: Target[] = [
  { dir: 'windows_amd64', goos: 'windows', goarch: 'amd64', ext: '.exe' },
  { dir: 'windows_arm64', goos: 'windows', goarch: 'arm64', ext: '.exe' },
  { dir: 'linux_amd64', goos: 'linux', goarch: 'amd64', ext: '' },
  { dir: 'linux_arm64', goos: 'linux', goarch: 'arm64', ext: '' },
  { dir: 'mac_amd64', goos: 'darwin', goarch: 'amd64', ext: '' },
  { dir: 'mac_arm64', goos: 'darwin', goarch: 'arm64', ext: '' },
]

const TARGET_BY_PLATFORM: Record<string, Target> = {
  'win32-x64': ALL_TARGETS[0],
  'win32-arm64': ALL_TARGETS[1],
  'linux-x64': ALL_TARGETS[2],
  'linux-arm64': ALL_TARGETS[3],
  'darwin-x64': ALL_TARGETS[4],
  'darwin-arm64': ALL_TARGETS[5],
}

function currentTarget(): Target {
  const target = TARGET_BY_PLATFORM[`${process.platform}-${process.arch}`]
  if (!target) {
    throw new Error(`unsupported platform: ${process.platform}/${process.arch}`)
  }
  return target
}

function readVersion(): string {
  const versionFile = path.join(frontendDir, 'src/enum/version.ts')
  const match = fs.readFileSync(versionFile, 'utf8').match(/export const VERSION = '([^']+)'/)
  if (!match) {
    throw new Error(`could not parse VERSION from ${versionFile}`)
  }
  return match[1]
}

function readGoVersion(): string {
  const configFile = path.join(backendGoDir, 'config/config.go')
  const match = fs.readFileSync(configFile, 'utf8').match(/const Version = "([^"]+)"/)
  if (!match) {
    throw new Error(`could not parse Version from ${configFile}`)
  }
  return match[1]
}

/** Fail fast when the two remaining version declarations drift apart. */
function assertVersionSync(): string {
  const version = readVersion()
  const goVersion = readGoVersion()
  if (version !== goVersion) {
    throw new Error(
      `version mismatch: frontend/src/enum/version.ts is "${version}" but backend-go/config/config.go is "${goVersion}"; update both before building`,
    )
  }
  return version
}

function run(command: string, args: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  console.log(`\n> ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    spawn(command, args, { cwd, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env })
      .on('close', code => (code === 0 ? resolve() : reject(new Error(`command failed with exit code ${code}: ${command} ${args.join(' ')}`))))
      .on('error', reject)
  })
}

async function buildFrontend(): Promise<void> {
  console.log('\n--- building frontend ---')
  await run('bun', ['run', 'build'], frontendDir)
}

async function buildGo(target: Target): Promise<void> {
  const outDir = path.join(binDir, target.dir)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `file-lite-go${target.ext}`)

  console.log(`\n--- building Go binary: ${target.goos}/${target.goarch} ---`)
  await run('go', ['build', '-ldflags=-s -w', '-trimpath', '-o', outFile, '.'], backendGoDir, {
    GOOS: target.goos,
    GOARCH: target.goarch,
    CGO_ENABLED: '0',
  })
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

// Fixed DOS timestamp (2024-01-01 00:00 UTC) keeps archives reproducible.
const DOS_TIME = 0
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1

interface ZipEntry {
  /** Archive path, always with forward slashes. */
  name: string
  data: Buffer
  /** Unix permission bits stored in the external attributes. */
  mode: number
}

function createZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
    local.writeUInt16LE(8, 8) // compression method: deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    localChunks.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0) // central directory header signature
    central.writeUInt16LE(0x031E, 4) // version made by: unix, 3.0
    central.writeUInt16LE(20, 6) // version needed to extract
    central.writeUInt16LE(0x0800, 8) // flags: UTF-8 names
    central.writeUInt16LE(8, 10) // compression method: deflate
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra field length
    central.writeUInt16LE(0, 32) // file comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // relative offset of local header
    centralChunks.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const centralBuffer = Buffer.concat(centralChunks)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // number of this disk
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16) // offset of central directory
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localChunks, centralBuffer, end])
}

function collectFiles(root: string, prefix = ''): { name: string, fullPath: string }[] {
  const files: { name: string, fullPath: string }[] = []
  for (const entry of fs.readdirSync(root).sort()) {
    const fullPath = path.join(root, entry)
    const name = prefix ? `${prefix}/${entry}` : entry
    if (fs.statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath, name))
    }
    else if (fs.statSync(fullPath).isFile()) {
      files.push({ name, fullPath })
    }
  }
  return files
}

function packTarget(target: Target, version: string): void {
  const dir = path.join(binDir, target.dir)
  const entries: ZipEntry[] = collectFiles(dir).map(file => ({
    // The platform folder is the single top-level entry, matching previous releases.
    name: `${target.dir}/${file.name}`,
    data: fs.readFileSync(file.fullPath),
    mode: 0o100755,
  }))
  if (entries.length === 0) {
    throw new Error(`nothing to pack in ${dir}`)
  }

  const outFile = path.join(repoRoot, `file-lite-${target.dir}-v${version}.zip`)
  fs.writeFileSync(outFile, createZip(entries))
  const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2)
  console.log(`\n>>> Packed ${outFile} (${sizeMb} MB)`)
}

function printHelp(stream: { write: (chunk: string) => unknown }): void {
  stream.write(`Build the File Lite Go backend and package it into a release zip.

Usage:
  bun run scripts/build.ts <target> [options]

Targets (exactly one is required):
  --current         Build the current platform
  --all             Build every release target

Options:
  --skip-frontend   Reuse an existing backend-go/frontend-assets.tar.gz
  --skip-pack       Build the binaries without writing the release zips
  -h, --help        Show this help

Examples:
  bun run build                                       # same as --current --skip-pack
  bun run build:all                                   # same as --all --skip-pack
  bun run scripts/build.ts --current                  # current platform incl. release zip
  bun run scripts/build.ts --all --skip-frontend
`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv.length === 0) {
    printHelp(process.stderr)
    process.exitCode = 1
    return
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp(process.stdout)
    return
  }

  const knownFlags = ['--current', '--all', '--skip-frontend', '--skip-pack']
  const unknown = argv.filter(arg => !knownFlags.includes(arg))
  if (unknown.length > 0) {
    throw new Error(`unknown option(s): ${unknown.join(', ')}`)
  }

  const all = argv.includes('--all')
  const current = argv.includes('--current')
  if (all && current) {
    throw new Error('choose one target: --current or --all')
  }
  if (!all && !current) {
    throw new Error('a target is required: --current or --all')
  }
  const skipFrontend = argv.includes('--skip-frontend')
  const skipPack = argv.includes('--skip-pack')

  const version = assertVersionSync()
  console.log(`Version: ${version}`)

  const targets = all ? ALL_TARGETS : [currentTarget()]

  if (skipFrontend) {
    if (!fs.existsSync(frontendAssets)) {
      throw new Error(`missing ${frontendAssets}; run without --skip-frontend to build the frontend first`)
    }
  }
  else {
    await buildFrontend()
  }

  for (const target of targets) {
    await buildGo(target)
    if (!skipPack) {
      packTarget(target, version)
    }
  }

  const output = skipPack ? 'binaries' : 'binaries and release zips'
  console.log(`\n>>> Build complete (${output}): ${targets.map(target => target.dir).join(', ')}`)
}

main().catch((error: unknown) => {
  console.error(`\nBuild failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
