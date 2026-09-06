import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { Component, VNode } from 'vue'
import { h } from 'vue'
import MdiAlertCircle from '~icons/mdi/alert-circle'
import MdiApplicationSettingsOutline from '~icons/mdi/application-settings-outline'
import MdiArrowDownBoldCircleOutline from '~icons/mdi/arrow-down-bold-circle-outline'
import MdiArrowDownThinCircleOutline from '~icons/mdi/arrow-down-thin-circle-outline'
import MdiArrowLeft from '~icons/mdi/arrow-left'
import MdiArrowRight from '~icons/mdi/arrow-right'
import MdiArrowUp from '~icons/mdi/arrow-up'
import MdiArrowUpBoldCircleOutline from '~icons/mdi/arrow-up-bold-circle-outline'
import MdiArrowUpThinCircleOutline from '~icons/mdi/arrow-up-thin-circle-outline'
import MdiBroom from '~icons/mdi/broom'
import MdiCheck from '~icons/mdi/check'
import MdiCheckAll from '~icons/mdi/check-all'
import MdiCheckCircle from '~icons/mdi/check-circle'
import MdiCheckDecagramOutline from '~icons/mdi/check-decagram-outline'
import MdiCheckboxBlankCircle from '~icons/mdi/checkbox-blank-circle'
import MdiCheckboxBlankOutline from '~icons/mdi/checkbox-blank-outline'
import MdiCheckboxIntermediate from '~icons/mdi/checkbox-intermediate'
import MdiCheckboxMarked from '~icons/mdi/checkbox-marked'
import MdiCheckboxMarkedCircle from '~icons/mdi/checkbox-marked-circle'
import MdiChevronDown from '~icons/mdi/chevron-down'
import MdiChevronRight from '~icons/mdi/chevron-right'
import MdiChevronUp from '~icons/mdi/chevron-up'
import MdiClipboard from '~icons/mdi/clipboard'
import MdiClipboardArrowDownOutline from '~icons/mdi/clipboard-arrow-down-outline'
import MdiClipboardTextOutline from '~icons/mdi/clipboard-text-outline'
import MdiClose from '~icons/mdi/close'
import MdiCloudSync from '~icons/mdi/cloud-sync'
import MdiCodeJson from '~icons/mdi/code-json'
import MdiCog from '~icons/mdi/cog'
import MdiCompareVertical from '~icons/mdi/compare-vertical'
import MdiContentCopy from '~icons/mdi/content-copy'
import MdiContentCut from '~icons/mdi/content-cut'
import MdiContentDuplicate from '~icons/mdi/content-duplicate'
import MdiContentPaste from '~icons/mdi/content-paste'
import MdiCrosshairsGps from '~icons/mdi/crosshairs-gps'
import MdiDeleteForeverOutline from '~icons/mdi/delete-forever-outline'
import MdiDeleteSweep from '~icons/mdi/delete-sweep'
import MdiDotsVertical from '~icons/mdi/dots-vertical'
import MdiDownload from '~icons/mdi/download'
import MdiDownloadOutline from '~icons/mdi/download-outline'
import MdiEyeOffOutline from '~icons/mdi/eye-off-outline'
import MdiEyeOutline from '~icons/mdi/eye-outline'
import MdiFastForward5 from '~icons/mdi/fast-forward-5'
import MdiFileAlertOutline from '~icons/mdi/file-alert-outline'
import MdiFileDocumentOutline from '~icons/mdi/file-document-outline'
import MdiFileDocumentPlusOutline from '~icons/mdi/file-document-plus-outline'
import MdiFileImage from '~icons/mdi/file-image'
import MdiFileQuestion from '~icons/mdi/file-question'
import MdiFileUploadOutline from '~icons/mdi/file-upload-outline'
import MdiFileVideoOutline from '~icons/mdi/file-video-outline'
import MdiFilterCheckOutline from '~icons/mdi/filter-check-outline'
import MdiFilterOffOutline from '~icons/mdi/filter-off-outline'
import MdiFilterOutline from '~icons/mdi/filter-outline'
import MdiFilterRemoveOutline from '~icons/mdi/filter-remove-outline'
import MdiFlagCheckered from '~icons/mdi/flag-checkered'
import MdiFlagOutline from '~icons/mdi/flag-outline'
import MdiFolder from '~icons/mdi/folder'
import MdiFolderDownloadOutline from '~icons/mdi/folder-download-outline'
import MdiFolderOpenOutline from '~icons/mdi/folder-open-outline'
import MdiFolderOutline from '~icons/mdi/folder-outline'
import MdiFolderPlusOutline from '~icons/mdi/folder-plus-outline'
import MdiFolderPoundOutline from '~icons/mdi/folder-pound-outline'
import MdiFolderUploadOutline from '~icons/mdi/folder-upload-outline'
import MdiFormatTitle from '~icons/mdi/format-title'
import MdiGithub from '~icons/mdi/github'
import MdiHarddisk from '~icons/mdi/harddisk'
import MdiHome from '~icons/mdi/home'
import MdiHomeAccount from '~icons/mdi/home-account'
import MdiImage from '~icons/mdi/image'
import MdiImageMultipleOutline from '~icons/mdi/image-multiple-outline'
import MdiImageOffOutline from '~icons/mdi/image-off-outline'
import MdiImageSearch from '~icons/mdi/image-search'
import MdiIpNetwork from '~icons/mdi/ip-network'
import MdiKeyOutline from '~icons/mdi/key-outline'
import MdiLanguageCss3 from '~icons/mdi/language-css3'
import MdiLanguageHtml5 from '~icons/mdi/language-html5'
import MdiLanguageJavascript from '~icons/mdi/language-javascript'
import MdiLanguageMarkdownOutline from '~icons/mdi/language-markdown-outline'
import MdiLinkVariant from '~icons/mdi/link-variant'
import MdiLoading from '~icons/mdi/loading'
import MdiLogout from '~icons/mdi/logout'
import MdiMagnify from '~icons/mdi/magnify'
import MdiMenu from '~icons/mdi/menu'
import MdiMenuDown from '~icons/mdi/menu-down'
import MdiMenuUp from '~icons/mdi/menu-up'
import MdiMicrosoftWindows from '~icons/mdi/microsoft-windows'
import MdiMinus from '~icons/mdi/minus'
import MdiMonitorEye from '~icons/mdi/monitor-eye'
import MdiMusicCircle from '~icons/mdi/music-circle'
import MdiMusicCircleOutline from '~icons/mdi/music-circle-outline'
import MdiMusicNote from '~icons/mdi/music-note'
import MdiOpenInApp from '~icons/mdi/open-in-app'
import MdiOpenInNew from '~icons/mdi/open-in-new'
import MdiPause from '~icons/mdi/pause'
import MdiPlay from '~icons/mdi/play'
import MdiPlayCircle from '~icons/mdi/play-circle'
import MdiPlaylistMusic from '~icons/mdi/playlist-music'
import MdiPlus from '~icons/mdi/plus'
import MdiRayEnd from '~icons/mdi/ray-end'
import MdiRayStart from '~icons/mdi/ray-start'
import MdiRefresh from '~icons/mdi/refresh'
import MdiReload from '~icons/mdi/reload'
import MdiRename from '~icons/mdi/rename'
import MdiRepeat from '~icons/mdi/repeat'
import MdiRepeatOnce from '~icons/mdi/repeat-once'
import MdiRepeatVariant from '~icons/mdi/repeat-variant'
import MdiRewind5 from '~icons/mdi/rewind-5'
import MdiShareVariant from '~icons/mdi/share-variant'
import MdiShuffle from '~icons/mdi/shuffle'
import MdiShuffleDisabled from '~icons/mdi/shuffle-disabled'
import MdiSkipNext from '~icons/mdi/skip-next'
import MdiSkipNextCircleOutline from '~icons/mdi/skip-next-circle-outline'
import MdiSkipPrevious from '~icons/mdi/skip-previous'
import MdiSkipPreviousCircleOutline from '~icons/mdi/skip-previous-circle-outline'
import MdiSortAlphabeticalVariant from '~icons/mdi/sort-alphabetical-variant'
import MdiSpeedometer from '~icons/mdi/speedometer'
import MdiStar from '~icons/mdi/star'
import MdiStarOffOutline from '~icons/mdi/star-off-outline'
import MdiStarOutline from '~icons/mdi/star-outline'
import MdiTextBoxEdit from '~icons/mdi/text-box-edit'
import MdiTextBoxOutline from '~icons/mdi/text-box-outline'
import MdiThemeLightDark from '~icons/mdi/theme-light-dark'
import MdiUpload from '~icons/mdi/upload'
import MdiUploadOutline from '~icons/mdi/upload-outline'
import MdiVideoOutline from '~icons/mdi/video-outline'
import MdiViewCarouselOutline from '~icons/mdi/view-carousel-outline'
import MdiViewGridOutline from '~icons/mdi/view-grid-outline'
import MdiViewListOutline from '~icons/mdi/view-list-outline'
import MdiVolumeHigh from '~icons/mdi/volume-high'
import MdiVolumeVariantOff from '~icons/mdi/volume-variant-off'
import MdiVuejs from '~icons/mdi/vuejs'
import MdiWifi from '~icons/mdi/wifi'
import MdiZipBox from '~icons/mdi/zip-box'

