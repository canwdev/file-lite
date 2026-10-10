import type { IEntry } from '@/types/server'

/**
 * Windows 资源管理器风格的「类型」文案：目录固定为 File folder，其余一律 `${EXT} File`。
 *
 * 类型名不翻译（`PNG Image`、`Text Document` 之类跟着扩展名走），所以这里直接拼。
 */
export function getEntryTypeLabel(entry: Pick<IEntry, 'isDirectory' | 'ext'>) {
  if (entry.isDirectory) {
    return $t('file_lite_i18n.folder')
  }
  const ext = (entry.ext || '').toLowerCase()
  if (!ext) {
    return $t('file_lite_i18n.file')
  }
  return `${ext.slice(1).toUpperCase()} File`
}
