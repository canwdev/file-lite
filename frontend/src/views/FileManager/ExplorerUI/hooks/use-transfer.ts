import type { IEntry } from '@server/types/server'
import { useDropZone, useFileDialog } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { downloadUrl } from '@/utils'
import { normalizePath } from '../../utils'

export function useTransfer({
  basePath,
  isLoading,
  selectedItems,
}: {
  basePath: Ref<string>
  isLoading: Ref<boolean>
  selectedItems: Ref<IEntry[]>
}) {
  const uploadFiles = async (files: File[] | FileList | null) => {
    if (!files) {
      return
    }
    for (const file of files) {
      uploadQueueRef.value.addTask({
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
  const uploadQueueRef = ref()
  onSelectFiles(async (files) => {
    if (!files) {
      return
    }
    await uploadFiles(files)
    // emit('refresh')
  })

  // 支持递归上传文件夹
  function traverseFileTree(item, path = '') {
    if (item.isFile) {
      // Get file
      item.file((file) => {
        // console.log('File:', {path, file})

        uploadQueueRef.value.addTask({
          filename: file.name,
          path: normalizePath(`${basePath.value}/${path}${file.name}`),
          file,
        })
      })
    }
    else if (item.isDirectory) {
      // console.log('Dir', item)
      // Get folder contents
      const dirReader = item.createReader()
      dirReader.readEntries((entries) => {
        for (let i = 0; i < entries.length; i++) {
          traverseFileTree(entries[i], `${path + item.name}/`)
        }
      })

      fsWebApi.createDir({
        path: normalizePath(basePath.value + item.fullPath),
        ignoreExisted: true,
      })
    }
    else {
      // 前两种只有拖拽上传才会触发，这种方式是选择文件夹后触发
      // 选择上传文件夹的弊端是无法上传空文件夹
      // console.warn('normal file', item)

      uploadQueueRef.value.addTask({
        filename: item.name,
        path: normalizePath(`${basePath.value}/${item.webkitRelativePath}`),
        file: item,
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

  const dropZoneRef = ref<HTMLDivElement>()
  const { isOverDropZone } = useDropZone(dropZoneRef, {
    onDrop: (files, event) => {
      const items = event.dataTransfer?.items || []
      // console.log(items)

      for (let i = 0; i < items.length; i++) {
        // webkitGetAsEntry is where the magic happens
        const item = items[i].webkitGetAsEntry()
        if (item) {
          traverseFileTree(item)
        }
      }
    },
  })

  return {
    uploadQueueRef,
    dropZoneRef,
    isOverDropZone,
    selectUploadFiles,
    selectUploadFolder,
    handleDownload,
    confirmDownload,
  }
}