export const mdiIconRegistry: Record<string, Component> = {
  'file-question': MdiFileQuestion,
  'folder': MdiFolder,
  'zip-box': MdiZipBox,
  'file-image': MdiFileImage,
  'music-circle-outline': MdiMusicCircleOutline,
  'file-video-outline': MdiFileVideoOutline,
  'microsoft-windows': MdiMicrosoftWindows,
  'vuejs': MdiVuejs,
  'code-json': MdiCodeJson,
  'language-html5': MdiLanguageHtml5,
  'language-css3': MdiLanguageCss3,
  'language-javascript': MdiLanguageJavascript,
  'language-markdown-outline': MdiLanguageMarkdownOutline,
  'text-box-outline': MdiTextBoxOutline,
  'folder-open-outline': MdiFolderOpenOutline,
  'open-in-new': MdiOpenInNew,
  'home-account': MdiHomeAccount,
  'folder-pound-outline': MdiFolderPoundOutline,
  'folder-outline': MdiFolderOutline,
  'harddisk': MdiHarddisk,
  'star-off-outline': MdiStarOffOutline,
  'arrow-left': MdiArrowLeft,
  'arrow-right': MdiArrowRight,
  'arrow-up': MdiArrowUp,
  'refresh': MdiRefresh,
  'star': MdiStar,
  'star-outline': MdiStarOutline,
  'play': MdiPlay,
  'close': MdiClose,
  'checkbox-marked': MdiCheckboxMarked,
  'checkbox-blank-outline': MdiCheckboxBlankOutline,
  'open-in-app': MdiOpenInApp,
  'checkbox-intermediate': MdiCheckboxIntermediate,
  'menu-down': MdiMenuDown,
  'menu-up': MdiMenuUp,
  'file-document-plus-outline': MdiFileDocumentPlusOutline,
  'folder-plus-outline': MdiFolderPlusOutline,
  'file-upload-outline': MdiFileUploadOutline,
  'folder-upload-outline': MdiFolderUploadOutline,
  'sort-alphabetical-variant': MdiSortAlphabeticalVariant,
  'download': MdiDownload,
  'folder-download-outline': MdiFolderDownloadOutline,
  'content-cut': MdiContentCut,
  'content-copy': MdiContentCopy,
  'content-paste': MdiContentPaste,
  'rename': MdiRename,
  'delete-forever-outline': MdiDeleteForeverOutline,
  'eye-outline': MdiEyeOutline,
  'eye-off-outline': MdiEyeOffOutline,
  'check-all': MdiCheckAll,
  'dots-vertical': MdiDotsVertical,
  'filter-remove-outline': MdiFilterRemoveOutline,
  'view-grid-outline': MdiViewGridOutline,
  'view-list-outline': MdiViewListOutline,
  'filter-outline': MdiFilterOutline,
  'chevron-down': MdiChevronDown,
  'chevron-right': MdiChevronRight,
  'reload': MdiReload,
  'cloud-sync': MdiCloudSync,
  'alert-circle': MdiAlertCircle,
  'check-circle': MdiCheckCircle,
  'loading': MdiLoading,
  'compare-vertical': MdiCompareVertical,
  'content-duplicate': MdiContentDuplicate,
  'clipboard-arrow-down-outline': MdiClipboardArrowDownOutline,
  'clipboard-text-outline': MdiClipboardTextOutline,
  'application-settings-outline': MdiApplicationSettingsOutline,
  'check': MdiCheck,
  'share-variant': MdiShareVariant,
  'clipboard': MdiClipboard,
  'speedometer': MdiSpeedometer,
  'theme-light-dark': MdiThemeLightDark,
  'cog': MdiCog,
  'image-search': MdiImageSearch,
  'filter-check-outline': MdiFilterCheckOutline,
  'filter-off-outline': MdiFilterOffOutline,
  'format-title': MdiFormatTitle,
  'image-multiple-outline': MdiImageMultipleOutline,
  'broom': MdiBroom,
  'monitor-eye': MdiMonitorEye,
  'github': MdiGithub,
  'logout': MdiLogout,
  'view-carousel-outline': MdiViewCarouselOutline,
  'text-box-edit': MdiTextBoxEdit,
  'image': MdiImage,
  'music-circle': MdiMusicCircle,
  'play-circle': MdiPlayCircle,
  'file-document-outline': MdiFileDocumentOutline,
  'shuffle-disabled': MdiShuffleDisabled,
  'shuffle': MdiShuffle,
  'repeat': MdiRepeat,
  'repeat-variant': MdiRepeatVariant,
  'repeat-once': MdiRepeatOnce,
  'music-note': MdiMusicNote,
  'video-outline': MdiVideoOutline,
  'skip-previous': MdiSkipPrevious,
  'rewind-5': MdiRewind5,
  'pause': MdiPause,
  'fast-forward-5': MdiFastForward5,
  'skip-next': MdiSkipNext,
  'volume-high': MdiVolumeHigh,
  'volume-variant-off': MdiVolumeVariantOff,
  'playlist-music': MdiPlaylistMusic,
  'magnify': MdiMagnify,
  'crosshairs-gps': MdiCrosshairsGps,
  'chevron-up': MdiChevronUp,
  'minus': MdiMinus,
  'plus': MdiPlus,
  'check-decagram-outline': MdiCheckDecagramOutline,
  'image-off-outline': MdiImageOffOutline,
  'flag-checkered': MdiFlagCheckered,
  'flag-outline': MdiFlagOutline,
  'arrow-up-thin-circle-outline': MdiArrowUpThinCircleOutline,
  'arrow-down-thin-circle-outline': MdiArrowDownThinCircleOutline,
  'skip-next-circle-outline': MdiSkipNextCircleOutline,
  'skip-previous-circle-outline': MdiSkipPreviousCircleOutline,
  'arrow-down-bold-circle-outline': MdiArrowDownBoldCircleOutline,
  'arrow-up-bold-circle-outline': MdiArrowUpBoldCircleOutline,
  'file-alert-outline': MdiFileAlertOutline,
  'link-variant': MdiLinkVariant,
  'delete-sweep': MdiDeleteSweep,
  'ip-network': MdiIpNetwork,
  'home': MdiHome,
  'wifi': MdiWifi,
  'key-outline': MdiKeyOutline,
  'menu': MdiMenu,
  'checkbox-blank-circle': MdiCheckboxBlankCircle,
  'checkbox-marked-circle': MdiCheckboxMarkedCircle,
  'ray-start': MdiRayStart,
  'ray-end': MdiRayEnd,
  'upload': MdiUpload,
  'upload-outline': MdiUploadOutline,
  'download-outline': MdiDownloadOutline,
}
/**
 * 把任意图标字符串归一化为注册表 key（去掉 'mdi ' 基类、'mdi-' 前缀及无关修饰类）。
 * 输入示例: 'mdi mdi-folder-open-outline' | 'mdi-folder-open-outline' | 'folder-open-outline' | ''。
 */
