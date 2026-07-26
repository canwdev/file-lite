import type { StartServerResult } from '@/app/server'
import type { CmdCtx } from '@/cli/commands'
import fs from 'node:fs'
import process from 'node:process'
import { isServerRunning, startServer, stopServer } from '@/app/server'
import { applyCliOverrides, applyDataDirOverride, printHelp, printVersion } from '@/cli/options'
import { parseArgv } from '@/cli/parse'
import { runTui } from '@/cli/tui'
import { internalConfig, loadConfig } from '@/config/config'
import { ensureSelfSignedTls } from '@/utils/self-signed-tls'

async function bootServer(createConfig: boolean, overrides: ReturnType<typeof parseArgv>['overrides']) {
  applyDataDirOverride(overrides)
  loadConfig({ allowCreate: createConfig })
  applyCliOverrides(overrides)
  return await startServer()
}

function createConfigAndExit(overrides: ReturnType<typeof parseArgv>['overrides']) {
  if (overrides.withTls && !overrides.createConfig) {
    throw new Error('--with-tls requires --create-config')
  }
  applyDataDirOverride(overrides)
  loadConfig({ allowCreate: true })
  if (overrides.withTls) {
    const { key, cert, generated } = ensureSelfSignedTls(internalConfig.dataBaseDir)
    if (!internalConfig.config) {
      throw new Error('config not loaded')
    }
    internalConfig.config.sslKey = key
    internalConfig.config.sslCert = cert
    fs.writeFileSync(internalConfig.configFilePath, JSON.stringify(internalConfig.config, null, 2))
    const label = generated ? 'tls cert written' : 'tls cert exists'
    console.log(`${label}: ${key}, ${cert}`)
  }
  console.log(`config written: ${internalConfig.configFilePath}`)
  process.exit(0)
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      resolve()
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })
}

async function main() {
  let parsed
  try {
    parsed = parseArgv(process.argv.slice(2))
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error('Try \'file-lite --help\' for more information.')
    process.exit(2)
  }

  if (parsed.overrides.version) {
    printVersion()
    process.exit(0)
  }

  if (parsed.overrides.help) {
    printHelp()
    process.exit(0)
  }

  const { overrides } = parsed
  if (overrides.withTls && !overrides.createConfig) {
    console.error('--with-tls requires --create-config')
    console.error('Try \'file-lite --help\' for more information.')
    process.exit(2)
  }
  if (overrides.createConfig) {
    try {
      createConfigAndExit(overrides)
    }
    catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }

  let serverResult: StartServerResult | undefined
  let exited = false

  const ensureStarted = async () => {
    if (!isServerRunning()) {
      serverResult = await bootServer(false, overrides)
    }
  }

  const ctx = (): CmdCtx => ({
    serverResult,
    async createConfigAndReload() {
      await stopServer()
      serverResult = undefined
      serverResult = await bootServer(true, overrides)
    },
    async reload() {
      await stopServer()
      serverResult = undefined
      serverResult = await bootServer(false, overrides)
    },
    async exit() {
      await stopServer()
      serverResult = undefined
      exited = true
    },
  })

  try {
    await ensureStarted()
  }
  catch (error) {
    console.error(error)
    process.exit(1)
  }

  const useTui = process.stdin.isTTY && !overrides.noTui
  if (useTui) {
    await runTui(ctx, () => !exited)
  }
  else {
    await waitForSignal()
    await stopServer()
  }

  process.exit(0)
}

main()
