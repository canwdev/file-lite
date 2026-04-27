import type { IDrive, IEntry } from '@frontend/types/server.ts'
import type { Request, Response } from 'express'
import type { Dirent, Stats } from 'node:fs'
import { Buffer } from 'node:buffer'
import * as console from 'node:console'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import * as process from 'node:process'
import Archiver from 'archiver'
import multer from 'multer'
import nodeDiskInfo from 'node-disk-info'
import { internalConfig, normalizePath } from '@/config/config.ts'
import { getWindowsDrives } from '@/utils/get-drives.ts'
import { sanitize, sanitizeAttachmentFilename } from '@/utils/sanitize-filename.ts'

const READ_DIR_STAT_CONCURRENCY = 64

/**
 * 安全检查：确保访问路径不超出基础目录
 * @param path - 待检查的路径
 * @returns 是否安全
 */
function isPathSafe(path: string): boolean {
  // 处理空路径
  if (!path) {
    return false
  }
  // 如果未配置安全基础目录，则默认所有路径都安全
  if (!internalConfig.safeBaseDir) {
    return true
  }
  const safeBaseDir = Path.resolve(internalConfig.safeBaseDir)
  const resolvedPath = Path.resolve(path)
  const relativePath = Path.relative(safeBaseDir, resolvedPath)
  const isSafe = relativePath === '' || (!relativePath.startsWith('..') && !Path.isAbsolute(relativePath))
  if (!isSafe) {
    console.error('unsafe', { resolvedPath: normalizePath(resolvedPath), safeBaseDir: normalizePath(safeBaseDir) })
  }
  return isSafe
}

function sanitizeUploadFilename(originalName: string): string {
  const decodedName = Buffer.from(originalName, 'latin1').toString('utf8')
  if (
    !decodedName
    || decodedName !== Path.basename(decodedName)
    || decodedName.includes('..')
    || decodedName.includes('/')
    || decodedName.includes('\\')
  ) {
    throw new Error('Invalid filename')
  }
  const safeName = sanitize(decodedName)
  if (!safeName) {
    throw new Error('Invalid filename')
  }
  return safeName
}

/**
 * 检查路径是否存在
 * @param path - 待检查的路径
 * @returns 路径是否存在
 */
async function isExist(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  }
  catch {
    return false
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) {
        break
      }

      results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

function createEntryFromStat(entryName: string, stat: Stats): IEntry {
  const isDirectory = stat.isDirectory()
  return {
    name: entryName,
    ext: isDirectory ? '' : Path.extname(entryName),
    isDirectory,
    hidden: entryName.startsWith('.'),
    lastModified: stat.ctimeMs,
    birthtime: stat.birthtimeMs,
    size: isDirectory ? null : stat.size,
    error: null,
  }
}

function createEntryFromStatError(entry: Dirent, err: unknown): IEntry {
  const entryName = entry.name
  const isDirectory = entry.isDirectory()
  return {
    name: entryName,
    ext: isDirectory ? '' : Path.extname(entryName),
    isDirectory,
    hidden: entryName.startsWith('.'),
    lastModified: 0,
    birthtime: 0,
    size: isDirectory ? null : 0,
    error: err instanceof Error ? err.message : String(err),
  }
}

// --- 路由处理函数 (Route Handlers) ---

export async function getDrivers(req: Request, res: Response) {
  if (internalConfig.safeBaseDir) {
    res.json([
      {
        label: internalConfig.safeBaseDir,
        path: internalConfig.safeBaseDir,
      },
    ])
    return
  }
  const homeDrive: IDrive = {
    label: 'Home',
    path: os.homedir(),
  }

  try {
    const drives = await nodeDiskInfo.getDiskInfo()
    const otherDrives: IDrive[] = drives.map(drive => ({
      label: drive.mounted,
      path: drive.mounted,
      free: drive.available,
      total: drive.blocks,
    }))

    return res.json([homeDrive, ...otherDrives])
  }
  catch {
    const list = (await getWindowsDrives()).map(drive => ({
      label: drive,
      path: drive,
    }))
    return res.json([homeDrive, ...list])
  }
}

export async function getFiles(req: Request, res: Response) {
  const { path } = req.query as { path: string }

  if (!isPathSafe(path)) {
    return res.status(400).json({ message: 'Path is not safe' })
  }

  try {
    const stats = await fs.stat(path)
    if (!stats.isDirectory()) {
      return res.status(400).json({ message: 'Path is not a directory' })
    }

    const entries = await fs.readdir(path, { withFileTypes: true })

    const results = await mapWithConcurrency(
      entries,
      READ_DIR_STAT_CONCURRENCY,
      async (entry): Promise<IEntry> => {
        const entryName = entry.name
        const entryPath = Path.join(path, entryName)
        try {
          const stat = await fs.stat(entryPath)
          return createEntryFromStat(entryName, stat)
        }
        catch (err: unknown) {
          // 如果获取某个文件信息失败，记录错误，但不中断整个请求
          return createEntryFromStatError(entry, err)
        }
      },
    )
    return res.json(results)
  }
  catch (err: any) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ message: 'Path not found' })
    }

    return res.status(500).json({ message: err.message || 'Failed to read directory' })
  }
}

