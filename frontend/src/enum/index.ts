export const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE || ''

export const isDev = Boolean(import.meta.env.MODE === 'development')

export const LsKeys = {
  STARED_PATH: 'file_lite_stared_path',
  SHOW_HIDDEN_FILES: 'file_lite_show_hidden_files',
  EXPLORER_SHOW_SIDEBAR: 'file_lite_show_sidebar',
  NAV_PATH: 'file_lite_nav_path',
}
