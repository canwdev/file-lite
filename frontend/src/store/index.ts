import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'

const MB = 1024 * 1024

export const PREVIEW_SIZE_UNLIMITED = -1

export const previewSizeOptions = [
  { label: 'Disabled', value: 0 },
  { label: '≤ 2 MB', value: 2 * MB }, // 满足绝大多数压缩后的 Web 图片
  { label: '≤ 5 MB', value: 5 * MB }, // 绝大多数手机直拍原图
  { label: '≤ 10 MB', value: 10 * MB }, // 高清单反照片或大单页 GIF
  { label: '≤ 20 MB', value: 20 * MB }, // 极限挡位，照顾专业需求
  { label: 'Unlimited', value: PREVIEW_SIZE_UNLIMITED },
] as const

export function getPreviewSizeLabel(value: number): string {
  return previewSizeOptions.find(item => item.value === value)?.label ?? '≤ 3 MB'
}

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
    previewSize: 3 * MB,
    appSingleInstance: true,
    /** 墨水屏模式：强制亮色、禁用动画/大阴影，降低刷新负担 */
    einkMode: false,
    showHidden: false,
    isGridView: false,
    iconSizeList: 16,
    iconSizeGrid: 48,
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
