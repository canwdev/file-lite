export interface WallpaperPreset {
  id: string
  label: string
  url: string
}

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

export const DEFAULT_WALLPAPER_PRESET = 'bing-daily'

export interface WallpaperSettings {
  wallpaperPreset?: string
  wallpaperUrl?: string
}

/** A custom URL or uploaded data URL wins; otherwise the selected preset is used. */
export function resolveWallpaper(settings: WallpaperSettings): string {
  const custom = settings.wallpaperUrl?.trim()
  if (custom)
    return custom

  const preset = WALLPAPER_PRESETS.find(item => item.id === settings.wallpaperPreset)
  return (preset ?? WALLPAPER_PRESETS[0]).url
}
