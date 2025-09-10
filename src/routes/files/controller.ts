import Path from 'path'
import {IDrive, IEntry} from '@/routes/files/types.ts'
import fs from 'node:fs/promises'
import nodeDiskInfo from 'node-disk-info'
import os from 'node:os'
import {Stats} from 'node:fs'
import {Request, Response} from 'express'

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
  const {path} = req.query

  if (typeof path !== 'string') {
    // 确保 path 是 string 类型
    return res.status(400).json({error: 'Path must be a string'})
  }

  const valid = await checkValidPath(path || '')
  if (!valid) {
    return res.status(400).json({error: 'Path not found'})
  }

  try {
    const stats = await fs.stat(path)
    if (!stats.isDirectory()) {
      return res.status(400).json({error: 'Path is not a directory'})
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
  } catch (error: any) {
    console.error('Error in getFiles:', error)
    return res.status(500).json({error: 'Internal Server Error'}) // 统一的错误处理
  }
}

// 获取文件流
export const getFileStream = async (req: Request, res: Response) => {
  const {path} = req.query

  if (typeof path !== 'string') {
    // 确保 path 是 string 类型
    return res.status(400).json({error: 'Path must be a string'})
  }

  const valid = await checkValidPath(path || '')
  if (!valid) {
    return res.status(400).json({error: 'Path not found'})
  }

  try {
    const stats = await fs.stat(path)
    if (!stats.isFile()) {
      return res.status(400).json({error: 'Path is not a file'})
    }

    res.sendFile(path)
  } catch (error: any) {
    console.error('Error in getFileStream:', error)
    return res.status(500).json({error: 'Internal Server Error'}) // 统一的错误处理
  }
}
