import process from 'node:process'
import { PKG_NAME, VERSION } from '@frontend/enum/version.ts'
import { internalConfig } from '@/config/config'

export interface CliOverrides {
  port?: string
  host?: string
  dataDir?: string
  createConfig: boolean
  withTls: boolean
  noTui: boolean
  help: boolean
  version: boolean
}

export function defaultCliOverrides(): CliOverrides {
  return {
    createConfig: false,
    withTls: false,
    noTui: false,
    help: false,
    version: false,
  }
}

/** Must run before loadConfig. */
export function applyDataDirOverride(overrides: CliOverrides) {
  if (overrides.dataDir) {
    process.env.FILE_LITE_DATA_BASE_DIR = overrides.dataDir
  }
}

/** CLI flags > env > config.json. Call after loadConfig. */
export function applyCliOverrides(overrides: CliOverrides) {
  if (!internalConfig.config) {
    return
  }
  if (overrides.port !== undefined) {
    internalConfig.config.port = overrides.port
  }
  if (overrides.host !== undefined) {
    internalConfig.config.host = overrides.host
  }
}

export function printVersion() {
  console.log(`${PKG_NAME} v${VERSION}`)
}

export function printHelp() {
  console.log(`${PKG_NAME} v${VERSION}

Usage:
  file-lite [options]

Options:
  -h, --help           Show help
  -v, --version        Show version
  --no-tui             Run without interactive menu
  --create-config      Create config.json if missing and exit
  --with-tls           With --create-config: generate self-signed cert via openssl
  -p, --port <port>    Override listen port
  -H, --host <host>    Override listen host
  --data-dir <path>    Data directory (default: ./file-lite under cwd;
                       env: FILE_LITE_DATA_BASE_DIR)

Ephemeral mode (no config.json): no files are written; use printed Ticket to sign in.
`)
}
