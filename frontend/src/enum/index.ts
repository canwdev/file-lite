export const isDev = Boolean(import.meta.env.MODE === 'development')

export const LsKeys = {
  STARED_PATH: 'file_lite_stared_path',
  EXPLORER_SHOW_SIDEBAR: 'file_lite_show_sidebar',
  NAV_PATH: 'file_lite_nav_path',
  CONCURRENT_NUM: 'file_lite_concurrent_num',
  SETTINGS_STORE: 'file_lite_settings_store',
  /** 仅本机 UI / 设备偏好（不入远程 settings） */
  LOCAL_SETTINGS_STORE: 'file_lite_local_settings_store',
  ARTPLAYER_VOLUME: 'file_lite_artplayer_volume',
  ARTPLAYER_PLAYBACK_RATE: 'file_lite_artplayer_playback_rate',
  DEFAULT_APP_MAP: 'file_lite_default_app_map',
  EXPLORER_STATE_MAP: 'file_lite_explorer_state_map',
  COLLECTED_ITEMS: 'file_lite_collected_items',
  MUSIC_LYRICS_VISIBLE: 'file_lite_music_lyrics_visible',
  REMEMBER_AUTH: 'file_lite_remember_auth',
  LOGIN_ACTIVE_TAB: 'file_lite_login_active_tab',
  LAST_OPENED_MEDIA_MAP: 'file_lite_last_opened_media_map',
}