export function normalizeMdiName(cls?: string | null): string {
  if (!cls)
    return ''
  const tokens = cls.trim().split(/\s+/)
  const prefixed = tokens.find(t => t.startsWith('mdi-') && t.length > 4)
  if (prefixed)
    return prefixed.slice(4)
  // 兼容裸图标名（如 'star' / 'file-question'），排除 'mdi' 基类残留
  const bare = tokens.find(t => t && t !== 'mdi' && !t.startsWith('mdi'))
  return bare ?? ''
}

/** 注册表不存在时兜底图标 */
const MdiFallback = MdiFileQuestion

export function mdiComponentFor(name: string): Component {
  return mdiIconRegistry[name] ?? MdiFallback
}

/** 解析任意图标字符串 -> 组件；空串/未知返回 null（调用方不渲染） */
export function resolveMdiComponent(cls?: string | null): Component | null {
  const name = normalizeMdiName(cls)
  return name ? mdiComponentFor(name) : null
}

/** 上下文菜单 icon 字段（string -> VNode），空串返回 undefined（菜单不显示图标） */
export function mdiMenuIcon(cls?: string | null, attrs?: Record<string, unknown>): VNode | undefined {
  const name = normalizeMdiName(cls)
  if (!name)
    return undefined
  return h(mdiComponentFor(name), attrs)
}

/** 深遍历菜单项，把 string 型 icon 转为 VNode（@imengyu/vue3-context-menu 的 icon 支持 VNode） */
export function resolveMenuIcons(items: MenuItem[]): MenuItem[] {
  for (const item of items) {
    if (!item)
      continue
    if (typeof item.icon === 'string')
      item.icon = mdiMenuIcon(item.icon)
    const children = (item as { children?: unknown }).children
    if (Array.isArray(children))
      resolveMenuIcons(children as MenuItem[])
  }
  return items
}
