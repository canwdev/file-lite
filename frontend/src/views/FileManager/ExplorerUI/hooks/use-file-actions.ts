import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { Ref } from 'vue'
import type { IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import moment from 'moment/moment'
import { computed } from 'vue'
import { fsWebApi } from '@/api/filesystem'
import { menuThemeOptions } from '@/hooks/use-global-theme.ts'
import { copyWithToast } from '@/utils'
import { AppList, defaultAppMap, getFileExt, OpenWithEnum, setDefaultApp } from '@/views/Apps/apps'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import { generateTextFile, normalizePath } from '../../utils'
import { getDefaultOpenApp } from './use-opener'

function appendCopySuffix(name: string, index?: number) {
  const suffix = index ? `-copy-${index}` : '-copy'
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex > 0)
    return `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`
  return `${name}${suffix}`
}

function buildDuplicateName(originalName: string, existingNames: Set<string>) {
  const first = appendCopySuffix(originalName)
  if (!existingNames.has(first))
    return first

  for (let i = 2; i < 1000; i++) {
    const candidate = appendCopySuffix(originalName, i)
    if (!existingNames.has(candidate))
      return candidate
  }
  return `${first}-${Date.now()}`
}

function getEntryExt(name: string) {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(dotIndex) : ''
}

export function getOpenActionMeta(item: IEntry) {
  const defaultOpenApp = item.isDirectory ? null : getDefaultOpenApp(item)
  return {
    label: defaultOpenApp ? `Open with ${defaultOpenApp.name}` : 'Open',
    icon: defaultOpenApp?.icon ?? 'mdi mdi-folder-open-outline',
  }
}

