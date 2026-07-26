import type { CliOverrides } from './options'
import { defaultCliOverrides } from './options'

export interface ParsedCli {
  overrides: CliOverrides
}

function readLongFlagValue(argv: string[], i: number, name: string): { value: string, nextIndex: number } {
  const arg = argv[i]!
  const prefix = `${name}=`
  if (arg.startsWith(prefix)) {
    return { value: arg.slice(prefix.length), nextIndex: i + 1 }
  }
  const value = argv[i + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${name}`)
  }
  return { value, nextIndex: i + 2 }
}

/** Supports `-p 3100` and `-p3100`. */
function readShortFlagValue(argv: string[], i: number, flag: string): { value: string, nextIndex: number } {
  const arg = argv[i]!
  if (arg.length > flag.length) {
    return { value: arg.slice(flag.length), nextIndex: i + 1 }
  }
  const value = argv[i + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`)
  }
  return { value, nextIndex: i + 2 }
}

export function parseArgv(argv: string[]): ParsedCli {
  const overrides = defaultCliOverrides()
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]!

    if (arg === 'help' || arg === '--help' || arg === '-h') {
      overrides.help = true
      i++
      continue
    }
    if (arg === '--version' || arg === '-v') {
      overrides.version = true
      i++
      continue
    }
    if (arg === '--no-tui') {
      overrides.noTui = true
      i++
      continue
    }
    if (arg === '--create-config') {
      overrides.createConfig = true
      i++
      continue
    }
    if (arg === '--with-tls') {
      overrides.withTls = true
      i++
      continue
    }
    if (arg === '--port' || arg.startsWith('--port=')) {
      const { value, nextIndex } = readLongFlagValue(argv, i, '--port')
      overrides.port = value
      i = nextIndex
      continue
    }
    if (arg === '-p' || (arg.startsWith('-p') && arg.length > 2)) {
      const { value, nextIndex } = readShortFlagValue(argv, i, '-p')
      overrides.port = value
      i = nextIndex
      continue
    }
    if (arg === '--host' || arg.startsWith('--host=')) {
      const { value, nextIndex } = readLongFlagValue(argv, i, '--host')
      overrides.host = value
      i = nextIndex
      continue
    }
    if (arg === '-H' || (arg.startsWith('-H') && arg.length > 2)) {
      const { value, nextIndex } = readShortFlagValue(argv, i, '-H')
      overrides.host = value
      i = nextIndex
      continue
    }
    if (arg === '--data-dir' || arg.startsWith('--data-dir=')) {
      const { value, nextIndex } = readLongFlagValue(argv, i, '--data-dir')
      overrides.dataDir = value
      i = nextIndex
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { overrides }
}
