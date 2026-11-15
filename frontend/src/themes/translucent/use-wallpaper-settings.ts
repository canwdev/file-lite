import { computed, reactive, ref } from 'vue'
import { localSettingsStore } from '@/store'
import { NONE_WALLPAPER_PRESET, resolveWallpaper, WALLPAPER_PRESETS } from './presets'
import { optimizeImageFile } from './wallpaper'

/** What the Background row is set to: no wallpaper, a URL, or an uploaded image. */
export type WallpaperMode = 'none' | 'url' | 'local'

/** Value of the URL dropdown that reveals the image-URL row instead of a preset. */
export const CUSTOM_URL_CHOICE = 'custom'

const HTTP_URL = /^https?:\/\//i
const FALLBACK_PRESET = WALLPAPER_PRESETS[0].id

function isPresetId(id: string | undefined): id is string {
  return !!id && WALLPAPER_PRESETS.some(item => item.id === id)
}

/**
 * Opens the system file picker without a hidden input in the markup.
 *
 * The element is created on demand and thrown away, so the Settings list can stay
 * pure OptionUI rows; `cancel` covers dismissing the dialog.
 */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

/**
 * State and actions behind the Background rows in Settings.
 *
 * Only two values are persisted — `wallpaperPreset` and `wallpaperUrl` — while the
 * row understands three modes, so the mode and the URL dropdown keep a local copy:
 * "local image without a picked file" and "custom URL not applied yet" have no
 * stored representation. The copy is re-derived from the settings on every mount.
 */
export function useWallpaperSettings() {
  const settings = computed(() => localSettingsStore.value)

  /** Transient feedback (bad URL, upload failure); it wins over the source text. */
  const message = ref('')
  const busy = ref(false)

  const storedUrl = computed(() => settings.value.wallpaperUrl.trim())
  const storedUpload = computed(() => storedUrl.value.startsWith('data:'))
  const storedLink = computed(() => !!storedUrl.value && !storedUpload.value)
  const storedPreset = computed(() => settings.value.wallpaperPreset)

  const mode = ref<WallpaperMode>(
    storedUpload.value
      ? 'local'
      : storedLink.value || isPresetId(storedPreset.value) ? 'url' : 'none',
  )

  /** A preset id, or `custom` when the image comes from a URL. */
  const urlChoice = ref<string>(
    storedLink.value
      ? CUSTOM_URL_CHOICE
      : isPresetId(storedPreset.value) ? storedPreset.value : NONE_WALLPAPER_PRESET,
  )

  const urlDraft = reactive({ url: storedLink.value ? storedUrl.value : '' })

  const showPresetRow = computed(() => mode.value === 'url')
  const showUrlRow = computed(() => mode.value === 'url' && urlChoice.value === CUSTOM_URL_CHOICE)
  const showLocalRow = computed(() => mode.value === 'local')

  /** One line describing the wallpaper in use, unless there is feedback to show. */
  const sourceText = computed(() => {
    if (message.value)
      return message.value
    const resolved = resolveWallpaper(settings.value)
    if (!resolved)
      return $t('file_lite_i18n.none')
    if (storedUpload.value)
      return $t('file_lite_i18n.custom')
    if (storedLink.value)
      return $t('file_lite_i18n.custom_url')
    const preset = WALLPAPER_PRESETS.find(item => item.url === resolved)
    return $t('file_lite_i18n.preset_0', [preset?.label ?? $t('file_lite_i18n.default')])
  })

  const uploadLabel = computed(() => busy.value
    ? $t('file_lite_i18n.uploading')
    : `${$t('file_lite_i18n.upload')}${ELLIPSIS}`)

  function setMode(next: WallpaperMode) {
    if (next === mode.value)
      return
    message.value = ''
    mode.value = next

    if (next === 'none') {
      urlChoice.value = NONE_WALLPAPER_PRESET
      urlDraft.url = ''
      settings.value.wallpaperPreset = NONE_WALLPAPER_PRESET
      settings.value.wallpaperUrl = ''
      return
    }

    if (next === 'url') {
      // A typed URL stays as the custom entry; otherwise keep the preset that was in use.
      if (storedLink.value) {
        urlChoice.value = CUSTOM_URL_CHOICE
        urlDraft.url = storedUrl.value
        return
      }
      urlDraft.url = ''
      settings.value.wallpaperUrl = ''
      urlChoice.value = isPresetId(storedPreset.value) ? storedPreset.value : FALLBACK_PRESET
      settings.value.wallpaperPreset = urlChoice.value
      return
    }

    // Local image: an upload survives, a typed URL does not.
    settings.value.wallpaperPreset = NONE_WALLPAPER_PRESET
    if (!storedUpload.value)
      settings.value.wallpaperUrl = ''
    urlDraft.url = ''
  }

  function setUrlChoice(choice: string) {
    if (choice === urlChoice.value)
      return
    message.value = ''
    urlChoice.value = choice

    if (choice === CUSTOM_URL_CHOICE) {
      // Keep the current wallpaper until a URL is applied.
      urlDraft.url = storedLink.value ? storedUrl.value : ''
      return
    }

    urlDraft.url = ''
    settings.value.wallpaperUrl = ''
    settings.value.wallpaperPreset = choice
  }

  function applyUrl() {
    const next = urlDraft.url.trim()
    if (!HTTP_URL.test(next)) {
      message.value = $t('file_lite_i18n.invalid_url')
      return
    }
    message.value = ''
    settings.value.wallpaperPreset = NONE_WALLPAPER_PRESET
    settings.value.wallpaperUrl = next
  }

  async function upload() {
    if (busy.value)
      return
    const file = await pickImageFile()
    if (!file)
      return

    busy.value = true
    message.value = ''
    try {
      const dataUrl = await optimizeImageFile(file)
      settings.value.wallpaperPreset = NONE_WALLPAPER_PRESET
      settings.value.wallpaperUrl = dataUrl
      mode.value = 'local'
    }
    catch (error) {
      message.value = error instanceof Error ? error.message : $t('file_lite_i18n.could_not_process_this_image')
    }
    finally {
      busy.value = false
    }
  }

  function clear() {
    message.value = ''
    urlChoice.value = NONE_WALLPAPER_PRESET
    urlDraft.url = ''
    settings.value.wallpaperPreset = NONE_WALLPAPER_PRESET
    settings.value.wallpaperUrl = ''
    mode.value = 'none'
  }

  // OptionUI writes through `store[key]`, so each row binds a tiny proxy whose
  // setter runs the action above.
  const modeStore = reactive({
    get mode(): WallpaperMode {
      return mode.value
    },
    set mode(next: WallpaperMode) {
      setMode(next)
    },
  })

  const urlChoiceStore = reactive({
    get choice(): string {
      return urlChoice.value
    },
    set choice(next: string) {
      setUrlChoice(next)
    },
  })

  return {
    mode,
    urlChoice,
    urlDraft,
    modeStore,
    urlChoiceStore,
    showPresetRow,
    showUrlRow,
    showLocalRow,
    sourceText,
    message,
    busy,
    uploadLabel,
    applyUrl,
    upload,
    clear,
  }
}
