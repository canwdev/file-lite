// Packs the Go-mode frontend build (../backend-go/frontend) into a single
// deterministic gzip-compressed tar archive (../backend-go/frontend-assets.tar.gz)
// that the Go binary embeds instead of the raw files (~1.7 MB -> ~0.5 MB).
//
// Run automatically by `bun run build:for-go` after `vite build --mode go`.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', '..', 'backend-go', 'frontend')
const outFile = join(here, '..', '..', 'backend-go', 'frontend-assets.tar.gz')

const MTIME = Math.floor(Date.UTC(2024, 0, 1) / 1000) // fixed mtime -> reproducible archive

/** Recursively collect { name, path } for every file under dir. */
function collect(dir, prefix = '') {
  const entries = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    const st = statSync(full)
    if (st.isDirectory()) {
      entries.push(...collect(full, rel))
    }
    else if (st.isFile()) {
      entries.push({ name: rel, path: full })
    }
  }
  return entries
}

function writeOctal(buf, offset, len, value) {
  const digits = value.toString(8).padStart(len - 1, '0')
  buf.write(digits, offset, len - 1, 'ascii')
  buf[offset + len - 1] = 0 // NUL terminator
}

/** Builds one 512-byte USTAR header for a regular file. */
function tarHeader(name, size) {
  if (Buffer.byteLength(name, 'utf8') > 100) {
    throw new Error(`tar path too long (>100 bytes): ${name}`)
  }
  const buf = Buffer.alloc(512)
  buf.write(name, 0, 100, 'utf8')
  writeOctal(buf, 100, 8, 0o100644) // mode
  writeOctal(buf, 108, 8, 0) // uid
  writeOctal(buf, 116, 8, 0) // gid
  writeOctal(buf, 124, 12, size)
  writeOctal(buf, 136, 12, MTIME)
  buf.fill(0x20, 148, 156) // checksum placeholder (spaces)
  buf[156] = 0x30 // typeflag '0' (regular file)
  buf.write('ustar\0', 257, 6, 'ascii') // magic
  buf.write('00', 263, 2, 'ascii') // version
  let sum = 0
  for (let i = 0; i < 512; i++)
    sum += buf[i]
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return buf
}

const files = collect(srcDir)
if (files.length === 0) {
  console.error(`pack-frontend: nothing to pack in ${srcDir}; run "vite build --mode go" first`)
  process.exit(1)
}

const blocks = []
let rawSize = 0
for (const f of files) {
  const data = readFileSync(f.path)
  rawSize += data.length
  blocks.push(tarHeader(f.name, data.length), data)
  const pad = (512 - (data.length % 512)) % 512
  if (pad)
    blocks.push(Buffer.alloc(pad))
}
blocks.push(Buffer.alloc(1024)) // two zero blocks mark end of archive

const archive = Buffer.concat(blocks)
const gz = gzipSync(archive, { level: 9 })
writeFileSync(outFile, gz)
console.log(
  `pack-frontend: ${files.length} files, ${(rawSize / 1024).toFixed(1)} KB -> ${(gz.length / 1024).toFixed(1)} KB gzip (${outFile})`,
)
