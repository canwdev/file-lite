import type { Request, Response } from 'express'
import type { IDrive, IEntry } from '@/types/server.ts'
import { Buffer } from 'node:buffer'
import * as console from 'node:console'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import * as process from 'node:process'
import Archiver from 'archiver'
import multer from 'multer'
import nodeDiskInfo from 'node-disk-info'
import { DATA_BASE_DIR, normalizePath, SAFE_BASE_DIR } from '@/enum/config.ts'
import { getWindowsDrives } from '@/utils/get-drives.ts'
import { sanitize, sanitizeAttachmentFilename } from '@/utils/sanitize-filename.ts'

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
  if (!SAFE_BASE_DIR) {
    return true
  }
  const safeBaseDir = SAFE_BASE_DIR
  const resolvedPath = normalizePath(path)
  const isSafe = resolvedPath.startsWith(safeBaseDir)
  if (!isSafe) {
    console.error('unsafe', { resolvedPath, safeBaseDir })
  }
  return isSafe
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

// --- 路由处理函数 (Route Handlers) ---

export async function getDrivers(req: Request, res: Response) {
  if (SAFE_BASE_DIR) {
    res.json([
      {
        label: SAFE_BASE_DIR,
        path: SAFE_BASE_DIR,
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
  catch (error: any) {
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
  if (!(await isExist(path))) {
    return res.status(404).json({ message: 'Path not found' })
  }

  try {
    const stats = await fs.stat(path)
    if (!stats.isDirectory()) {
      return res.status(400).json({ message: 'Path is not a directory' })
    }

    const files = await fs.readdir(path)

    // 使用 Promise.all 并发获取所有文件/目录的 stat 信息，提高性能
    const results: IEntry[] = await Promise.all(
      files.map(async (entryName): Promise<IEntry> => {
        const entryPath = Path.join(path, entryName)
        try {
          const stat = await fs.stat(entryPath)
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
        catch (err: any) {
          // 如果获取某个文件信息失败，记录错误，但不中断整个请求
          return {
            name: entryName,
            ext: Path.extname(entryName),
            isDirectory: false,
            hidden: entryName.startsWith('.'),
            lastModified: 0,
            birthtime: 0,
            size: 0,
            error: err.message || String(err),
          }
        }
      }),
    )
    return res.json(results)
  }
  catch (err: any) {
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
  // sanitizeAttachmentFilename
  const filename = encodeURIComponent(sanitize(Path.basename(path)))
  res.sendFile(Path.resolve(path), {
    headers: {
      'Content-Disposition': `inline; filename="download.zip"; filename*=UTF-8''${filename}`,
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
  const filename = encodeURIComponent(sanitize(downloadName))
  // console.log(downloadName, filename)
  res.header('Content-Disposition', `attachment; filename="download.zip"; filename*=UTF-8''${filename}.zip`)

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
        const filename = sanitizeAttachmentFilename(Path.basename(singlePath))
        // console.log('single download', filename)
        return res.download(singlePath, filename, {
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
          dest = Path.join(process.cwd(), `${DATA_BASE_DIR}/uploads`)
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
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8')
      }
      catch (error) {
        console.error('Error decoding filename:', error)
        console.warn('Failed to decode filename, using original name', file.originalname)
      }
      cb(null, file.originalname)
    },
  }),
})
