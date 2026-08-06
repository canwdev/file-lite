// 样式契约护栏。规则来自 vgo-ui 的「禁止清单」，完整词汇表见
// vgo-ui/docs/src/views/docs/styles.md。违规不为零则退出码为 1。
//
// 两种豁免方式：
//   1. FULLY_EXEMPT —— 整个文件的氛围层不做极简化改造，见下方名单。
//   2. `// vgo-allow: 理由` —— 写在行尾只放行该行；独占一行则放行其后整条声明
//      （到 `;` 为止），多行的 background / box-shadow 只需标一次。理由必须写。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SRC = 'src'

// 沉浸式 / 3D / 歌词编排界面，视觉本身就是产品的一部分
const FULLY_EXEMPT = [
  'views/Apps/EndlessGallery/EndlessGallery.vue',
  'views/Apps/EndlessGallery/GalleryPanels.vue',
  'views/Apps/components/SteamCard.vue',
  'views/Apps/MediaPlayer/MusicDetail.vue',
]

// 允许非 scoped 的少数文件：全局样式表，以及挂在 #app 上的根组件
const GLOBAL_STYLE_ALLOWED = ['App.vue', 'styles/style.scss']

// `0` / `50%` / `inherit` 不算随意取值：取消圆角、正圆、继承父级
const RADIUS_OK = /border-radius:(?:\s*(?:0|50%|inherit)\s*(?:;|$)|[^;]*var\()/i

const RULES = [
  ['字面量颜色', /#[0-9a-f]{3,8}\b|\brgba?\(\s*[\d.]/i],
  ['字面量 border-radius', l => /border-radius:/i.test(l) && !RADIUS_OK.test(l)],
  // 前置断言排开 --el-box-shadow 这类变量赋值；置零是覆盖第三方样式，不是自定义阴影
  ['自定义 box-shadow', /(?<![\w-])box-shadow:(?!\s*(?:none|var\(|inherit))/i],
  ['backdrop-filter', /backdrop-filter:(?!\s*none)/i],
  ['渐变背景', /\b(?:linear|radial|conic)-gradient\s*\(/i],
  ['var(--el-*)', /var\(\s*--el-/],
  ['token 兜底值', /var\(\s*--vgo-[\w-]+\s*,/],
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

/** 取出待检查的样式文本，返回 [{ lines, offset, scoped }]，offset 为块首在文件中的行号 */
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
      violations.push({ file: rel, line: block.offset, rule: '非 scoped <style>', text: '' })

    // 独占一行的 vgo-allow 覆盖其后整条声明（到 `;` 为止），
    // 这样多行的 background / box-shadow 只需要标一次
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
  `\n组件与全局样式 ${styleLines} 行（豁免 ${exemptLines} 行未计），违规 ${violations.length} 处`,
)

if (violations.length) {
  console.error('\n样式契约违规。完整词汇表见 vgo-ui 文档站「样式总览」；')
  console.error('确有必要时在该行上方写 `// vgo-allow: 理由`。')
  process.exit(1)
}
