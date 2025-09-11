import Path from 'node:path'
import * as process from 'node:process'
import * as console from 'node:console'
import fs from 'fs'
import {PKG_NAME, VERSION} from '@/enum/version.ts'

type IConfig = {
  // 监听地址，如果传入 127.0.0.1 则不允许外部设备访问，默认 '0.0.0.0'
  host: string
  // 监听端口，默认 '3100'
  port: string
  // 是否开启无密码模式，开启后将不会检查密码。默认 false
  noAuth: boolean
  // 密码，留空则每次启动随机生成。默认 ''
  password: string
  // 安全路径(支持绝对路径和相对路径)，如果访问范围超出该目录会报错，设置为空字符串不检查。默认 ''
  safeBaseDir: string
  // 是否开启日志。默认 true
  enableLog: boolean
  // 传入以下两个参数来开启https
  // 生成证书(Windows 可以用 git bash 生成)：openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem
  sslKey: string
  sslCert: string
}

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

const getInitConfig = (): IConfig => {
  return {
    host: '',
    port: '',
    noAuth: false,
    password: '',
    safeBaseDir: '',
    enableLog: true,
    sslKey: '',
    sslCert: '',
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
export const SAFE_BASE_DIR = config.safeBaseDir ? Path.resolve(config.safeBaseDir) : ''
if (SAFE_BASE_DIR) {
  console.log(`SAFE_BASE_DIR=${SAFE_BASE_DIR}`)
}

function S4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
}

export const authToken = config.password ? config.password : S4()
console.log(`auth=${authToken}`)

export {config}
