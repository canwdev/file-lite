import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'
import { useRemoteSetting } from '@/hooks/use-remote-setting'
import { authToken } from './auth'

export const rememberAuth = useStorage(LsKeys.REMEMBER_AUTH, true, localStorage, {
  listenToStorageChanges: true,
})

const MB = 1024 * 1024

export const PREVIEW_SIZE_UNLIMITED = -1

export const previewSizeOptions = [
  { label: 'Disabled', value: 0 },
  { label: '≤ 3 MB', value: 3 * MB },
  { label: '≤ 6 MB', value: 6 * MB },
  { label: '≤ 20 MB', value: 20 * MB },
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
