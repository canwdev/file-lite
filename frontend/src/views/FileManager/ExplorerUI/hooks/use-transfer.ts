import type { IEntry } from '@/types/server'
import { useDropZone, useFileDialog } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { downloadUrl } from '@/utils'
import { normalizePath } from '../../utils'

const DOWNLOAD_TASK_BATCH_SIZE = 200
const DOWNLOAD_YIELD_INTERVAL = 1500

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
  const uploadFiles = async (files: File[] | FileList | null) => {
    if (!files) {
      return
    }
    for (const file of files) {
      transferQueueRef.value.addTask({
        filename: file.name,
        path: normalizePath(`${basePath.value}/${file.name}`),
        file,
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
    await uploadFiles(files)
    // emit('refresh')
  })

  // 支持递归上传文件夹
  function traverseFileTree(item: FileSystemEntry | File, path = '') {
    if (item instanceof File) {
      transferQueueRef.value.addTask({
        filename: item.name,
        path: normalizePath(`${basePath.value}/${item.webkitRelativePath}`),
        file: item,
      })
      return
    }
    if (item.isFile) {
      // Get file
      ;(item as FileSystemFileEntry).file((file: File) => {
        // console.log('File:', {path, file})

        transferQueueRef.value.addTask({
          filename: file.name,
          path: normalizePath(`${basePath.value}/${path}${file.name}`),
          file,
        })
      })
    }
    else if (item.isDirectory) {
      // console.log('Dir', item)
      // Get folder contents
      const dir = item as FileSystemDirectoryEntry
      const dirReader = dir.createReader()
      dirReader.readEntries((entries: FileSystemEntry[]) => {
        for (let i = 0; i < entries.length; i++) {
          traverseFileTree(entries[i], `${path + item.name}/`)
        }
      })

      fsWebApi.createDir({
        path: normalizePath(basePath.value + item.fullPath),
        ignoreExisted: true,
      })
    }
  }

  const {
    open: selectUploadFolder,
    // reset: resetSelectFolder,
    onChange: onSelectFolder,
  } = useFileDialog({
    directory: true,
    reset: true,
  })
  onSelectFolder(async (filesList) => {
    if (!filesList) {
      return
    }
    // console.log('[onSelectFolder]', filesList)

    for (let i = 0; i < filesList.length; i++) {
      const item = filesList[i]
      if (item) {
        traverseFileTree(item)
      }
    }
  })
  const handleDownload = async () => {
    try {
      isLoading.value = true
      const paths: string[] = []
      for (const itemsKey in selectedItems.value) {
        const item = selectedItems.value[itemsKey]
        paths.push(encodeURIComponent(normalizePath(`${basePath.value}/${item.name}`)))
      }

      // console.log(paths)
      const url = fsWebApi.getDownloadUrl(paths)
      // console.log(url)
      // window.open(url)
      downloadUrl(url)
    }
    finally {
      isLoading.value = false
    }
  }
  const confirmDownload = async () => {
    window.$dialog
      .confirm(
        `Are you sure to download ${selectedItems.value.length} item(s)?`,
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
        parentHandle: FileSystemDirectoryHandle
        type: 'download'
      }[] = []
      const stack = selectedItems.value.map(item => ({
        entry: item,
        parentHandle: handle,
        basePathStr: basePath.value,
      }))
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
    onDrop: (files, event) => {
      const items = event.dataTransfer?.items || []
      // console.log(items)

      for (let i = 0; i < items.length; i++) {
        // webkitGetAsEntry is where the magic happens
        const entry = items[i].webkitGetAsEntry()
        if (entry) {
          traverseFileTree(entry)
        }
      }
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

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve)
  })
}
