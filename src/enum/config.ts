import Path from 'node:path'
import * as process from 'node:process'
import * as console from 'node:console'

export const normalizePath = (p: string) => {
  return p.replace(/\\/gi, '/').replace(/\/+/gi, '/')
}

// 安全的绝对基础目录，如果访问范围超出该目录会报错，设置为空字符串不检查。
export const SAFE_BASE_DIR = process.env.ENV_SAFE_BASE_DIR
  ? Path.resolve(process.env.ENV_SAFE_BASE_DIR)
  : ''
console.log(`SAFE_BASE_DIR=${SAFE_BASE_DIR}`)

// 数据基础目录
export const DATA_BASE_DIR = process.env.ENV_DATA_BASE_DIR
  ? Path.resolve(process.env.ENV_DATA_BASE_DIR)
  : Path.resolve(process.cwd(), 'data')
console.log(`DATA_BASE_DIR=${DATA_BASE_DIR}`)
