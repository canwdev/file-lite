import { onScopeDispose, watch } from 'vue'
import { localSettingsStore } from '@/store'
import { resolveWallpaper } from './presets'
import { applyWallpaperCssVariable } from './wallpaper'

let activeBlobUrl: string | null = null
let requestId = 0

function revokeBlobUrl() {
  if (!activeBlobUrl)
    return
  URL.revokeObjectURL(activeBlobUrl)
  activeBlobUrl = null
}

async function toRenderableUrl(url: string): Promise<string> {
  if (!url.startsWith('data:'))
    return url
  const response = await fetch(url)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

/**
 * Wires the translucent theme to the local theme settings:
 * toggle the body class and keep the CSS variable in sync with the wallpaper.
 * Uploaded images are stored as base64 but rendered through a blob URL, so the
 * inline style does not carry a multi-megabyte data URL.
 */
export function useTranslucentTheme() {
  watch(
    () => localSettingsStore.value.themeStyle,
    (style) => {
      document.body.classList.toggle('is-translucent', style === 'translucent')
    },
    { immediate: true },
  )

  watch(
    () => resolveWallpaper(localSettingsStore.value),
    async (url) => {
      const id = ++requestId
      let renderableUrl = url

      if (url.startsWith('data:')) {
        try {
          const nextBlobUrl = await toRenderableUrl(url)
          if (id !== requestId) {
            URL.revokeObjectURL(nextBlobUrl)
            return
          }
          revokeBlobUrl()
          activeBlobUrl = nextBlobUrl
          renderableUrl = nextBlobUrl
        }
        catch {
          // Fall back to the inline data URL if the browser cannot build a blob URL.
          revokeBlobUrl()
        }
      }
      else {
        revokeBlobUrl()
      }

      applyWallpaperCssVariable(renderableUrl)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    requestId += 1
    revokeBlobUrl()
  })
}
