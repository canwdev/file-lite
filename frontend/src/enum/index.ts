export const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE || ''

export const isDev = Boolean(import.meta.env.MODE === 'development')

export const LsKeys = {
  SETTINGS_STORAGE: 'ls_key_canos_settings',
  STARED_PATH: 'canos_web_explorer_stared_path',
  SHOW_HIDDEN_FILES: 'canos_web_explorer_show_hidden_files',
  EXPLORER_SHOW_SIDEBAR: 'canos_web_explorer_show_sidebar',
}
