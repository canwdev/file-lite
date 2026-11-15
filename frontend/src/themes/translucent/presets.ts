export interface WallpaperPreset {
  id: string
  label: string
  url: string
}

/** The preset that shows no wallpaper at all, and the default for a fresh install. */
export const NONE_WALLPAPER_PRESET = 'none'

/**
 * Built-in wallpapers. Keep the URLs as plain values: they are copied into the
 * `--file-lite-wallpaper` CSS variable when picked from the settings UI.
 */
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'bing-daily',
    label: 'Bing Daily',
    url: 'https://uapis.cn/api/v1/image/bing-daily',
  },
  {
    id: 'bing-daily-random',
    label: 'Bing Daily Random',
    url: 'https://uapis.cn/api/v1/image/bing-daily?random=true&resolution=1080',
  },
  { id: 'picsum', label: 'Picsum', url: 'https://picsum.photos/1920/1080' },
]

export const DEFAULT_WALLPAPER_PRESET = NONE_WALLPAPER_PRESET

export interface WallpaperSettings {
  wallpaperPreset?: string
  wallpaperUrl?: string
}

/**
 * An uploaded image wins; otherwise the selected preset is used. No preset (None,
 * and anything unknown) yields an empty string, which clears the CSS variable.
 */
export function resolveWallpaper(settings: WallpaperSettings): string {
  const custom = settings.wallpaperUrl?.trim()
  if (custom)
    return custom

  return WALLPAPER_PRESETS.find(item => item.id === settings.wallpaperPreset)?.url ?? ''
}
