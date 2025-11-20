import type { IConfig, InternalConfig } from '@/config/types.ts'
import * as console from 'node:console'
import fs from 'node:fs'
import Path from 'node:path'
import * as process from 'node:process'
import { getInitConfig } from '@/config/types.ts'

export function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function S4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
}

export const internalConfig: InternalConfig = {
  config: undefined,
  configInitialized: false,
  configFilePath: '',
  dataBaseDir: '',
  authToken: '',
  safeBaseDir: '',
}

export function loadConfig({ allowCreate = false }: { allowCreate?: boolean } = {}) {
  // 数据目录
  const DATA_BASE_DIR = process.env.ENV_DATA_BASE_DIR
    ? Path.resolve(process.env.ENV_DATA_BASE_DIR)
    : Path.resolve(process.cwd(), 'file-lite')
  console.log(`DATA_BASE_DIR: ${DATA_BASE_DIR}`)

  if (allowCreate) {
    fs.mkdirSync(DATA_BASE_DIR, { recursive: true })
  }

  internalConfig.dataBaseDir = DATA_BASE_DIR

  const configFilePath = Path.resolve(DATA_BASE_DIR, 'config.json')

  let config: IConfig
  if (!fs.existsSync(configFilePath)) {
    const defaultConfig = getInitConfig()
    if (allowCreate) {
      fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2))
    }
    config = defaultConfig
  }
  else {
    config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'))
  }
  internalConfig.configFilePath = configFilePath

  const safeBaseDir = config.safeBaseDir
    ? normalizePath(Path.resolve(config.safeBaseDir))
    : ''
  if (safeBaseDir) {
    if (allowCreate) {
      if (!fs.existsSync(safeBaseDir)) {
        fs.mkdirSync(safeBaseDir, { recursive: true })
      }
    }
    internalConfig.safeBaseDir = safeBaseDir
    console.log(`safeBaseDir: ${safeBaseDir}`)
  }

  internalConfig.authToken = config.password ? config.password : S4() + S4()
  console.log(`password: ${internalConfig.authToken}`)

  internalConfig.config = config

  internalConfig.configInitialized = fs.existsSync(configFilePath)
}
