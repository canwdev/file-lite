import type { IDrive, IEntry } from '@/types/server'

let rootHandle: FileSystemDirectoryHandle | null = null

// Helper to get directory handle
async function getDirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
  if (!rootHandle)
    throw new Error('Root not set')
  if (path === '/' || path === '')
    return rootHandle

  const parts = path.split('/').filter(p => p)
  let current = rootHandle

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create })
  }
  return current
}

// Helper to get file handle
async function getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
  const dirPath = path.substring(0, path.lastIndexOf('/'))
  const fileName = path.split('/').pop()
  if (!fileName)
    throw new Error('Invalid file path')

  const dirHandle = await getDirHandle(dirPath, create)
  return await dirHandle.getFileHandle(fileName, { create })
}

export const fsLocal = {
  async auth() {
    try {
      // @ts-expect-error - showDirectoryPicker may not be in types
      rootHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
      })
      return true
    }
    catch (e) {
      console.error('User cancelled', e)
      return false
    }
  },

  async getDrives() {
    return rootHandle ? [{ label: rootHandle.name, path: '/', free: 0, total: 0 } as IDrive] : []
  },

  async getList(params: { path: string }) {
    if (!rootHandle)
      throw new Error('Root not set')

    try {
      const dirHandle = await getDirHandle(params.path)
      const entries: IEntry[] = []

      for await (const [name, handle] of dirHandle.entries()) {
        const isDirectory = handle.kind === 'directory'
        let size = null
        let lastModified = 0

        if (!isDirectory) {
          const file = await (handle as FileSystemFileHandle).getFile()
          size = file.size
          lastModified = file.lastModified
        }

        entries.push({
          name,
          ext: name.split('.').pop() || '',
          isDirectory,
          hidden: name.startsWith('.'),
          lastModified,
          birthtime: 0,
          size,
          error: null,
        })
      }
      // Sort entries: directories first
      return entries.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name)
        }
        return a.isDirectory ? -1 : 1
      })
    }
    catch (e) {
      console.error('getList error', e)
      return []
    }
  },

  async createDir(params: { path: string, ignoreExisted?: boolean }) {
    await getDirHandle(params.path, true)
  },

  async uploadFile(params: { path: string, file: File }) {
    const { path, file } = params
    const dirHandle = await getDirHandle(path)
    const fileHandle = await dirHandle.getFileHandle(file.name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(file)
    await writable.close()
  },

  async deleteEntry(params: { path: string[] }) {
    if (!rootHandle)
      return

    for (const p of params.path) {
      const parentPath = p.substring(0, p.lastIndexOf('/'))
      const name = p.split('/').pop()
      if (!name)
        continue

      try {
        const dirHandle = await getDirHandle(parentPath)
        await dirHandle.removeEntry(name, { recursive: true })
      }
      catch (e) {
        console.warn('Failed to delete', p, e)
      }
    }
  },

  async renameEntry(params: { fromPath: string, toPath: string }) {
    const { fromPath, toPath } = params
    const sourceDir = fromPath.substring(0, fromPath.lastIndexOf('/'))
    const sourceName = fromPath.split('/').pop()
    const targetDir = toPath.substring(0, toPath.lastIndexOf('/'))
    const targetName = toPath.split('/').pop()

    if (!sourceName || !targetName)
      return

    const sourceDirHandle = await getDirHandle(sourceDir)
    const targetDirHandle = await getDirHandle(targetDir)

    // Try to get handle
    let handle: FileSystemHandle
    try {
      handle = await sourceDirHandle.getDirectoryHandle(sourceName)
    }
    catch {
      handle = await sourceDirHandle.getFileHandle(sourceName)
    }

    // @ts-expect-error - move is experimental
    if (handle.move) {
      // @ts-expect-error - move is experimental
      await handle.move(targetDirHandle, targetName)
    }
    else {
      throw new Error('Rename not supported in this browser (missing handle.move)')
    }
  },

  async copyPaste(params: { fromPaths: string[], toPath: string, isMove: boolean }) {
    // This is complex for a single file.
    // We will skip full implementation for now as it requires recursive copy logic.
    console.warn('copyPaste not implemented for local fs', params)
    throw new Error('Copy/Paste not implemented')
  },

  getDownloadUrl(paths: string[]) {
    // Cannot be sync. We need to maybe change the architecture or return a blob url async?
    // For now, return empty string or throw.
    // The UI might depend on this being a string.
    console.warn('getDownloadUrl is synchronous in interface but impossible locally', paths)
    return ''
  },

  async getStreamUrl(path: string) {
    try {
      const handle = await getFileHandle(path)
      const file = await handle.getFile()
      return URL.createObjectURL(file)
    }
    catch {
      return ''
    }
  },

  async stream(path: string) {
    const handle = await getFileHandle(path)
    const file = await handle.getFile()
    return await file.text()
  },
}
