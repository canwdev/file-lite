// README 截图用的免费示例素材：从公开素材站下载到 e2e/.samples 缓存，不提交进仓库。
//
// 下载慢（素材站带宽一般），所以每份素材第一次下载后就留在 .samples/ 里复用；
// `--refresh` 才会重新拉取。带封面与歌词的 mp3 由本机 ffmpeg 合成：
// ffmpeg 写不了真正的 USLT（歌词）帧，只会写 TXXX:USLT，播放器读不到，
// 所以合完之后再手工往 ID3v2.3 tag 里插一个 USLT 帧。
import { execFileSync } from 'node:child_process'
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 这些素材站的 AAAA 记录在本机（WSL）不通，Node 默认会先试 IPv6 然后超时；
// curl 有 happy-eyeballs 所以看起来正常，Node 必须先要求 IPv4。
dns.setDefaultResultOrder('ipv4first')

const here = path.dirname(fileURLToPath(import.meta.url))
export const samplesDir = path.resolve(here, '..', '.samples')

const IMAGE_DIR = path.join(samplesDir, 'images')
const COVER_DIR = path.join(samplesDir, 'covers')
const AUDIO_DIR = path.join(samplesDir, 'audio')
const VIDEO_DIR = path.join(samplesDir, 'videos')
const MUSIC_DIR = path.join(samplesDir, 'music')

/** 图片素材：picsum 的 seed 固定，同一 seed 每次返回同一张图，截图可复现。 */
export const demoImages = [
  { file: 'Aurora over the lake.jpg', seed: 'file-lite-aurora' },
  { file: 'Mountain trail.jpg', seed: 'file-lite-trail' },
  { file: 'Autumn forest.jpg', seed: 'file-lite-forest' },
  { file: 'Blue hour skyline.jpg', seed: 'file-lite-skyline' },
  { file: 'Desert dunes.jpg', seed: 'file-lite-dunes' },
  { file: 'Harbour at dusk.jpg', seed: 'file-lite-harbour' },
  { file: 'Snowy peaks.jpg', seed: 'file-lite-peaks' },
  { file: 'City lights.jpg', seed: 'file-lite-city' },
  { file: 'River valley.jpg', seed: 'file-lite-valley' },
  { file: 'Sunflower field.jpg', seed: 'file-lite-sunflower' },
]

/** 视频素材：test-videos.co.uk 的 1MB 片段。 */
export const demoVideos = [
  {
    file: 'Big Buck Bunny.mp4',
    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  },
  {
    file: 'Sintel trailer.mp4',
    url: 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
  },
]

/** 音频素材：samplelib 的 mp3 片段；每首歌配一张 picsum 封面与一段 LRC 歌词。 */
export const demoMusic = [
  {
    file: 'Borealis.mp3',
    source: 'sample-9s.mp3',
    title: 'Borealis',
    artist: 'Vexento',
    album: 'Northern Skies',
    cover: 'file-lite-cover-aurora',
    lyrics: [
      'Under a sky that never sleeps',
      'The river carries what it keeps',
      'Cold light is drawing lines above',
      'A quiet map of where we move',
      'Hold the dark a little longer',
      'Every star is getting closer',
    ],
  },
  {
    file: 'Morning Light.mp3',
    source: 'sample-6s.mp3',
    title: 'Morning Light',
    artist: 'Kai Engel',
    album: 'Daybreak EP',
    cover: 'file-lite-cover-morning',
    lyrics: [
      'Curtains turn to gold',
      'The kettle starts to sing',
      'A whole day still untold',
      'And nothing is rushing',
    ],
  },
  {
    file: 'Night Drive.mp3',
    source: 'sample-12s.mp3',
    title: 'Night Drive',
    artist: 'Jesse Gallagher',
    album: 'Midnight City',
    cover: 'file-lite-cover-night',
    lyrics: [
      'Headlights on an empty lane',
      'The radio is half asleep',
      'Street signs blur into the rain',
      'And the city keeps its secrets',
      'Drive until the morning comes',
    ],
  },
  {
    file: 'Ocean Waves.mp3',
    source: 'sample-15s.mp3',
    title: 'Ocean Waves',
    artist: 'Aakash Gandhi',
    album: 'Ambient Shores',
    cover: 'file-lite-cover-ocean',
    lyrics: [
      'Salt air and a slow tide',
      'Footprints that the water hides',
      'Nothing here is in a hurry',
      'Let the shoreline do the worrying',
    ],
  },
]

const AUDIO_SOURCES = [...new Set(demoMusic.map(m => m.source))]

/** 文件大小（字节）；不存在返回 0。 */
function sizeOf(file) {
  try {
    return fs.statSync(file).size
  }
  catch {
    return 0
  }
}

async function fetchToFile(url, dest, { refresh, log }) {
  if (!refresh && sizeOf(dest) > 0) {
    return false
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0) {
        throw new Error('empty response')
      }
      fs.writeFileSync(dest, buffer)
      log(`  ↓ ${path.basename(dest)} (${(buffer.length / 1024).toFixed(0)} KB)`)
      return true
    }
    catch (error) {
      lastError = error
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }
  throw new Error(`failed to download ${url}: ${lastError?.message ?? 'unknown error'}`)
}

// ── ID3v2.3：往 ffmpeg 生成的 tag 里插入真正的 USLT（歌词）帧 ────────────

function readSyncsafe(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f)
}

function writeSyncsafe(value) {
  return Buffer.from([
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ])
}

function parseFrames(tag) {
  const frames = []
  let offset = 0
  while (offset + 10 <= tag.length) {
    const id = tag.toString('latin1', offset, offset + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      break
    }
    const size = tag.readUInt32BE(offset + 4)
    frames.push({ id, body: tag.subarray(offset + 10, offset + 10 + size) })
    offset += 10 + size
  }
  return frames
}