export function useFileActions({
  isLoading,
  selectedPaths,
  basePath,
  selectedItemsSet,
  selectedItems,
  entries,
  enablePaste,
  handlePaste,
  handlePasteFromClipboard,
  handleCut,
  handleCopy,
  handleDownload,
  downloadToFolder,
  emit,
}: {
  isLoading: Ref<boolean>
  selectedPaths: Ref<string[]>
  basePath: Ref<string>
  selectedItemsSet: Ref<Set<IEntry>>
  selectedItems: Ref<IEntry[]>
  entries: Ref<IEntry[]>
  enablePaste: Ref<boolean>
  handlePaste: () => Promise<void>
  handlePasteFromClipboard: () => Promise<void>
  handleCut: () => void
  handleCopy: () => void
  handleDownload: () => Promise<void>
  downloadToFolder: () => Promise<void>
  emit: any
}) {
  const handleCreateFile = async (name = '', content = '') => {
    try {
      name
        = name
          || (await showInputPrompt({
            title: 'Create File',
            value: `${moment(new Date()).format('YYYYMMDD_HHmmss')}.txt`,
          }))
      isLoading.value = true
      await fsWebApi.uploadFile({
        path: normalizePath(`${basePath.value}/${name}`),
        file: generateTextFile(content, name),
      })
      emit('refresh')
    }
    finally {
      isLoading.value = false
    }
  }
  const handleCreateFolder = async () => {
    try {
      const name = await showInputPrompt({
        title: 'Create Folder',
        value: `${moment(new Date()).format('YYYYMMDD_HHmmss')}`,
      })
      isLoading.value = true
      await fsWebApi.createDir({ path: normalizePath(`${basePath.value}/${name}`) })
      emit('refresh')
    }
    finally {
      isLoading.value = false
    }
  }

  const handleRename = async () => {
    if (selectedItems.value.length !== 1) {
      return
    }

    const item = selectedItems.value[0]
    let name: string
    try {
      name = (await showInputPrompt({
        title: 'Rename',
        value: item.name,
        selectNameOnly: true,
      })).trim()
    }
    catch {
      return
    }

    if (!name || name === item.name) {
      return
    }

    let shouldKeepLoadingForRefresh = false
    try {
      isLoading.value = true
      await fsWebApi.renameEntry({
        fromPath: normalizePath(`${basePath.value}/${item.name}`),
        toPath: normalizePath(`${basePath.value}/${name}`),
      })
      const renamedItem: IEntry = {
        ...item,
        name,
        ext: item.isDirectory ? '' : getEntryExt(name),
      }
      selectedItemsSet.value = new Set(
        [...selectedItemsSet.value].map(selectedItem =>
          selectedItem.name === item.name ? renamedItem : selectedItem,
        ),
      )
      shouldKeepLoadingForRefresh = true
      emit('refresh')
    }
    finally {
      if (!shouldKeepLoadingForRefresh) {
        isLoading.value = false
      }
    }
  }
  const doDeleteSelected = async () => {
    try {
      isLoading.value = true

      await fsWebApi.deleteEntry({
        path: selectedPaths.value,
      })
    }
    finally {
      isLoading.value = false
      emit('refresh')
    }
  }
  const duplicateEntry = async (item: IEntry, destName: string) => {
    const sourcePath = normalizePath(`${basePath.value}/${item.name}`)
    const destPath = normalizePath(`${basePath.value}/${destName}`)
    const tempDir = normalizePath(`${basePath.value}/.dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

    await fsWebApi.createDir({ path: tempDir })
    try {
      await fsWebApi.copyPaste({
        fromPaths: [sourcePath],
        toPath: tempDir,
        isMove: false,
      })
      await fsWebApi.renameEntry({
        fromPath: normalizePath(`${tempDir}/${item.name}`),
        toPath: destPath,
      })
    }
    finally {
      await fsWebApi.deleteEntry({ path: [tempDir] }).catch(() => {})
    }
  }

  const handleDuplicate = async () => {
    if (!selectedItems.value.length)
      return

    const existingNames = new Set(entries.value.map(entry => entry.name))

    try {
      isLoading.value = true
      for (const item of selectedItems.value) {
        const destName = buildDuplicateName(item.name, existingNames)
        existingNames.add(destName)
        await duplicateEntry(item, destName)
      }
      emit('refresh')
    }
    finally {
      isLoading.value = false
    }
  }

  const handleCopyPaths = () => {
    if (!selectedPaths.value.length)
      return
    copyWithToast(selectedPaths.value.join('\n'))
  }

  const handleOpenInHostExplorer = async () => {
    if (!selectedPaths.value.length)
      return
    await fsWebApi.openInHostExplorer({ paths: selectedPaths.value })
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

  const handleOpen = () => {
    if (!selectedItems.value.length) {
      return
    }
    emit('open', {
      item: selectedItems.value[0],
    })
  }

  const ctxMenuOptions = computed((): MenuItem[] => {
    if (!selectedItems.value.length) {
      return [
        { label: 'Refresh', icon: 'mdi mdi-refresh', onClick: () => emit('refresh') },
        {
          label: 'Paste',
          icon: 'mdi mdi-content-paste',
          onClick: () => handlePaste(),
          disabled: !enablePaste.value,
          divided: true,
        },
        {
          label: 'Paste from Clipboard',
          icon: 'mdi mdi-clipboard-arrow-down-outline',
          onClick: () => handlePasteFromClipboard(),
        },
        { label: 'Download Current Folder', icon: 'mdi mdi-download', onClick: handleDownload },
        { label: 'Download Current Folder to...', icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder },
      ]
    }
    const isSingle = selectedItems.value.length === 1
    const selectedItem = selectedItems.value[0]
    const isFile = isSingle && !selectedItem.isDirectory
    const isDirectory = isSingle && selectedItem.isDirectory
    const openActionMeta = getOpenActionMeta(selectedItem)
    return [
      isSingle && {
        label: openActionMeta.label,
        icon: openActionMeta.icon,
        onClick: () => {
          handleOpen()
        },
      },
      isDirectory && {
        label: 'Open in new Tab',
        icon: 'mdi mdi-open-in-new',
        onClick: () => {
          emit('openPathInNewTab', normalizePath(`${basePath.value}/${selectedItem.name}`))
        },
      },
      isSingle
      && isFile && {
        label: 'Open With',
        icon: 'mdi mdi-open-in-app',
        children: [
          {
            label: 'Browser',
            icon: 'mdi mdi-open-in-new',
            onClick: () => {
              emit('open', {
                item: selectedItem,
                openWith: OpenWithEnum.Browser,
              })
            },
            divided: true,
          },
          // {
          //   label: 'Share',
          //   icon: 'mdi mdi-share-variant',
          //   onClick: () => {
          //     emit('open', {
          //       item: selectedItems.value[0],
          //       openWith: OpenWithEnum.Share,
          //     })
          //   },
          //   divided: true,
          // },
          ...AppList.map(app => ({
            label: app.name,
            icon: app.icon,
            onClick: () => {
              emit('open', {
                item: selectedItem,
                openWith: app.openWith,
              })
            },
          })),
          {
            divided: 'up',
            label: 'Set Default App',
            icon: 'mdi mdi-application-settings-outline',
            children: (() => {
              const ext = getFileExt(selectedItem.name)
              const current = ext ? (defaultAppMap.value[ext] ?? null) : null
              return [
                {
                  label: 'Default',
                  icon: current === null ? 'mdi mdi-check' : '',
                  onClick: () => setDefaultApp(ext, null),
                  divided: true,
                },
                {
                  label: 'Browser',
                  icon: current === OpenWithEnum.Browser ? 'mdi mdi-check' : 'mdi mdi-open-in-new',
                  onClick: () => setDefaultApp(ext, OpenWithEnum.Browser),
                },
                ...AppList.map(app => ({
                  label: app.name,
                  icon: current === app.openWith ? 'mdi mdi-check' : app.icon,
                  onClick: () => setDefaultApp(ext, app.openWith),
                })),
              ]
            })(),
          },
        ],
      },
      { label: 'Download', icon: 'mdi mdi-download', onClick: handleDownload },
      { label: 'Download to Folder...', icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder, divided: true },
      { label: 'Cut', icon: 'mdi mdi-content-cut', onClick: handleCut },
      { label: 'Copy', icon: 'mdi mdi-content-copy', onClick: handleCopy },
      { label: 'More', icon: '', divided: true, children: [

        {
          label: 'Open in Host Explorer',
          icon: 'mdi mdi-folder-outline',
          onClick: handleOpenInHostExplorer,
        },
        {
          label: 'Copy Path(s)',
          icon: 'mdi mdi-clipboard-text-outline',
          onClick: handleCopyPaths,
        },
        { label: 'Duplicate', icon: 'mdi mdi-content-duplicate', onClick: handleDuplicate },
      ] },
      isSingle && { label: 'Rename', icon: 'mdi mdi-rename', onClick: handleRename },
      {
        label: 'Delete',
        icon: 'mdi mdi-delete-forever-outline',
        onClick: confirmDelete,
      },
    ].filter(Boolean) as MenuItem[]
  })

  const handleShowCtxMenu = (
    item: IEntry | null,
    event: MouseEvent | KeyboardEvent,
    getMenuOptions: () => MenuItem[],
  ) => {
    if (!item) {
      selectedItemsSet.value.clear()
    }
    else {
      if (!selectedItemsSet.value.has(item)) {
        selectedItemsSet.value.clear()
        selectedItemsSet.value.add(item)
      }
    }

    const x = event instanceof MouseEvent ? event.clientX : window.innerWidth / 2
    const y = event instanceof MouseEvent ? event.clientY : window.innerHeight / 2

    ContextMenu.showContextMenu({
      x,
      y,
      ...menuThemeOptions,
      items: getMenuOptions(),
    })
  }

  const enableAction = computed(() => {
    return selectedItems.value.length > 0
  })
  return {
    handleOpen,
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
