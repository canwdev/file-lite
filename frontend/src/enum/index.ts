export const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE || ''

export const isDev = Boolean(import.meta.env.MODE === 'development')

export const LsKeys = {
  STARED_PATH: 'file_lite_stared_path',
  SHOW_HIDDEN_FILES: 'file_lite_show_hidden_files',
  EXPLORER_SHOW_SIDEBAR: 'file_lite_show_sidebar',
  NAV_PATH: 'file_lite_nav_path',
  IS_GRID_VIEW: 'file_lite_is_grid_view',
  ICON_SIZE_LIST: 'file_lite_icon_size_list',
  ICON_SIZE_GRID: 'file_lite_icon_size_grid',
  USE_NATIVE_PLAYER: 'file_lite_use_native_player',
  ENABLE_PREVIEW: 'file_lite_enable_preview',
  ARTPLAYER_VOLUME: 'file_lite_artplayer_volume',
  ARTPLAYER_PLAYBACK_RATE: 'file_lite_artplayer_playback_rate',
  DEFAULT_APP_MAP: 'file_lite_default_app_map',
  EXPLORER_STATE_MAP: 'file_lite_explorer_state_map',
  COLLECTED_ITEMS: 'file_lite_collected_items',
}
