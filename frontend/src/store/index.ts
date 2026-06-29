import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'

export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, true, localStorage, {
  listenToStorageChanges: true,
})

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

function createDefaultSettingsStore() {
  return {
    isNativePlayer: false,
    previewSize: 3 * MB,
    themeMode: 'auto' as 'auto' | 'light' | 'dark',
    colorTheme: '',
    appSingleInstance: true,
    rememberLastMedia: false,
    showHidden: false,
    isGridView: false,
    iconSizeList: 16,
    iconSizeGrid: 48,
  }
}

type SettingsStoreState = ReturnType<typeof createDefaultSettingsStore>

function normalizeSettingsStoreValue(value: unknown): SettingsStoreState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultSettingsStore()
  }

  return {
    ...createDefaultSettingsStore(),
    ...value as Partial<SettingsStoreState>,
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

export { ensureSettingsStoreInitialized, settingsStore }