function frame(id, body) {
  const header = Buffer.alloc(10)
  header.write(id, 0, 'latin1')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

/** USLT 帧体：编码 + 语言 + 空描述 + 歌词正文（ASCII 歌词用 latin1 就够）。 */
function usltFrame(lyrics) {
  return frame('USLT', Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('eng', 'latin1'),
    Buffer.from([0x00]),
    Buffer.from(lyrics, 'latin1'),
  ]))
}

/** 用 ffmpeg 的 tag 内容重建一份带 USLT 的 ID3v2.3 tag；返回音频帧起点。 */
function injectLyrics(file, lyrics) {
  const buffer = fs.readFileSync(file)
  if (buffer.subarray(0, 3).toString('latin1') !== 'ID3') {
    throw new Error(`${file} has no ID3 tag to patch`)
  }
  const tagSize = readSyncsafe(buffer, 6)
  const frames = parseFrames(buffer.subarray(10, 10 + tagSize))
    .filter(f => f.id !== 'USLT' && f.id !== 'TXXX')
  const tag = Buffer.concat([...frames.map(f => frame(f.id, f.body)), usltFrame(lyrics)])
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), writeSyncsafe(tag.length)])
  fs.writeFileSync(file, Buffer.concat([header, tag, buffer.subarray(10 + tagSize)]))
}

/** 把若干句歌词均匀铺在整首歌上，生成 LRC 文本。 */
function buildLrc(lines, durationSeconds) {
  const step = durationSeconds / (lines.length + 1)
  return lines
    .map((text, index) => {
      const total = step * (index + 1)
      const mm = String(Math.floor(total / 60)).padStart(2, '0')
      const ss = String(Math.floor(total % 60)).padStart(2, '0')
      const xx = String(Math.floor((total % 1) * 100)).padStart(2, '0')
      return `[${mm}:${ss}.${xx}]${text}`
    })
    .join('\n')
}

/** ffmpeg 是否可用；没有它就没有视频封面与带封面的 mp3。 */
export function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

function synthesizeMusic(track, { refresh, log }) {
  const dest = path.join(MUSIC_DIR, track.file)
  if (!refresh && sizeOf(dest) > 0) {
    return false
  }
  fs.mkdirSync(MUSIC_DIR, { recursive: true })
  const base = path.join(AUDIO_DIR, track.source)
  const cover = path.join(COVER_DIR, `${track.cover}.jpg`)
  const duration = Number.parseInt(track.source.match(/-(\d+)s/)?.[1] ?? '10', 10)
  const lrc = buildLrc(track.lyrics, duration)

  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-i', base,
    '-i', cover,
    '-map', '0:a', '-map', '1:v',
    '-c:a', 'copy', '-c:v', 'copy',
    '-id3v2_version', '3',
    '-metadata', `title=${track.title}`,
    '-metadata', `artist=${track.artist}`,
    '-metadata', `album=${track.album}`,
    '-metadata:s:v', 'title=Album cover',
    '-metadata:s:v', 'comment=Cover (front)',
    '-disposition:v', 'attached_pic',
    dest,
  ], { stdio: 'inherit' })

  injectLyrics(dest, lrc)
  log(`  ♪ ${track.file} (cover + lyrics)`)
  return true
}

/**
 * 保证所有素材都在 .samples/ 里。已存在的直接复用；`refresh` 为 true 时重新下载。
 * 返回实际下载/生成的文件数，方便调用方打日志。
 */
export async function ensureSamples({ refresh = false, log = console.log } = {}) {
  fs.mkdirSync(samplesDir, { recursive: true })
  let changed = 0

  log(`[docs] samples in ${samplesDir}`)
  log('[docs] images (picsum.photos)')
  for (const image of demoImages) {
    if (await fetchToFile(`https://picsum.photos/seed/${image.seed}/1600/1000`, path.join(IMAGE_DIR, `${image.seed}.jpg`), { refresh, log })) {
      changed++
    }
  }

  log('[docs] audio (download.samplelib.com)')
  for (const source of AUDIO_SOURCES) {
    if (await fetchToFile(`https://download.samplelib.com/mp3/${source}`, path.join(AUDIO_DIR, source), { refresh, log })) {
      changed++
    }
  }

  log('[docs] videos (test-videos.co.uk)')
  for (const video of demoVideos) {
    if (await fetchToFile(video.url, path.join(VIDEO_DIR, video.file), { refresh, log })) {
      changed++
    }
  }

  log('[docs] covers (picsum.photos)')
  for (const track of demoMusic) {
    if (await fetchToFile(`https://picsum.photos/seed/${track.cover}/700/700`, path.join(COVER_DIR, `${track.cover}.jpg`), { refresh, log })) {
      changed++
    }
  }

  if (!hasFfmpeg()) {
    log('[docs] ffmpeg not found: music keeps no cover or lyrics, video thumbnails will be missing')
    return changed
  }

  log('[docs] music (ffmpeg: embedded cover + lyrics)')
  for (const track of demoMusic) {
    if (synthesizeMusic(track, { refresh, log })) {
      changed++
    }
  }
  return changed
}

/** 素材在缓存里的路径，供 docs-fixture.mjs 拷贝。 */
export const samplePaths = {
  image: image => path.join(IMAGE_DIR, `${image.seed}.jpg`),
  video: video => path.join(VIDEO_DIR, video.file),
  music: track => path.join(MUSIC_DIR, track.file),
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSamples({ refresh: process.argv.includes('--refresh') })
    .then((changed) => {
      console.log(`[docs] samples ready (${changed} file(s) fetched)`)
    })
    .catch((error) => {
      console.error(`[docs] ${error.message}`)
      process.exit(1)
    })
}
