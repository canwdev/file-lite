import type { MenuItem } from '@canwdev/vgo-ui'
import type { Ref } from 'vue'
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import { ContextMenu } from '@canwdev/vgo-ui'
import dayjs from 'dayjs'
import { computed, h, ref } from 'vue'
import { listPlugins } from '@/api/plugins'
import { serverCapabilities } from '@/store/capabilities'
import { createTask } from '@/store/tasks'
import { copyWithToast } from '@/utils'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { fs } from '@/utils/fs'
import { resolveMenuIcons } from '@/utils/icons'
import { AppList, defaultAppMap, getFileExt, OpenWithEnum, setDefaultApp } from '@/views/Apps/apps'
import PluginIcon from '@/views/Apps/PluginIcon.vue'
import { defaultArchiveName, matchesExtractExtension, showCompressDialog, startArchiveExtract } from '@/views/FileManager/ExplorerUI/archive-dialog.ts'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import { getLastDirName, joinPath, normalizePath } from '../../utils'
import { openProperties } from '../properties-window'
import { getDefaultOpenApp } from './use-opener'

function splitEntryName(name: string): { dirPrefix: string, baseName: string } {
  const slash = name.lastIndexOf('/')
  if (slash < 0)
    return { dirPrefix: '', baseName: name }
  return { dirPrefix: name.slice(0, slash + 1), baseName: name.slice(slash + 1) }
}

export function getOpenActionMeta(item: IEntry) {
  const defaultOpenApp = item.isDirectory ? null : getDefaultOpenApp(item)
  return {
    label: defaultOpenApp ? `Open with ${defaultOpenApp.name}` : 'Open',
    icon: defaultOpenApp?.icon || 'mdi mdi-folder-open-outline',
    plugin: defaultOpenApp?.plugin,
  }
}

