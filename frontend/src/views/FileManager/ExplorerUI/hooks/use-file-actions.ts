import moment from 'moment/moment'
import {fsWebApi} from '@/api/filesystem'
import {generateTextFile, normalizePath} from '../../utils'
import {IEntry} from '@server/types/server'
import {showInputPrompt} from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import ContextMenu, {MenuItem} from '@imengyu/vue3-context-menu'
import {OpenWithEnum} from '@/views/Apps/apps'

export const useFileActions = ({
  isLoading,
  selectedPaths,
  basePath,
  selectedItems,
  enablePaste,
  handlePaste,
  handleCut,
  handleCopy,
  selectedItemsSet,
  handleDownload,
  emit,
}: {
  isLoading: Ref<boolean>
  selectedPaths: Ref<string[]>
  basePath: Ref<string>
  selectedItems: Ref<IEntry[]>
  enablePaste: Ref<boolean>
  handlePaste: () => Promise<void>
  handleCut: () => void
  handleCopy: () => void
  selectedItemsSet: Ref<Set<IEntry>>
  handleDownload: () => Promise<void>
  emit: any
}) => {
  const handleCreateFile = async (name = '', content = '') => {
    try {
      name =
        name ||
        (await showInputPrompt({
          title: 'Create File',
          value: `file_${moment(new Date()).format('YYYYMMDD_HHmmss')}.txt`,
        }))
      isLoading.value = true
      await fsWebApi.uploadFile({
        path: normalizePath(basePath.value + '/' + name),
        file: generateTextFile(content, name),
      })
      emit('refresh')
    } finally {
      isLoading.value = false
    }
  }
  const handleCreateFolder = async () => {
    try {
      const name = await showInputPrompt({
        title: 'Create Folder',
        value: `folder_${moment(new Date()).format('YYYYMMDD_HHmmss')}`,
      })
      isLoading.value = true
      await fsWebApi.createDir({path: normalizePath(basePath.value + '/' + name)})
      emit('refresh')
    } finally {
      isLoading.value = false
    }
  }

  const handleRename = async () => {
    try {
      const item: IEntry = selectedItems.value[0]
      const name = await showInputPrompt({
        title: 'Rename',
        value: item.name,
      })
      isLoading.value = true
      await fsWebApi.renameEntry({
        fromPath: normalizePath(basePath.value + '/' + item.name),
        toPath: normalizePath(basePath.value + '/' + name),
      })
      emit('refresh')
    } finally {
      isLoading.value = false
    }
  }
  const doDeleteSelected = async () => {
    try {
      isLoading.value = true

      await fsWebApi.deleteEntry({
        path: selectedPaths.value,
      })
    } finally {
      isLoading.value = false
      emit('refresh')
    }
  }
  const confirmDelete = () => {
    if (!selectedPaths.value.length) {
      return
    }
    window.$dialog
      .confirm(
        `Are you sure to delete ${selectedPaths.value.length} items? This action can not be undone.`,
        'Confirm Delete',
        {
          type: 'warning',
        },
      )
      .then(() => {
        doDeleteSelected()
      })
      .catch()
  }

  const ctxMenuOptions = computed((): MenuItem[] => {
    if (!selectedItems.value.length) {
      return [
        {label: 'Refresh', icon: 'mdi mdi-refresh', onClick: () => emit('refresh')},
        {
          label: 'Paste',
          icon: 'mdi mdi-content-paste',
          onClick: () => handlePaste(),
          disabled: !enablePaste.value,
        },
      ]
    }
    const isSingle = selectedItems.value.length === 1
    const isFile = isSingle && !selectedItems.value[0].isDirectory
    // @ts-ignore
    return [
      isSingle && {
        label: 'Open',
        onClick: () => {
          return emit('open', {
            item: selectedItems.value[0],
          })
        },
      },
      isSingle &&
        isFile && {
          label: 'Open With',
          icon: 'mdi mdi-open-in-app',
          children: [
            {
              label: 'Browser',
              icon: 'mdi mdi-open-in-new',
              onClick: () => {
                emit('open', {
                  item: selectedItems.value[0],
                  openWith: OpenWithEnum.Browser,
                })
              },
            },
            {
              label: 'Share',
              icon: 'mdi mdi-share-variant',
              onClick: () => {
                emit('open', {
                  item: selectedItems.value[0],
                  openWith: OpenWithEnum.Share,
                })
              },
              divided: true,
            },
            {
              label: 'Text Editor',
              icon: 'mdi mdi-text-box-outline',
              onClick: () => {
                emit('open', {
                  item: selectedItems.value[0],
                  openWith: OpenWithEnum.TextEditor,
                })
              },
            },
          ],
        },
      {label: 'Download', icon: 'mdi mdi-download', onClick: handleDownload, divided: true},
      {label: 'Cut', icon: 'mdi mdi-content-cut', onClick: handleCut},
      {label: 'Copy', icon: 'mdi mdi-content-copy', onClick: handleCopy, divided: true},
      isSingle && {label: 'Rename', icon: 'mdi mdi-rename', onClick: handleRename},
      {
        label: 'Delete',
        icon: 'mdi mdi-delete-forever-outline',
        onClick: confirmDelete,
      },
    ].filter(Boolean)
  })

  const handleShowCtxMenu = (
    item: IEntry | null,
    event: MouseEvent,
    getMenuOptions: () => MenuItem[],
  ) => {
    if (!item) {
      selectedItems.value = []
    } else {
      if (!selectedItemsSet.value.has(item)) {
        selectedItems.value = [item]
      }
    }

    ContextMenu.showContextMenu({
      x: event.x,
      y: event.y,
      theme: 'flat',
      items: getMenuOptions(),
    })
  }

  const enableAction = computed(() => {
    return selectedItems.value.length > 0
  })
  return {
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    doDeleteSelected,
    confirmDelete,
    ctxMenuOptions,
    handleShowCtxMenu,
    enableAction,
  }
}