export async function createDirectory(req: Request, res: Response) {
  const { path } = req.body as { path: string }

  if (!isPathSafe(path)) {
    return res.status(400).json({ message: 'Path is not safe' })
  }

  if (await isExist(path)) {
    return res.json({ existed: true, path })
  }

  await fs.mkdir(path, { recursive: true })
  return res.status(201).json({ path }) // 使用 201 Created 状态码更符合 RESTful 风格
}

export async function renamePath(req: Request, res: Response) {
  const { fromPath, toPath } = req.body as { fromPath: string, toPath: string }

  if (!fromPath || !toPath) {
    return res.status(400).json({ message: 'fromPath or toPath is required' })
  }
  if (fromPath === toPath) {
    return res.status(400).json({ message: 'Paths cannot be the same' })
  }
  if (!isPathSafe(fromPath) || !isPathSafe(toPath)) {
    return res.status(400).json({ message: 'A specified path is not safe' })
  }
  if (!(await isExist(fromPath))) {
    return res.status(404).json({ message: 'Source path not found' })
  }
  if (await isExist(toPath)) {
    return res.status(409).json({ message: 'Destination path already exists' }) // 409 Conflict 更合适
  }

  await fs.rename(fromPath, toPath)
  return res.json({ path: toPath })
}

/**
 * 内部函数：复制或移动单个条目
 */
async function copyEntry(fromPath: string, toDir: string, isMove = false) {
  if (!isPathSafe(fromPath) || !isPathSafe(toDir)) {
    throw new Error(`Path is not safe. From: ${fromPath}, To: ${toDir}`)
  }
  if (!(await isExist(fromPath))) {
    throw new Error(`Source path does not exist: ${fromPath}`)
  }

  const toPath = Path.join(toDir, Path.basename(fromPath))
  if (await isExist(toPath)) {
    throw new Error(`Destination path already exists: ${toPath}`)
  }

  await fs.cp(fromPath, toPath, { recursive: true })
  if (isMove) {
    await fs.rm(fromPath, { recursive: true, force: true })
  }
}

export async function copyPastePath(req: Request, res: Response) {
  const {
    fromPaths,
    toPath,
    isMove = false,
  } = req.body as { fromPaths: string[], toPath: string, isMove?: boolean }

  try {
    // 使用 Promise.all 并发处理所有复制/移动操作
    await Promise.all(fromPaths.map(path => copyEntry(path, toPath, isMove)))
    return res.json({ path: toPath })
  }
  catch (err: any) {
    return res.status(400).json({ message: err.message || 'Operation failed' })
  }
}

export async function deletePath(req: Request, res: Response) {
  const { path } = req.body as { path: string | string[] }
  // 统一处理，将 string 转为 array，以复用逻辑
  const pathsToDelete = Array.isArray(path) ? path : [path]

  try {
    // 使用 Promise.all 并发执行所有删除前检查
    await Promise.all(
      pathsToDelete.map(async (p) => {
        if (!isPathSafe(p)) {
          throw new Error(`Path is not safe: ${p}`)
        }
        if (!(await isExist(p))) {
          // 如果允许不存在的路径直接跳过，可以不抛出错误
          throw new Error(`Path not found: ${p}`)
        }
      }),
    )

    // 同样并发执行删除操作
    await Promise.all(pathsToDelete.map(p => fs.rm(p, { recursive: true, force: true })))

    return res.json({ path })
  }
  catch (err: any) {
    return res.status(400).json({ message: err.message || 'Deletion failed' })
  }
}

export async function getFileStream(req: Request, res: Response) {
  const { path } = req.query as { path: string }

  if (!isPathSafe(path)) {
    return res.status(400).json({ message: 'Path is not safe' })
  }
  if (!(await isExist(path))) {
    return res.status(404).json({ message: 'Path not found' })
  }

  const stats = await fs.stat(path)
  if (!stats.isFile()) {
    return res.status(400).json({ message: 'Path is not a file' })
  }

  // res.sendFile 会自动处理流、头部等，是最佳实践
  const tName = Path.basename(path)
  const filename = encodeURIComponent(sanitize(tName))
  const fallbackFilename = sanitizeAttachmentFilename(tName)
  res.sendFile(Path.resolve(path), {
    headers: {
      'Content-Disposition': `inline; filename="${fallbackFilename}"; filename*=UTF-8''${filename}`,
    },
    dotfiles: 'allow',
  })
}

