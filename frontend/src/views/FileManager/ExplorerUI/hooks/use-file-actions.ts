import type { MenuItem } from '@canwdev/vgo-ui'
import type { Ref } from 'vue'
import type { MediaLinkTTL } from '@/api/filesystem'
import type { PluginInfo } from '@/api/plugins'
import type { IEntry } from '@/types/server'
import type { PropertiesTarget } from '@/views/Apps/properties'
import { ContextMenu } from '@canwdev/vgo-ui'
import dayjs from 'dayjs'
import { computed, h, ref } from 'vue'
import { listPlugins } from '@/api/plugins'
import { localSettingsStore } from '@/store'
import { serverCapabilities } from '@/store/capabilities'
import { createTask } from '@/store/tasks'
import { copyWithToast, downloadUrl } from '@/utils'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { confirmDeleteDialog } from '@/utils/delete-confirm'
import { fs } from '@/utils/fs'
import { resolveMenuIcons } from '@/utils/icons'
import { regImageFormat } from '@/utils/is'
import { AppList, defaultAppMap, getFileExt, OpenWithEnum, setDefaultApp } from '@/views/Apps/apps'
import PluginIcon from '@/views/Apps/PluginIcon.vue'
import { showProperties } from '@/views/Apps/properties'
import { defaultArchiveStem, matchesExtractExtension, separateArchiveName, showCompressDialog, startArchiveExtract } from '@/views/FileManager/ExplorerUI/archive-dialog.ts'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import { getLastDirName, joinPath, normalizePath, toWindowsPath } from '../../utils'
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
    label: defaultOpenApp ? $t('file_lite_i18n.open_with_0', [defaultOpenApp.name]) : $t('file_lite_i18n.open'),
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
  handlePaste: (targetPath?: string) => Promise<void>
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

  function propertyTargetOf(item: IEntry): PropertiesTarget {
    return {
      absPath: normalizePath(joinPath(basePath.value, item.name)),
      name: item.name,
      isDirectory: item.isDirectory,
      ext: item.ext,
      isLink: item.isLink,
      item,
    }
  }

  /** 未选中条目时的属性目标是当前文件夹。 */
  function currentFolderTarget(): PropertiesTarget {
    const absPath = normalizePath(basePath.value)
    return {
      absPath,
      name: getLastDirName(basePath.value) || absPath,
      isDirectory: true,
    }
  }

  /** 单选看单条明细，多选把选中项聚合成一个统计窗口，未选中时看当前文件夹。 */
  function handleShowProperties() {
    const items = selectedItems.value
    showProperties(items.length ? items.map(propertyTargetOf) : [currentFolderTarget()])
  }
  const handleCreateFile = async (name = '', content = '') => {
    try {
      name
        = name
          || (await showInputPrompt({
            title: $t('file_lite_i18n.create_file'),
            value: `${dayjs().format('YYYYMMDD_HHmmss')}.txt`,
            selectOnFocus: 'all',
          }))
      isLoading.value = true
      // 列表由服务端的 fs changed 补上，这里只负责等写入结束再选中新名字
      const written = await fs.writeText(basePath.value, name, content, { conflict: 'overwrite' })
      if (!written.ok) {
        window.$message?.warning(written.reason ?? $t('file_lite_i18n.this_location_is_read_only'))
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
        title: $t('file_lite_i18n.create_folder'),
        value: `${dayjs().format('YYYYMMDD_HHmmss')}`,
        selectOnFocus: 'all',
      })
      isLoading.value = true
      const target = normalizePath(joinPath(basePath.value, name))
      const guard = await fs.canWrite(target)
      if (!guard.ok) {
        window.$message?.warning(guard.reason ?? $t('file_lite_i18n.this_location_is_read_only'))
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
        title: $t('file_lite_i18n.rename'),
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
      window.$message?.error($t('file_lite_i18n.name_cannot_contain_a_path'))
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
      window.$message?.error(error instanceof Error ? error.message : $t('file_lite_i18n.failed'))
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
      window.$message?.error(e?.message || $t('file_lite_i18n.failed_to_start_the_task'))
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
      window.$message?.error(e?.message || $t('file_lite_i18n.failed_to_start_the_task'))
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

  /** 同一批路径的 Windows 写法：粘进资源管理器 / 命令行 / 播放器时才是能直接用的一条。 */
  const handleCopyWindowsPaths = () => {
    if (!selectedPaths.value.length)
      return
    copyWithToast(selectedPaths.value.map(toWindowsPath).join('\n'))
  }

  /**
   * 公开直链的有效期档位。
   *
   * `value` 是后端接受的取值（3h / 24h / 7d / 30d）；菜单显示的是「3 hours」这类
   * 文案，所以数字和单位分开存，单位复用 ticket_tier_* 那组文案（没有 days 的补一条）。
   */
  const mediaLinkTTLOptions: { value: MediaLinkTTL, count: number, unit: 'hours' | 'days' }[] = [
    { value: '3h', count: 3, unit: 'hours' },
    { value: '24h', count: 24, unit: 'hours' },
    { value: '7d', count: 7, unit: 'days' },
    { value: '30d', count: 30, unit: 'days' },
  ]

  /** 只有文件能生成直链；混选里的目录会被跳过。 */
  function mediaLinkTargets(): { path: string, name: string }[] {
    return selectedItems.value
      .filter(item => !item.isDirectory)
      .map(item => ({
        path: normalizePath(joinPath(basePath.value, item.name)),
        name: item.name,
      }))
  }

  const hasSelectedFiles = computed(() => selectedItems.value.some(item => !item.isDirectory))

  function mediaLinkTtlMenu(pick: (ttl: MediaLinkTTL) => void): MenuItem[] {
    return mediaLinkTTLOptions.map(option => ({
      label: $t(`file_lite_i18n.ticket_tier_${option.unit}`, [option.count]),
      onClick: () => pick(option.value),
    }))
  }

  /**
   * 直链是 `/api/media/…` 相对路径，这里拼上当前页面的 origin。
   *
   * 服务端不知道浏览器用的是 192.168.x.x 还是 localhost；用 location.origin 就等于
   * 把「用户此刻正在用的这个内网地址」带进链接，复制出去和写进 m3u 的都是同一个源。
   */
  function absoluteMediaUrl(url: string): string {
    return `${window.location.origin}${url}`
  }

  /**
   * 复制公开直链。
   *
   * 链接自带签名与过期时间，不需要 cookie，所以粘进 PotPlayer 就能播放；多选时一行
   * 一条，播放器可以整段粘进播放列表。
   */
  async function copyMediaLinks(ttl: MediaLinkTTL) {
    const targets = mediaLinkTargets()
    if (!targets.length) {
      return
    }
    try {
      const links = await fs.createMediaLinks(targets.map(target => target.path), ttl)
      if (!links.length) {
        return
      }
      copyWithToast(links.map(link => absoluteMediaUrl(link.url)).join('\n'))
    }
    catch {
      // 失败原因由 service 的响应拦截器统一提示
    }
  }

  /**
   * 把选中的文件下载成 m3u 播放列表。
   *
   * 播放器打开播放列表比逐条粘 URL 稳，`#EXTINF` 还能把文件名带进列表。列表里放的
   * 就是公开直链，因此它和链接同时过期。
   */
  async function downloadM3uPlaylist(ttl: MediaLinkTTL) {
    const targets = mediaLinkTargets()
    if (!targets.length) {
      return
    }
    try {
      const links = await fs.createMediaLinks(targets.map(target => target.path), ttl)
      const lines = ['#EXTM3U']
      targets.forEach((target, index) => {
        const link = links[index]
        if (!link) {
          return
        }
        lines.push(`#EXTINF:-1,${splitEntryName(target.name).baseName}`, absoluteMediaUrl(link.url))
      })
      const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'audio/x-mpegurl' })
      const objectUrl = URL.createObjectURL(blob)
      downloadUrl(objectUrl, m3uPlaylistName(targets))
      // 浏览器开始取数据之后才能释放；立即 revoke 会得到一个空文件。
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    }
    catch {
      // 同上
    }
  }

  function m3uPlaylistName(targets: { name: string }[]): string {
    if (targets.length === 1) {
      const stem = splitEntryName(targets[0].name).baseName.replace(/\.[^.]+$/, '')
      return `${stem || 'playlist'}.m3u`
    }
    return `${getLastDirName(basePath.value) || 'playlist'}.m3u`
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
    void confirmDeleteDialog(selectedItems.value.map(item => ({
      name: item.name,
      isDirectory: item.isDirectory,
    }))).then((confirmed) => {
      if (confirmed)
        void doDeleteSelected()
    })
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
      label: $t('file_lite_i18n.plugins'),
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
      const names = selectedItems.value.map(item => item.name)
      const choice = await showCompressDialog(defaultArchiveStem(names, getLastDirName(basePath.value) || ''))
      isLoading.value = true
      const password = choice.password || undefined
      if (choice.separate) {
        for (let i = 0; i < selectedItems.value.length; i++) {
          const fileName = separateArchiveName(choice.prefix, selectedItems.value[i].name, choice.ext)
          await createTask({
            kind: 'compress',
            fromPaths: [selectedPaths.value[i]],
            toPath: normalizePath(joinPath(basePath.value, fileName)),
            format: choice.format,
            password,
            onConflict: 'ask',
          })
        }
      }
      else {
        await createTask({
          kind: 'compress',
          fromPaths: [...selectedPaths.value],
          toPath: normalizePath(joinPath(basePath.value, choice.name)),
          format: choice.format,
          password,
          onConflict: 'ask',
        })
      }
    }
    catch (error: any) {
      if (error === 'cancel' || error === 'close')
        return
      window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
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
      window.$message?.error(error?.message || $t('file_lite_i18n.failed_to_start_the_task'))
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
          label: $t('file_lite_i18n.compress') + ELLIPSIS,
          icon: 'mdi mdi-archive-arrow-up-outline',
          onClick: () => { void compressSelection() },
        },
        {
          label: $t('file_lite_i18n.extract') + ELLIPSIS,
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
        { label: $t('file_lite_i18n.refresh'), icon: 'mdi mdi-refresh', shortcut: 'Ctrl+R', onClick: () => emit('refresh') },
        {
          label: $t('file_lite_i18n.paste'),
          icon: 'mdi mdi-content-paste',
          shortcut: 'Ctrl+V',
          onClick: () => handlePaste(),
          disabled: !enablePaste.value,
        },
        {
          label: $t('file_lite_i18n.paste_from_clipboard'),
          icon: 'mdi mdi-clipboard-arrow-down-outline',
          shortcut: 'Ctrl+Shift+V',
          onClick: () => handlePasteFromClipboard(),
          divided: true,
        },
        { label: $t('file_lite_i18n.download'), icon: 'mdi mdi-download', onClick: handleDownload },
        { label: $t('file_lite_i18n.download') + ELLIPSIS, icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder, divided: true },
        {
          label: $t('file_lite_i18n.properties'),
          icon: 'mdi mdi-information-outline',
          onClick: () => {
            showProperties([currentFolderTarget()])
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
          label: $t('file_lite_i18n.open_containing_folder'),
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
        label: $t('file_lite_i18n.open_in_new_tab'),
        icon: 'mdi mdi-open-in-new',
        onClick: () => {
          emit('openPathInNewTab', normalizePath(joinPath(basePath.value, selectedItem.name)))
        },
      },
      isSingle
      && isFile && {
        label: $t('file_lite_i18n.open_with'),
        icon: 'mdi mdi-open-in-app',
        children: [
          pluginsSubMenu(plugin => emit('open', {
            item: selectedItem,
            openWith: plugin.id,
          })),
          {
            label: $t('file_lite_i18n.browser'),
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
            label: $t('file_lite_i18n.set_default_app'),
            icon: 'mdi mdi-application-settings-outline',
            children: (() => {
              const ext = getFileExt(selectedItem.name)
              const current = ext ? (defaultAppMap.value[ext] ?? null) : null
              return [
                pluginsSubMenu(plugin => setDefaultApp(ext, plugin.id), current),
                {
                  label: $t('file_lite_i18n.default'),
                  icon: current === null ? 'mdi mdi-check' : '',
                  onClick: () => setDefaultApp(ext, null),
                  divided: true,
                },
                {
                  label: $t('file_lite_i18n.browser'),
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
      sevenZipMenu(),
      { label: $t('file_lite_i18n.download'), icon: 'mdi mdi-download', onClick: handleDownload },
      { label: $t('file_lite_i18n.download_to_folder') + ELLIPSIS, icon: 'mdi mdi-folder-download-outline', onClick: downloadToFolder, divided: true },
      // 选中文件夹时的粘贴是「粘贴到该文件夹」；快捷键不带上目标，始终是当前目录，所以这里不标快捷键
      isDirectory && {
        label: $t('file_lite_i18n.paste'),
        icon: 'mdi mdi-content-paste',
        onClick: () => handlePaste(normalizePath(joinPath(basePath.value, selectedItem.name))),
        disabled: !enablePaste.value,
      },
      { label: $t('file_lite_i18n.cut'), icon: 'mdi mdi-content-cut', shortcut: 'Ctrl+X', onClick: handleCut },
      { label: $t('file_lite_i18n.copy'), icon: 'mdi mdi-content-copy', shortcut: 'Ctrl+C', onClick: handleCopy },
      { label: $t('file_lite_i18n.more'), icon: '', divided: true, children: [

        {
          label: $t('file_lite_i18n.open_containing_folder'),
          icon: 'mdi mdi-folder-outline',
          onClick: handleOpenInHostExplorer,
        },
        { label: $t('file_lite_i18n.duplicate'), icon: 'mdi mdi-content-duplicate', onClick: handleDuplicate },
        {
          label: $t('file_lite_i18n.copy_path'),
          icon: 'mdi mdi-clipboard-text-outline',
          onClick: handleCopyPaths,
        },
        {
          // 平台名不翻译，和「复制路径」共用一条文案，避免为后缀再开一个 key。
          label: `${$t('file_lite_i18n.copy_path')} (Windows)`,
          icon: 'mdi mdi-clipboard-text-outline',
          onClick: handleCopyWindowsPaths,
        },
        isSingle && isFile && regImageFormat.test(selectedItem.name) && {
          label: 'Set as wallpaper',
          icon: 'mdi mdi-image',
          onClick: () => {
            const absPath = normalizePath(joinPath(basePath.value, selectedItem.name))
            localSettingsStore.value.wallpaperUrl = fs.url(absPath)
            localSettingsStore.value.themeStyle = 'translucent'
          },
        },
        // 外部播放器（PotPlayer 等）带不了 cookie，只能用签名直链：链接本身是凭据，
        // 到期即失效。目录没有直链，所以整组在纯目录选中时禁用。
        {
          label: $t('file_lite_i18n.copy_public_link'),
          icon: 'mdi mdi-link-variant',
          children: mediaLinkTtlMenu((ttl) => { void copyMediaLinks(ttl) }),
          disabled: !hasSelectedFiles.value,
        },
        {
          label: $t('file_lite_i18n.download_as_m3u_playlist'),
          icon: 'mdi mdi-playlist-music',
          children: mediaLinkTtlMenu((ttl) => { void downloadM3uPlaylist(ttl) }),
          disabled: !hasSelectedFiles.value,
        },
      ].filter(Boolean) as MenuItem[] },
      isSingle && { label: $t('file_lite_i18n.rename'), icon: 'mdi mdi-rename', shortcut: 'F2', onClick: handleRename },
      {
        label: $t('file_lite_i18n.delete'),
        icon: 'mdi mdi-delete-forever-outline',
        shortcut: 'Del',
        onClick: confirmDelete,
        divided: true,
      },
      {
        label: $t('file_lite_i18n.properties'),
        icon: 'mdi mdi-information-outline',
        onClick: handleShowProperties,
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
    handleShowProperties,
  }
}
