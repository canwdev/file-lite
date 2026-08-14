// Style-contract guardrail. The rules come from vgo-ui's "forbidden list"; see
// vgo-ui/docs/src/views/docs/styles.md for the full vocabulary. A non-zero violation
// count exits with code 1.
//
// Two exemption mechanisms:
//   1. FULLY_EXEMPT - skip the minimalism refactor for the whole file's style layer; see the list below.
//   2. `// vgo-allow: reason` - at the end of a line, only that line is allowed; on its own line,
//      it allows the entire following declaration (up to `;`). Multi-line background / box-shadow
//      only need one marker. A reason is required.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SRC = 'src'

// Immersive / 3D / lyric-orchestration interfaces, where the visuals are part of the product itself
const FULLY_EXEMPT = [
  'views/Apps/EndlessGallery/EndlessGallery.vue',
  'views/Apps/EndlessGallery/GalleryPanels.vue',
  'views/Apps/components/SteamCard.vue',
  'views/Apps/MediaPlayer/MusicDetail.vue',
]

// A few files allowed to be non-scoped: the global stylesheet and the root component mounted on #app
const GLOBAL_STYLE_ALLOWED = ['App.vue', 'styles/style.scss']

// `0` / `50%` / `inherit` are not arbitrary values: removing the radius, a perfect circle, inheriting from the parent
const RADIUS_OK = /border-radius:(?:\s*(?:0|50%|inherit)\s*(?:;|$)|[^;]*var\()/i

const RULES = [
  ['literal color', /#[0-9a-f]{3,8}\b|\brgba?\(\s*[\d.]/i],
  ['literal border-radius', l => /border-radius:/i.test(l) && !RADIUS_OK.test(l)],
  // The lookbehind excludes variable assignments like --el-box-shadow; zeroing overrides third-party styles, not a custom shadow
  ['custom box-shadow', /(?<![\w-])box-shadow:(?!\s*(?:none|var\(|inherit))/i],
  ['backdrop-filter', /backdrop-filter:(?!\s*none)/i],
  ['gradient background', /\b(?:linear|radial|conic)-gradient\s*\(/i],
  ['var(--el-*)', /var\(\s*--el-/],
  ['token fallback value', /var\(\s*--vgo-[\w-]+\s*,/],
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      walk(full, out)
    else if (/\.(?:vue|scss)$/.test(entry.name))
      out.push(full)
  }
  return out
}

/** Extract the style text to check, returning [{ lines, offset, scoped }]; offset is the line number of the block start in the file */
function styleBlocks(file, source) {
  if (file.endsWith('.scss'))
    return [{ lines: source.split(/\r?\n/), offset: 1, scoped: true }]

  const blocks = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    blocks.push({
      lines: m[2].split(/\r?\n/),
      offset: source.slice(0, m.index + m[0].indexOf('>') + 1).split(/\r?\n/).length,
      scoped: /\bscoped\b/.test(m[1]),
    })
  }
  return blocks
}

const files = walk(SRC).sort()
const violations = []
let styleLines = 0
let exemptLines = 0

for (const file of files) {
  const rel = file.replaceAll('\\', '/').replace(`${SRC}/`, '')
  const exempt = FULLY_EXEMPT.includes(rel)
  const source = fs.readFileSync(file, 'utf8')

  for (const block of styleBlocks(file, source)) {
    const count = block.lines.filter(l => l.trim()).length
    if (exempt) {
      exemptLines += count
      continue
    }
    styleLines += count

    if (!block.scoped && !GLOBAL_STYLE_ALLOWED.some(a => rel.endsWith(a)))
      violations.push({ file: rel, line: block.offset, rule: 'non-scoped <style>', text: '' })

    // A standalone-line vgo-allow covers the entire following declaration (up to `;`),
    // so multi-line background / box-shadow only need one marker
    let pending = false

    block.lines.forEach((line, i) => {
      const marked = /\/\/\s*vgo-allow:/.test(line)
      const isComment = line.trim().startsWith('//')
      if (isComment) {
        pending ||= marked
        return
      }
      const allowed = marked || pending
      if (pending && line.includes(';'))
        pending = false
      if (allowed)
        return
      for (const [rule, match] of RULES) {
        const hit = typeof match === 'function' ? match(line) : match.test(line)
        if (hit)
          violations.push({ file: rel, line: block.offset + i, rule, text: line.trim() })
      }
    })
  }
}

for (const v of violations)
  console.error(`${v.file}:${v.line}  ${v.rule}${v.text ? `  ${v.text}` : ''}`)

console.log(
  `\nComponent and global styles: ${styleLines} lines (${exemptLines} exempt lines not counted), ${violations.length} violation(s)`,
)

if (violations.length) {
  console.error('\nStyle-contract violation. See the full vocabulary in the vgo-ui docs "Style Overview";')
  console.error('if truly necessary, write `// vgo-allow: reason` above the line.')
  process.exit(1)
}