async function downloadMultiFiles(paths: string[], res: Response) {
  if (paths.length === 0) {
    return res.status(400).json({ message: 'No files to download' })
  }

  // 优化下载文件名的确定逻辑
  let downloadName = ''
  if (paths.length === 1 && paths[0]) {
    downloadName = Path.basename(paths[0])
  }
  else if (paths.length > 1 && paths[0]) {
    downloadName = Path.basename(Path.dirname(paths[0]))
  }
  if (!downloadName) {
    downloadName = 'download'
  }

  // sanitizeAttachmentFilename
  const tName = `${downloadName}.zip`
  const filename = encodeURIComponent(sanitize(tName))
  const fallbackFilename = sanitizeAttachmentFilename(tName)
  // console.log(downloadName, filename)
  res.header('Content-Disposition', `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${filename}`)

  const archive = Archiver('zip', { zlib: { level: 9 } })
  archive.pipe(res)

  // 监听错误事件
  archive.on('error', (err) => {
    // 确保在出错时能正确结束响应
    res.status(500).send({ error: err.message })
  })

  // 这里的循环是向 Archiver 添加任务，是同步的，Archiver 内部会异步处理
  for (const path of paths) {
    if (await isExist(path)) {
      const stat = await fs.stat(path)
      const entryName = Path.basename(path)
      if (stat.isDirectory()) {
        // 检查目录是否为空
        const filesInDir = await fs.readdir(path)

        if (filesInDir.length === 0) {
          // 如果目录为空，使用 append 添加一个空目录条目
          // 关键：name 必须以 '/' 结尾
          // console.log(`Adding empty directory: ${entryName}/`);
          archive.append(null, { name: `${entryName}/` })
        }
        else {
          // 如果目录不为空，则使用 directory 添加整个目录的内容
          // console.log(`Adding non-empty directory: ${entryName}`);
          archive.directory(path, entryName)
        }
      }
      else {
        archive.file(path, { name: entryName })
      }
    }
  }

  await archive.finalize()
}

export async function downloadPath(req: Request, res: Response) {
  // console.log(req.query)
  const { path, paths } = req.query as { path?: string, paths?: string[] }
  // 统一输入为 pathsToDownload 数组
  const pathsToDownload = (path ? [path] : paths || []).map(p => decodeURIComponent(p))

  if (pathsToDownload.length === 0) {
    return res.status(400).json({ message: 'path(s) parameter is required' })
  }
  // console.log('pathsToDownload', pathsToDownload)
  // 验证所有路径的安全性
  for (const p of pathsToDownload) {
    if (!isPathSafe(p)) {
      return res.status(400).json({ message: `Path is not safe: ${p}` })
    }
  }

  try {
    // 单个文件下载的特殊处理
    if (pathsToDownload.length === 1) {
      const singlePath = pathsToDownload[0] as string
      if (!(await isExist(singlePath))) {
        return res.status(404).json({ message: 'Path not found' })
      }
      const stats = await fs.stat(singlePath)
      if (stats.isFile()) {
        // 对于单个文件，直接使用 res.download
        const tName = Path.basename(singlePath)
        const filename = encodeURIComponent(sanitize(tName))
        const fallbackFilename = sanitizeAttachmentFilename(tName)
        res.header('Content-Disposition', `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${filename}`)
        // console.log('single download', filename)
        return res.download(singlePath, sanitize(tName), {
          dotfiles: 'allow',
        })
      }
    }

    // 多个文件或单个目录，都走压缩下载逻辑
    return await downloadMultiFiles(pathsToDownload, res)
  }
  catch (err: any) {
    return res.status(500).json({ message: err.message || 'Download failed' })
  }
}

// 存储引擎配置
export const multerUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const path = req.query.path || ''
      let dest = ''
      try {
        if (path) {
          // 确保目录安全
          if (!isPathSafe(req.query.path as string)) {
            return cb(new Error(`Path is not safe: ${path}`))
          }
          dest = Path.dirname(path)
        }
        else {
          dest = Path.join(process.cwd(), `${internalConfig.dataBaseDir}/uploads`)
        }
        console.log('upload dest', dest)
        // 确保目录存在
        if (!(await isExist(dest))) {
          await fs.mkdir(dest, { recursive: true })
        }
        cb(null, dest)
      }
      catch (error) {
        cb(error)
      }
    },
    filename: (req, file, cb) => {
      // console.log('upload file', file)
      // 如果文件名包含非 UTF-8 字符，尝试进行转码
      try {
        file.originalname = sanitizeUploadFilename(file.originalname)
      }
      catch (error) {
        console.error('Invalid upload filename:', error)
        return cb(error as Error, '')
      }
      cb(null, file.originalname)
    },
  }),
})
