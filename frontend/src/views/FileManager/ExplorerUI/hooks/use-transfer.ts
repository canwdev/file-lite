import type { UploadConflictPolicy } from '@/api/filesystem'
import type { IEntry } from '@/types/server'
import { useDropZone, useFileDialog } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { requestLocalConflict } from '@/store/tasks'
import { downloadUrl } from '@/utils'
import { normalizePath } from '../../utils'

const DOWNLOAD_TASK_BATCH_SIZE = 200
const DOWNLOAD_YIELD_INTERVAL = 1500

/** 一次待上传的文件：绝对目标路径 + 内容。 */
interface PendingUpload {
  file: File
  path: string
}

export function useTransfer({
  basePath,
  isLoading,
  selectedItems,
}: {
  basePath: Ref<string>
  isLoading: Ref<boolean>
  selectedItems: Ref<IEntry[]>
}) {
  const transferQueueRef = ref()

  /** 弹窗里展示用的相对路径 */
  function relativeLabel(path: string) {
    const prefix = normalizePath(`${basePath.value}/`)
    return path.startsWith(prefix) ? path.slice(prefix.length) : path
  }

  /**
   * 所有上传的唯一入队口。先向服务端批量确认同名冲突，必要时弹一次决策
   * （Replace / Skip / Keep both），再按策略入队。
   *
   * 服务端 upload-file 也会独立校验，所以即使这里的预检因为竞态漏判，
   * 也只会得到一个明确的失败，不会静默覆盖。
   */
  async function enqueueUploads(items: PendingUpload[]) {
    if (!items.length) {
      return
    }

    let policy: UploadConflictPolicy = 'error'
    let pending = items

    try {
      const { existing } = await fsWebApi.checkExists(items.map(item => item.path))
      if (existing.length) {
        const existingSet = new Set(existing)
        const conflictItems = items
          .filter(item => existingSet.has(item.path))
          .map(item => ({
            relativePath: relativeLabel(item.path),
            kind: 'file-vs-file' as const,
            sourceIsDirectory: false,
            destIsDirectory: false,
            sourceSize: item.file.size,
          }))

        const resolution = await requestLocalConflict({
          destPath: basePath.value,
          isMove: false,
          totalCount: conflictItems.length,
          truncated: false,
          conflicts: conflictItems,
          action: 'Upload',
        })

        if (!resolution) {
          window.$message?.info('Upload cancelled')
          return
        }
        if (resolution.policy === 'skip') {
          pending = items.filter(item => !existingSet.has(item.path))
        }
        else {
          policy = resolution.policy === 'keep-both' ? 'keep-both' : 'overwrite'
        }
      }
    }
    catch (error) {
      // 预检失败不阻断上传：交给服务端的缺省策略（同名即拒绝并如实报错）
      console.error('[upload] conflict pre-check failed', error)
      policy = 'error'
    }

    for (const item of pending) {
      transferQueueRef.value.addTask({
        filename: item.file.name,
        path: item.path,
        file: item.file,
        onConflict: policy,
      })
    }
  }

  const { open: selectUploadFiles, onChange: onSelectFiles } = useFileDialog({
    multiple: true,
    reset: true,
  })
  onSelectFiles(async (files) => {
    if (!files) {
      return
    }
    await enqueueUploads(Array.from(files).map(file => ({
      file,
      path: normalizePath(`${basePath.value}/${file.name}`),
    })))
  })

  // 文件夹选择框只给到 FileList + webkitRelativePath，父目录由上传接口按需创建
  const { open: selectUploadFolder, onChange: onSelectFolder } = useFileDialog({
    directory: true,
    reset: true,
  })
  onSelectFolder(async (filesList) => {
    if (!filesList) {
      return
    }
    const items: PendingUpload[] = []
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i]
      if (!file) {
        continue
      }
      items.push({
        file,
        path: normalizePath(`${basePath.value}/${file.webkitRelativePath || file.name}`),
      })
    }
    await enqueueUploads(items)
  })

  /** 从拖放进来的文件系统条目递归收集待上传文件（浏览器拖拽才有目录信息）。 */
  async function collectEntry(entry: FileSystemEntry, path: string, out: PendingUpload[]) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject)
      })
      out.push({ file, path: normalizePath(`${basePath.value}/${path}${file.name}`) })
      return
    }
    if (entry.isDirectory) {
      const dir = entry as FileSystemDirectoryEntry
      await fsWebApi.createDir({
        path: normalizePath(basePath.value + dir.fullPath),
        ignoreExisted: true,
      })
      const children = await readAllDirectoryEntries(dir.createReader())
      for (const child of children) {
        await collectEntry(child, `${path}${dir.name}/`, out)
      }
    }
  }

  const handleDownload = async () => {
    try {
      isLoading.value = true
      const paths: string[] = []
      if (selectedItems.value.length === 0) {
        paths.push(encodeURIComponent(normalizePath(basePath.value)))
      }
      else {
        for (const itemsKey in selectedItems.value) {
          const item = selectedItems.value[itemsKey]
          paths.push(encodeURIComponent(normalizePath(`${basePath.value}/${item.name}`)))
        }
      }

      const url = fsWebApi.getDownloadUrl(paths)
      downloadUrl(url)
    }
    finally {
      isLoading.value = false
    }
  }
  const confirmDownload = async () => {
    const isDownloadingCurrent = selectedItems.value.length === 0
    const message = isDownloadingCurrent
      ? 'Are you sure to download the current folder?'
      : `Are you sure to download ${selectedItems.value.length} item(s)?`

    window.$dialog
      .confirm(
        message,
        'Confirm Download',
        {
          type: 'info',
        },
      )
      .then(() => {
        handleDownload()
      })
      .catch()
  }

  const downloadToFolder = async () => {
    try {
      const handle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
      if (!handle) {
        return
      }

      const pendingTasks: {
        filename: string
        path: string
        // 目录列表里已知的文件大小，用于展示传输总量
        size?: number
        parentHandle: FileSystemDirectoryHandle
        type: 'download'
      }[] = []

      let initialStack = []
      if (selectedItems.value.length === 0) {
        const currentFolderName = basePath.value.split('/').filter(Boolean).pop() || 'root'
        const dirHandle = await handle.getDirectoryHandle(currentFolderName, { create: true })
        const children = await fsWebApi.getList({ path: basePath.value })
        initialStack = children.map(item => ({
          entry: item,
          parentHandle: dirHandle,
          basePathStr: basePath.value,
        }))
      }
      else {
        initialStack = selectedItems.value.map(item => ({
          entry: item,
          parentHandle: handle,
          basePathStr: basePath.value,
        }))
      }

      const stack = initialStack
      let processedCount = 0

      const flushTasks = () => {
        if (!pendingTasks.length) {
          return
        }

        transferQueueRef.value.addTasks(pendingTasks.splice(0))
      }

      while (stack.length) {
        const { entry, parentHandle, basePathStr } = stack.pop()!
        const itemPath = normalizePath(`${basePathStr}/${entry.name}`)

        if (entry.isDirectory) {
          const dirHandle = await parentHandle.getDirectoryHandle(entry.name, { create: true })
          const children = await fsWebApi.getList({ path: itemPath })
          for (let i = children.length - 1; i >= 0; i--) {
            stack.push({
              entry: children[i],
              parentHandle: dirHandle,
              basePathStr: itemPath,
            })
          }
        }
        else {
          pendingTasks.push({
            filename: entry.name,
            path: itemPath,
            size: entry.size ?? undefined,
            parentHandle,
            type: 'download',
          })
        }

        processedCount++
        if (pendingTasks.length >= DOWNLOAD_TASK_BATCH_SIZE) {
          flushTasks()
          await yieldToBrowser()
        }
        else if (processedCount % DOWNLOAD_YIELD_INTERVAL === 0) {
          await yieldToBrowser()
        }
      }

      flushTasks()
    }
    catch (e: any) {
      if (e.name === 'AbortError') {
        return
      }
      console.error(e)
      window.$message.error(`Download failed: ${e.message}`)
    }
  }

  const dropZoneRef = ref<HTMLDivElement>()
  const { isOverDropZone } = useDropZone(() => dropZoneRef.value ?? null, {
    onDrop: async (_files, event) => {
      const dataTransferItems = event.dataTransfer?.items || []
      const collected: PendingUpload[] = []
      for (let i = 0; i < dataTransferItems.length; i++) {
        const entry = dataTransferItems[i].webkitGetAsEntry()
        if (entry) {
          await collectEntry(entry, '', collected)
        }
      }
      await enqueueUploads(collected)
    },
  })

  return {
    transferQueueRef,
    dropZoneRef,
    isOverDropZone,
    selectUploadFiles,
    selectUploadFolder,
    handleDownload,
    confirmDownload,
    downloadToFolder,
  }
}

/**
 * readEntries 每次最多返回 100 个条目，必须循环读到空为止。
 * 之前只读一次，超过 100 个文件的目录会被静默漏掉。
 */
function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (!entries.length) {
          resolve(all)
          return
        }
        all.push(...entries)
        readBatch()
      }, reject)
    }
    readBatch()
  })
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve)
  })
}
