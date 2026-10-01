// Node capability guardrail. `vite`, i.e. Vite 8 with rolldown, runs on Node: rolldown
// renders its option-schema descriptions with `util.styleText(['underline', 'gray'], ...)`,
// so a Node whose `styleText` cannot take a two-format array dies inside rolldown with a
// bare ERR_INVALID_ARG_VALUE before it reads any project file. That support exists in
// ^20.19.0 || >=22.12.0 (the range in package.json engines): the odd-numbered 21.x accepts
// an array of one format but throws on the pair below, which is why the probe passes two.
//
// The capability is probed rather than the version parsed, so the message stays true when
// the engines range moves. Exit code 1 stops `bun run build` before `vite build` starts.
import process from 'node:process'
import * as util from 'node:util'

const REQUIRED = '^20.19.0 || >=22.12.0'
const PROBE_FORMATS = ['underline', 'gray'] // the pair rolldown hands to styleText

function canStyleTextArray() {
  if (typeof util.styleText !== 'function')
    return false
  try {
    util.styleText(PROBE_FORMATS, 'probe')
    return true
  }
  catch {
    return false
  }
}

if (!canStyleTextArray()) {
  console.error(`check-node: ${process.version} is too old for the frontend build.`)
  console.error(`check-node: vite/rolldown pass an array of formats to util.styleText(), so this project needs Node ${REQUIRED}.`)
  console.error('check-node: install the latest Node 22 LTS or 24 LTS, then run the build again.')
  process.exit(1)
}
