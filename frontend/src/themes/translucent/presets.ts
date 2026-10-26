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
  { id: 'picsum', label: 'Picsum', url: 'https://picsum.photos/1920/1080' },
  // https://api.paugram.com/help/bing
  { id: 'bing', label: 'Bing', url: 'https://api.paugram.com/bing' },
  // https://docs.loliapi.com/api-shi-yong-wen-dang/sui-ji-er-ci-yuan-tu-pian/page-1
  { id: 'loliapi', label: 'LoliAPI', url: 'https://www.loliapi.com/acg/' },
  { id: 'paugram', label: 'Paugram ACG', url: 'https://api.paugram.com/wallpaper/' },
]

export const DEFAULT_WALLPAPER_PRESET = 'picsum'

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