export function useFileActions({
  isLoading,
  selectedPaths,
  basePath,
  selectedItemsSet,
  selectedItems,
  enablePaste,
  handlePaste,
  handlePasteFromClipboard,
  handleCut,
  handleCopy,
  handleDownload,
  downloadToFolder,
  emit,
  onEntryCreated,
  isBranchView,
  onOpenContainingFolder,
}: {
  isLoading: Ref<boolean>
  selectedPaths: Ref<string[]>
  basePath: Ref<string>
  selectedItemsSet: Ref<Set<IEntry>>
  selectedItems: Ref<IEntry[]>
  enablePaste: Ref<boolean>
  handlePaste: () => Promise<void>
  handlePasteFromClipboard: () => Promise<void>
  handleCut: () => void
  handleCopy: () => void
  handleDownload: () => Promise<void>
  downloadToFolder: () => Promise<void>
  emit: any
  onEntryCreated?: (name: string) => void
  isBranchView?: Ref<boolean>
  onOpenContainingFolder?: (path: string) => void
}) {
  function containingFolderOf(item: IEntry): string {
    const { dirPrefix } = splitEntryName(item.name)
    if (!dirPrefix)
      return normalizePath(basePath.value)
    return normalizePath(joinPath(basePath.value, dirPrefix.replace(/\/$/, '')))
  }
  const handleCreateFile = async (name = '', content = '') => {
    try {
      name
        = name
          || (await showInputPrompt({
            title: 'Create File',
            value: `${dayjs().format('YYYYMMDD_HHmmss')}.txt`,
            selectOnFocus: 'all',
          }))
      isLoading.value = true
      // 列表由服务端的 fs changed 补上，这里只负责等写入结束再选中新名字
      const written = await fs.writeText(basePath.value, name, content, { conflict: 'overwrite' })
      if (!written.ok) {
        window.$message?.warning(written.reason ?? 'This location is read-only')
        return
      }
      onEntryCreated?.(written.name ?? name)
    }
    finally {
      isLoading.value = false
    }
  }
  const handleCreateFolder = async () => {
    try {
      const name = await showInputPrompt({
        title: 'Create Folder',
        value: `${dayjs().format('YYYYMMDD_HHmmss')}`,
        selectOnFocus: 'all',
      })
      isLoading.value = true
      const target = normalizePath(joinPath(basePath.value, name))
      const guard = await fs.canWrite(target)
      if (!guard.ok) {
        window.$message?.warning(guard.reason ?? 'This location is read-only')
        return
      }
      await fs.mkdir(target)
      onEntryCreated?.(name)
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
    const { dirPrefix, baseName } = splitEntryName(item.name)
    let name: string
    try {
      name = (await showInputPrompt({
        title: 'Rename',
        value: baseName,
        selectOnFocus: 'stem',
      })).trim()
    }
    catch {
      return
    }

    if (!name || name === baseName) {
      return
    }
    if (name.includes('/') || name.includes('\\')) {
      window.$message?.error('Name cannot contain a path')
      return
    }

    try {
      isLoading.value = true
      const nextName = `${dirPrefix}${name}`
      const fromPath = normalizePath(joinPath(basePath.value, item.name))
      const toPath = normalizePath(joinPath(basePath.value, nextName))
      await fs.rename(fromPath, toPath)
      onEntryCreated?.(nextName)
    }
    catch (error) {
      // 重命名可能被服务端拒绝（只读、目标被占用…）：如实提示，别静默失败
      window.$message?.error(error instanceof Error ? error.message : 'Rename failed')
    }
    finally {
      isLoading.value = false
    }
  }
  // 删除改为服务端异步任务：可取消、有进度，目录刷新由 fs changed 通知驱动
  const doDeleteSelected = async () => {
    if (!selectedPaths.value.length) {
      return
    }
    isLoading.value = true
    try {
      await createTask({
        kind: 'delete',
        fromPaths: [...selectedPaths.value],
      })
    }
    catch (e: any) {
      window.$message?.error(e?.message || 'Failed to start the task')
    }
    finally {
      isLoading.value = false
    }
  }
  const handleDuplicate = async () => {
    if (!selectedItems.value.length)
      return

    isLoading.value = true
    try {
      await createTask({
        kind: 'duplicate',
        fromPaths: [...selectedPaths.value],
        toPath: basePath.value,
      })
    }
    catch (e: any) {
      window.$message?.error(e?.message || 'Failed to start the task')
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
    await fs.openInHostExplorer([...selectedPaths.value])
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

  const openWithPlugins = ref<PluginInfo[]>([])

  function pluginsSubMenu(onPick: (plugin: PluginInfo) => void, currentId?: string | null): MenuItem | null {
    const plugins = openWithPlugins.value.filter(plugin => plugin.openWith.length > 0)
    if (!plugins.length)
      return null
    return {
      label: 'Plugins',
      icon: 'mdi mdi-puzzle-outline',
      divided: true,
      children: plugins.map(plugin => ({
        label: plugin.name,
        icon: currentId === plugin.id ? 'mdi mdi-check' : h(PluginIcon, { plugin }),
        onClick: () => onPick(plugin),
      })),
    }
  }

  function canExtractSelection() {
    const extensions = serverCapabilities.value.archiveExtractExtensions
    const items = selectedItems.value
    if (!items.length || !extensions.length)
      return false
    return items.every(item => !item.isDirectory && matchesExtractExtension(item.name, extensions))
  }

  async function compressSelection() {
    if (!selectedItems.value.length)
      return
    try {
      const ext = serverCapabilities.value.archiveCompressFormats[0]?.ext || '.zip'
      const choice = await showCompressDialog(defaultArchiveName(selectedItems.value.map(item => item.name), ext))
      isLoading.value = true
      await createTask({
        kind: 'compress',
        fromPaths: [...selectedPaths.value],
        toPath: normalizePath(joinPath(basePath.value, choice.name)),
        format: choice.format,
        password: choice.password || undefined,
        onConflict: 'ask',
      })
    }
    catch (error: any) {
      if (error === 'cancel' || error === 'close')
        return
      window.$message?.error(error?.message || 'Failed to start the task')
    }
    finally {
      isLoading.value = false
    }
  }

  async function extractSelection() {
    if (!canExtractSelection())
      return
    try {
      await startArchiveExtract(
        [...selectedPaths.value],
        selectedItems.value.map(item => item.name),
        basePath.value,
        (busy) => { isLoading.value = busy },
      )
    }
    catch (error: any) {
      if (error === 'cancel' || error === 'close')
        return
      window.$message?.error(error?.message || 'Failed to start the task')
    }
    finally {
      isLoading.value = false
    }
  }

  function sevenZipMenu(): MenuItem | null {
    if (!serverCapabilities.value.archive)
      return null
    return {
      label: '7-Zip',
      icon: 'mdi mdi-zip-box',
      divided: true,
      children: [
        {
          label: 'Compress...',
          icon: 'mdi mdi-archive-arrow-up-outline',
          onClick: () => { void compressSelection() },
        },
        {
          label: 'Extract...',
          icon: 'mdi mdi-archive-arrow-down-outline',
          disabled: !canExtractSelection(),
          onClick: () => { void extractSelection() },
        },
      ],
    }
  }

  const ctxMenuOptions = computed((): MenuItem[] => {
    if (!selectedItems.value.length) {
      return [
        { label: 'Refresh', icon: 'mdi mdi-refresh', shortcut: 'Ctrl+R', onClick: () => emit('refresh') },
        {
          label: 'Paste',
          icon: 'mdi mdi-content-paste',
          shortcut: 'Ctrl+V',
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
        { label: 'Download Current Folder to...', icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder, divided: true },
        {
          label: 'Properties',
          icon: 'mdi mdi-information-outline',
          onClick: () => {
            openProperties({
              absPath: basePath.value,
              name: getLastDirName(basePath.value) || basePath.value,
              isDirectory: true,
            })
          },
        },
      ]
    }
    const isSingle = selectedItems.value.length === 1
    const selectedItem = selectedItems.value[0]
    const isFile = isSingle && !selectedItem.isDirectory
    const isDirectory = isSingle && selectedItem.isDirectory
    const openActionMeta = getOpenActionMeta(selectedItem)
    const branchOpenContaining = isBranchView?.value && selectedItem
      ? {
          label: 'Open Containing Folder',
          icon: 'mdi mdi-folder-open-outline',
          onClick: () => onOpenContainingFolder?.(containingFolderOf(selectedItem)),
          divided: true,
        }
      : null
    return [
      branchOpenContaining,
      isSingle && {
        label: openActionMeta.label,
        icon: openActionMeta.plugin ? h(PluginIcon, { plugin: openActionMeta.plugin }) : openActionMeta.icon,
        shortcut: 'Enter',
        onClick: () => {
          handleOpen()
        },
      },
      isDirectory && {
        label: 'Open in new Tab',
        icon: 'mdi mdi-open-in-new',
        onClick: () => {
          emit('openPathInNewTab', normalizePath(joinPath(basePath.value, selectedItem.name)))
        },
      },
      isSingle
      && isFile && {
        label: 'Open With',
        icon: 'mdi mdi-open-in-app',
        children: [
          pluginsSubMenu(plugin => emit('open', {
            item: selectedItem,
            openWith: plugin.id,
          })),
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
                pluginsSubMenu(plugin => setDefaultApp(ext, plugin.id), current),
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
              ].filter(Boolean) as MenuItem[]
            })(),
          },
        ].filter(Boolean) as MenuItem[],
      },
      { label: 'Download', icon: 'mdi mdi-download', onClick: handleDownload },
      { label: 'Download to Folder...', icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder, divided: true },
      sevenZipMenu(),
      { label: 'Cut', icon: 'mdi mdi-content-cut', shortcut: 'Ctrl+X', onClick: handleCut },
      { label: 'Copy', icon: 'mdi mdi-content-copy', shortcut: 'Ctrl+C', onClick: handleCopy },
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
      isSingle && { label: 'Rename', icon: 'mdi mdi-rename', shortcut: 'F2', onClick: handleRename },
      {
        label: 'Delete',
        icon: 'mdi mdi-delete-forever-outline',
        shortcut: 'Del',
        onClick: confirmDelete,
        divided: true,
      },
      isSingle && {
        label: 'Properties',
        icon: 'mdi mdi-information-outline',
        onClick: () => {
          openProperties({
            absPath: normalizePath(joinPath(basePath.value, selectedItem.name)),
            name: selectedItem.name,
            isDirectory: selectedItem.isDirectory,
            ext: selectedItem.ext,
            isLink: selectedItem.isLink,
            item: selectedItem,
          })
        },
      },
    ].filter(Boolean) as MenuItem[]
  })

  async function loadOpenWithPlugins() {
    openWithPlugins.value = await listPlugins().catch(() => [])
  }

  const handleShowCtxMenu = async (
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

    await loadOpenWithPlugins()

    const x = event instanceof MouseEvent ? event.clientX : window.innerWidth / 2
    const y = event instanceof MouseEvent ? event.clientY : window.innerHeight / 2

    const items = resolveMenuIcons(getMenuOptions())
    if (!items.length) {
      return
    }

    ContextMenu.showContextMenu({
      x,
      y,
      ...baseContextMenuOptions,
      items,
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
    loadOpenWithPlugins,
    enableAction,
  }
}
