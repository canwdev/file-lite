import Path from 'path'
import {IDrive, IEntry} from '@/routes/files/types.ts'
import fs from 'node:fs/promises'
import nodeDiskInfo from 'node-disk-info'
import os from 'node:os'
import {Stats} from 'node:fs'
import {Request, Response} from 'express'
import {SAFE_ABS_BASE_DIR, normalizePath} from '@/enum/config.ts'

// 安全检查：确保访问路径不超出基础目录
function isPathSafe(path: string): boolean {
  if (!SAFE_ABS_BASE_DIR) {
    return true
  }
  const resolvedPath = normalizePath(Path.resolve(SAFE_ABS_BASE_DIR, path))
  return resolvedPath.startsWith(SAFE_ABS_BASE_DIR)
}

const isExist = async (path: string) => {
  try {
    await fs.access(path)
    return true
  } catch (err) {
    return false
  }
}

export const getDrivers = async (req: Request, res: Response) => {
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
  return res.json(results)
}
// 列出文件夹内容
export const getFiles = async (req: Request, res: Response) => {
  const {path} = req.query as {path: string}

  if (!isPathSafe(path)) {
    return res.status(400).json({message: 'Path not safe'})
  }
  if (!(await isExist(path))) {
    return res.status(400).json({message: 'Path not found'})
  }

  const stats = await fs.stat(path)
  if (!stats.isDirectory()) {
    return res.status(400).json({message: 'Path is not a directory'})
  }

  const files = await fs.readdir(path)

  const results: IEntry[] = []
  for (const entryName of files) {
    const entryPath = Path.join(path, entryName)
    let stat: Stats | null = null
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
      size: isDirectory ? null : stat?.size || 0,
      error,
    })
  }
  return res.json(results)
}

// 获取文件流
export const getFileStream = async (req: Request, res: Response) => {
  const {path} = req.query as {path: string}

  if (!isPathSafe(path)) {
    return res.status(400).json({message: 'Path not safe'})
  }
  if (!(await isExist(path))) {
    return res.status(400).json({message: 'Path not found'})
  }

  const stats = await fs.stat(path)
  if (!stats.isFile()) {
    return res.status(400).json({message: 'Path is not a file'})
  }

  res.sendFile(path)
}

// 创建目录
export const createDirectory = async (req: Request, res: Response) => {
  const {path} = req.body as {path: string}

  if (!isPathSafe(path)) {
    return res.status(400).json({message: 'Path not safe'})
  }

  if (await isExist(path)) {
    return res.json({existed: true, path})
  }
  await fs.mkdir(path, {recursive: true})
  return res.json({path})
}

// 重命名路径
export const renamePath = async (req: Request, res: Response) => {
  const {fromPath, toPath} = req.body as {fromPath: string; toPath: string}

  if (!fromPath || !toPath) {
    return res.status(400).json({message: 'fromPath or toPath is empty'})
  }

  if (fromPath === toPath) {
    return res.status(400).json({message: 'fromPath and toPath are same'})
  }

  if (!isPathSafe(fromPath)) {
    return res.status(400).json({message: 'fromPath not safe'})
  }
  if (!isPathSafe(toPath)) {
    return res.status(400).json({message: 'toPath not safe'})
  }
  if (!(await isExist(fromPath))) {
    return res.status(400).json({message: 'fromPath not found'})
  }
  if (await isExist(toPath)) {
    return res.status(400).json({message: 'toPath existed'})
  }
  await fs.rename(fromPath, toPath)
  return res.json({path: toPath})
}
