import Path from 'path'
import {IDrive, IEntry} from '@/routes/files/types.ts'
import fs from 'fs/promises'
import {Context} from 'hono'
import mime from 'mime-types'
import nodeDiskInfo from 'node-disk-info'
import os from 'os'
import {createReadStream} from 'fs'

// 检查文件是否存在
const checkValidPath = async (path: string) => {
  if (!path) {
    return false
  }
  try {
    await fs.access(path)
    return true
  } catch (err) {
    return false
  }
}

export const getDrivers = async (c: Context) => {
  const results: IDrive[] = [
    {
      label: 'Home',
      path: os.homedir(),
    },
  ]
  const drives = await nodeDiskInfo.getDiskInfo()
  results.push(
    ...drives.map((drive) => ({
      label: drive.mounted,
      path: drive.mounted,
      free: drive.available,
      total: drive.blocks,
    })),
  )
  return c.json(results)
}

// 列出文件夹内容
export const getFiles = async (c: Context) => {
  const {path} = c.req.query()
  const valid = await checkValidPath(path || '')
  if (!valid) {
    return c.json({error: 'Path not found'}, 400)
  }
  const stats = await fs.stat(path)
  if (!stats.isDirectory()) {
    return c.json({error: 'Path is not a directory'}, 400)
  }
  const files = await fs.readdir(path)

  const results: IEntry[] = []
  for (const entryName of files) {
    const entryPath = Path.join(path, entryName)
    let stat: fs.Stats | null = null
    let error: string | null = null
    try {
      stat = await fs.stat(entryPath)
    } catch (err) {
      stat = null
      error = String(err)
    }
    const isDirectory = stat?.isDirectory() || false
    const ext = Path.extname(entryName)
    results.push({
      name: entryName,
      ext: ext,
      isDirectory,
      hidden: entryName.startsWith('.'),
      lastModified: stat?.ctimeMs || 0,
      birthtime: stat?.birthtimeMs || 0,
      size: isDirectory ? null : stat?.size,
      error,
      // stat,
      // mimeType: isDirectory ? null : mime.contentType(ext) || '',
    })
  }
  return c.json(results)
}

export const getFileStream = async (c: Context) => {
  const {path} = c.req.query()
  const valid = await checkValidPath(path || '')
  if (!valid) {
    return c.json({error: 'Path not found'}, 400)
  }
  const stats = await fs.stat(path)
  if (!stats.isFile()) {
    return c.json({error: 'Path is not a file'}, 400)
  }
  // 对比express和nest是否支持分片请求
  const stream = createReadStream(path)

  const mimeType = mime.contentType(Path.extname(path)) || ''
  // Set the correct header so the browser knows what to expect.
  c.header('Content-Type', mimeType)
  c.header('Content-Length', stats.size.toString())
  c.header('Accept-Ranges', 'bytes')
  c.header('Last-Modified', stats.mtime.toUTCString())
  c.header('ETag', `"${stats.size}-${stats.mtime.getTime()}"`)
  // c.header('Cache-Control', 'public, max-age=31536000')
  c.header('Content-Disposition', `attachment; filename="${encodeURI(Path.basename(path))}"`)
  c.header('Content-Transfer-Encoding', 'binary')
  c.header('Connection', 'keep-alive')
  c.header('Pragma', 'public')

  // Hono's adapter for Node.js will pipe the Node.js Readable stream
  // into the HTTP response.
  return c.body(stream)
}
