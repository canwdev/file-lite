import type { IConfig, InternalConfig } from '@/config/types.ts'
import * as console from 'node:console'
import crypto from 'node:crypto'
import fs from 'node:fs'
import Path from 'node:path'
import * as process from 'node:process'
import jwt from 'jsonwebtoken'
import { getInitConfig } from '@/config/types.ts'

export function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function isExplicitDevMode() {
  return process.env.FILE_LITE_DEV_MODE === 'true' || process.env.NODE_ENV === 'development'
}

interface AuthJwtPayload {
  sub: string
  typ: string
}

const AUTH_JWT_SUBJECT = 'file-lite-user'
const AUTH_JWT_TYPE = 'access'
const AUTH_JWT_EXPIRES_IN = '365d'
const AUTH_TICKET_TTL_MS = 2 * 60 * 1000
const AUTH_TICKET_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const AUTH_TICKET_LENGTH = 8

let currentAuthTicket: { value: string, expiresAt: number } | undefined

function generateJwtSecret() {
  return crypto.randomBytes(32).toString('base64url')
}

function generatePassword() {
  return crypto.randomBytes(8).toString('hex')
}

export function createAuthJwt(jwtToken: string) {
  const payload: AuthJwtPayload = {
    sub: AUTH_JWT_SUBJECT,
    typ: AUTH_JWT_TYPE,
  }
  return jwt.sign(payload, jwtToken, { algorithm: 'HS256', expiresIn: AUTH_JWT_EXPIRES_IN })
}

export function createAuthTicket() {
  const value = generateAuthTicket()
  const expiresAt = Date.now() + AUTH_TICKET_TTL_MS
  currentAuthTicket = {
    value,
    expiresAt,
  }
  return { value, expiresAt }
}

function generateAuthTicket() {
  while (true) {
    let value = ''
    for (let i = 0; i < AUTH_TICKET_LENGTH; i++) {
      value += AUTH_TICKET_CHARS[crypto.randomInt(AUTH_TICKET_CHARS.length)]
    }
    if (!isWeakAuthTicket(value)) {
      return value
    }
  }
}

function isWeakAuthTicket(value: string) {
  const chars = [...value]
  const uniqueCount = new Set(chars).size
  const maxCharCount = Math.max(...chars.map(char => chars.filter(v => v === char).length))
  return uniqueCount < 4 || maxCharCount > 3 || /(.)\1{2}/.test(value)
}

export function consumeAuthTicket(ticket: string) {
  const authTicket = currentAuthTicket
  if (!authTicket || authTicket.value !== ticket || authTicket.expiresAt < Date.now()) {
    return ''
  }
  return createAuthJwt(internalConfig.jwtToken)
}

export function verifyAuthJwt(token: string, jwtToken: string) {
  try {
    const payload = jwt.verify(token, jwtToken, { algorithms: ['HS256'] })
    return typeof payload === 'object'
      && payload !== null
      && payload.sub === AUTH_JWT_SUBJECT
      && payload.typ === AUTH_JWT_TYPE
  }
  catch {
    return false
  }
}

export const internalConfig: InternalConfig = {
  config: undefined,
  configInitialized: false,
  configFilePath: '',
  dataBaseDir: '',
  authToken: '',
  jwtToken: '',
  safeBaseDir: '',
}

export function getFrontendStorageFilePath() {
  return Path.resolve(internalConfig.dataBaseDir, 'frontend-storage.json')
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

  const configFileExists = fs.existsSync(configFilePath)
  let config: IConfig
  if (!configFileExists) {
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
  internalConfig.configInitialized = fs.existsSync(configFilePath)

  let shouldWriteConfig = false
  if (!config.password) {
    config.password = generatePassword()
    shouldWriteConfig = configFileExists
  }

  if (configFileExists && !config.jwtToken) {
    config.jwtToken = generateJwtSecret()
    shouldWriteConfig = true
  }
  if (!config.jwtToken) {
    config.jwtToken = generateJwtSecret()
  }
  if (shouldWriteConfig) {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2))
  }

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

  internalConfig.jwtToken = config.jwtToken
  internalConfig.authToken = createAuthJwt(config.jwtToken)
  console.log(`password: Please check config file`)

  internalConfig.config = config
}
