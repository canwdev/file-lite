import Path from 'node:path'
import * as process from 'node:process'

export const normalizePath = (p: string) => {
  return p.replace(/\\/gi, '/').replace(/\/+/gi, '/')
}

// 安全的绝对基础目录，如果访问范围超出该目录会报错，设置为空字符串不检查。
export const SAFE_ABS_BASE_DIR = 'D:' // Path.resolve(process.cwd())
