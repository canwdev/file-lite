import { detectBrowserLocale, isAppLocale, setAppLocale } from '@/i18n'
import { settingsStore } from '@/store'

/**
 * 界面语言。
 *
 * 设置里选过的语言优先；还没设置过（首次访问，或还没登录拿不到设置）时用浏览器检测到的
 * 语言，检测到的值会在设置加载后被 `useRemoteSetting` 的 `onMissing` 写回服务端。
 */
export function useGlobalLanguage() {
  const browserLocale = detectBrowserLocale()

  watch(
    () => settingsStore.value.language,
    (locale) => {
      setAppLocale(isAppLocale(locale) ? locale : browserLocale)
    },
    { immediate: true },
  )
}
