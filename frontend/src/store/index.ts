import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'

/** 需要跨设备同步的设置 */
function createDefaultSettingsStore() {
  return {
    themeMode: 'auto' as 'auto' | 'light' | 'dark',
    colorTheme: '',
    rememberLastMedia: false,
    /** 自定义前缀；空则显示原始标题，有值则为「自定义 - 原始标题」 */
    pageTitle: '',
  }
}

type SettingsStoreState = ReturnType<typeof createDefaultSettingsStore>

function normalizeSettingsStoreValue(value: unknown): SettingsStoreState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultSettingsStore()
  }

  const defaults = createDefaultSettingsStore()
  const raw = value as Record<string, unknown>
  return {
    themeMode: (raw.themeMode === 'auto' || raw.themeMode === 'light' || raw.themeMode === 'dark')
      ? raw.themeMode
      : defaults.themeMode,
    colorTheme: typeof raw.colorTheme === 'string' ? raw.colorTheme : defaults.colorTheme,
    rememberLastMedia: Boolean(raw.rememberLastMedia ?? defaults.rememberLastMedia),
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle : defaults.pageTitle,
  }
}

const {
  state: settingsStore,
  ensureInitialized: ensureSettingsStoreInitialized,
} = useRemoteSetting<SettingsStoreState>({
  key: LsKeys.SETTINGS_STORE,
  createDefaultValue: createDefaultSettingsStore,
  normalize: normalizeSettingsStoreValue,
  autoInitialize: false,
  throwOnInitError: true,
})

/** 仅本机持久化的 UI / 设备偏好 */
function createDefaultLocalSettingsStore() {
  return {
    isNativePlayer: false,
    openAppWithFilteredList: false,
    /** 减少动画和过渡效果 */
    reduceMotion: false,
    /** 左侧导航（explorer-sidebar）是否显示 */
    sidebarVisible: true,
    /** 默认显示隐藏文件：点的名字大多是配置目录，藏起来反而要来回切。 */
    showHidden: true,
    /** 排序后是否把文件夹排在文件前面 */
    sortFoldersFirst: true,
    isGridView: false,
    iconSizeList: 16,
    iconSizeGrid: 48,
    /**
     * 整体关闭内容预览（图片缩略图 / 音频封面 / 视频封面 / 文件夹内容预览）。
     * 只藏预览，不清缩略图缓存；清缓存在 Settings 里单独一项。
     * 光盘卷不看这个开关，预览始终关闭。
     */
    disablePreview: false,
  }
}

export type LocalSettingsStoreState = ReturnType<typeof createDefaultLocalSettingsStore>

export const localSettingsStore = useStorage<LocalSettingsStoreState>(
  LsKeys.LOCAL_SETTINGS_STORE,
  createDefaultLocalSettingsStore(),
  localStorage,
  {
    mergeDefaults: true,
    listenToStorageChanges: false,
  },
)

export { ensureSettingsStoreInitialized, settingsStore }
