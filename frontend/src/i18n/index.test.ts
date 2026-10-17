import { describe, expect, test } from 'bun:test'
import { composer, loadLocaleMessages, setAppLocale } from './index'

describe('locale loading', () => {
  test('registers en-US as the fallback alongside the active locale', async () => {
    await loadLocaleMessages('zh-CN')
    expect(composer.getLocaleMessage('zh-CN')).not.toEqual({})
    // vue-i18n only falls back between locales whose messages it has, so a
    // missing zh-CN key can only reach English if en-US was registered too.
    expect(composer.getLocaleMessage('en-US')).not.toEqual({})
  })

  test('falls back to English for a key the active locale lacks', async () => {
    await loadLocaleMessages('zh-CN')
    // Copy it: getLocaleMessage hands out the live (reactive) bundle.
    const zhBundle = JSON.parse(JSON.stringify(composer.getLocaleMessage('zh-CN')))
    composer.setLocaleMessage('zh-CN', { file_lite_i18n: {} })
    composer.locale.value = 'zh-CN'
    try {
      expect(composer.t('file_lite_i18n.ticket_tier')).toBe('Login validity period')
    }
    finally {
      composer.setLocaleMessage('zh-CN', zhBundle)
      await setAppLocale('en-US')
    }
  })
})
