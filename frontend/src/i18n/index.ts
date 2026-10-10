import type { Composer } from 'vue-i18n'
import { createI18n } from 'vue-i18n'

/**
 * 所有文案都挂在 `file_lite_i18n` 这一个命名空间下，且只有一层：
 * `file_lite_i18n.some_key`。新增文案直接改 `locales/en-US/index.json`，
 * 同样的意思优先复用已有条目。
 */
export const I18N_NAMESPACE = 'file_lite_i18n'

export const DEFAULT_LOCALE = 'en-US'

/** 语言下拉用的显示名：语言自称，不走翻译。 */
export const localeOptions = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
] as const

export type AppLocale = typeof localeOptions[number]['value']

const supportedLocales: AppLocale[] = localeOptions.map(option => option.value)

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (supportedLocales as string[]).includes(value)
}

/**
 * 挑一个最接近浏览器偏好的支持语言。
 *
 * 只按主语言匹配（`zh-Hans-CN`、`zh-TW` 都算 `zh-CN`），匹配不到回退英语。
 */
export function detectBrowserLocale(): AppLocale {
  const candidates = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .filter(candidate => typeof candidate === 'string' && candidate)
  for (const candidate of candidates) {
    const tag = candidate.toLowerCase()
    if (tag.startsWith('zh'))
      return 'zh-CN'
    if (tag.startsWith('en'))
      return 'en-US'
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectBrowserLocale(),
  // zh-CN 目前没有翻译：所有 key 都回退到 en-US。
  fallbackLocale: DEFAULT_LOCALE,
  // 空语言包会让每个 key 都打一条警告，这里按设计关掉。
  missingWarn: false,
  fallbackWarn: false,
  messages: {},
})

export const composer = i18n.global as unknown as Composer

/**
 * 脚本里用的全局 `t`。
 *
 * 模板里的 `$t` 由 vue-i18n 的 globalInjection 注入；`<script setup>` 与普通 `.ts`
 * 里的 `$t` 由 unplugin-auto-import 从这里自动引入（见 vite.config.ts）。
 */
export const $t: Composer['t'] = composer.t.bind(composer)

/**
 * 省略号不进语言包，调用点自己拼。
 *
 * 写成常量而不是字面量：`$t('x') + '…'` 会被 lint 要求改成模板字符串，
 * 而 `` `${$t('x')}…` `` 又会被提取脚本当成带插值的文案重新提取。
 */
export const ELLIPSIS = '…'

/** 语言包按需引入：用到哪个语言才下载哪个，也不进主包。 */
const localeLoaders: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  'en-US': () => import('./locales/en-US/index.json'),
  'zh-CN': () => import('./locales/zh-CN/index.json'),
}
const loadingLocales = new Map<AppLocale, Promise<void>>()

/** 加载语言包；同一个语言只会真正下载一次。 */
export function loadLocaleMessages(locale: AppLocale): Promise<void> {
  const running = loadingLocales.get(locale)
  if (running) {
    return running
  }
  const task = localeLoaders[locale]().then((module) => {
    composer.setLocaleMessage(locale, module.default)
  })
  loadingLocales.set(locale, task)
  return task
}

/** 启动时先把当前语言的包加载好，首屏才不会显示 key。 */
export function initLocaleMessages(): Promise<void> {
  return loadLocaleMessages(detectBrowserLocale())
}

/** 切换界面语言；语言包没下载过会先下载，同时同步 `<html lang>`。 */
export async function setAppLocale(locale: AppLocale) {
  await loadLocaleMessages(locale)
  composer.locale.value = locale
  // 单测（bun test）里没有 document
  if (typeof document !== 'undefined')
    document.documentElement.lang = locale
}
