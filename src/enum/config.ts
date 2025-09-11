import Path from 'node:path'
import * as process from 'node:process'
import * as console from 'node:console'
import fs from 'fs'
import {PKG_NAME, VERSION} from '@/enum/version.ts'

console.log(`${PKG_NAME} version: ${VERSION}\n`)

export const normalizePath = (p: string) => {
  return p.replace(/\\/gi, '/').replace(/\/+/gi, '/')
}

// 数据目录
export const DATA_BASE_DIR = process.env.ENV_DATA_BASE_DIR
  ? Path.resolve(process.env.ENV_DATA_BASE_DIR)
  : Path.resolve(process.cwd(), 'data')
console.log(`DATA_BASE_DIR=${DATA_BASE_DIR}`)

fs.mkdirSync(DATA_BASE_DIR, {recursive: true})

type IConfig = {
  host: string
  port: string
  // 是否开启无密码模式，开启后将不会检查密码。
  noAuth: boolean
  // 密码，留空则每次启动随机生成
  password: string
  // 安全路径(支持绝对路径和相对路径)，如果访问范围超出该目录会报错，设置为空字符串不检查。
  safeBaseDir: string
  // 是否开启日志
  enableLog: boolean
}
const getInitConfig = (): IConfig => {
  return {
    host: '',
    port: '',
    noAuth: false,
    password: '',
    safeBaseDir: '',
    enableLog: true,
  }
}

const CONFIG_FILE = Path.resolve(DATA_BASE_DIR, 'config.json')
let config: IConfig
if (!fs.existsSync(CONFIG_FILE)) {
  const defaultConfig = getInitConfig()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2))
  config = defaultConfig
} else {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
}

// 安全的绝对路径，如果访问范围超出该目录会报错，设置为空字符串不检查。
export const SAFE_BASE_DIR = config.safeBaseDir
  ? normalizePath(Path.resolve(config.safeBaseDir))
  : ''
if (SAFE_BASE_DIR) {
  console.log(`SAFE_BASE_DIR=${SAFE_BASE_DIR}`)
}

function S4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
}

export const authToken = config.password ? config.password : S4()
console.log(`auth=${authToken}`)

export {config}
